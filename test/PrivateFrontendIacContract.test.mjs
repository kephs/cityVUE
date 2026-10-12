import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../deploy/azure/frontend/", import.meta.url);
const names = [
  "main.bicep",
  "modules/network.bicep",
  "modules/static-origin.bicep",
  "modules/private-connectivity.bicep",
  "modules/front-door.bicep",
  "modules/waf.bicep",
];
const files = Object.fromEntries(
  names.map((n) => [n, readFileSync(new URL(n, root), "utf8")]),
);
const code = (text) => text.replace(/\/\/[^\n]*/g, "");
const [main, network, origin, connectivity, edge, waf] = names.map((n) =>
  code(files[n]),
);
const all = [main, network, origin, connectivity, edge, waf].join("\n");

// Balanced source extraction, not a compiler or cloud validation.
function block(text, expression) {
  const match = expression.exec(text);
  assert.ok(match, String(expression));
  const start = text.indexOf("{", match.index + match[0].length);
  assert.ok(start >= 0);
  let depth = 0,
    quoted = false;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "'" && text[i - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return text.slice(start + 1, i);
  }
  assert.fail("unclosed block");
}
const resource = (text, name) =>
  block(text, new RegExp("resource\\s+" + name + "\\s+'[^']+'\\s*="));
const property = (text, name) =>
  block(text, new RegExp("\\b" + name + "\\s*:"));
const params = (text) => [
  ...text.matchAll(/^\s*param\s+(\w+)\s+(\w+)([^\r\n]*)$/gm),
];

test("entry point is source-disabled and all modules are gated", () => {
  assert.match(main, /var deploymentEnabled = false/);
  assert.doesNotMatch(main, /param deploymentEnabled/);
  const modules = [
    ...main.matchAll(
      /module\s+\w+\s+'([^']+)'\s*=\s*if\s*\(deploymentEnabled\)/g,
    ),
  ];
  assert.equal(modules.length, 4);
  for (const m of modules) assert.ok(files[m[1].replace(/^\.\//, "")]);
  assert.equal((main.match(/\bmodule\s/g) ?? []).length, modules.length);
  assert.doesNotMatch(main, /^\s*resource\s+\w+\s+'/m);
  // Conditional outputs must not be evaluated when their modules are absent.
  assert.doesNotMatch(main, /\b(?:network|origin)\.outputs\./);
  assert.equal(
    [...main.matchAll(/\b(?:network|origin)\.\?outputs\.\w+ \?\? ''/g)].length,
    6,
  );
});
test("all inputs have no defaults or committed deployment values", () => {
  for (const name of names)
    for (const [, p, , rest] of params(code(files[name])))
      assert.equal(rest.trim(), "", name + ":" + p);
  for (const p of [
    "location",
    "namingPrefix",
    "vnetAddressPrefix",
    "infrastructureSubnetPrefix",
    "privateEndpointSubnetPrefix",
    "workloadProfileType",
    "workloadProfileMinimumCount",
    "workloadProfileMaximumCount",
    "frontendImageReference",
    "frontendCpu",
    "frontendMemory",
  ])
    assert.ok(
      params(main).some((m) => m[1] === p),
      p,
    );
  assert.equal(
    readdirSync(root).some((n) => n.endsWith(".bicepparam")),
    false,
  );
});
test("Premium SKU is fixed", () => {
  assert.match(
    property(resource(edge, "profile"), "sku"),
    /name:\s*'Premium_AzureFrontDoor'/,
  );
  assert.doesNotMatch(all, /Standard_AzureFrontDoor|\bparam\s+\w*sku/i);
});
test("environment public access and internal VIP cannot be toggled", () => {
  const env = resource(origin, "environment");
  assert.match(env, /publicNetworkAccess:\s*'Disabled'/);
  assert.match(property(env, "vnetConfiguration"), /internal:\s*true/);
  assert.match(env, /infrastructureSubnetId:\s*infrastructureSubnetId/);
  assert.doesNotMatch(all, /publicNetworkAccess:\s*'Enabled'/);
});
test("workload profile capacity is supplied explicitly", () => {
  const env = resource(origin, "environment");
  for (const [key, value] of [
    ["name", "workloadProfileName"],
    ["workloadProfileType", "workloadProfileType"],
    ["minimumCount", "workloadProfileMinimumCount"],
    ["maximumCount", "workloadProfileMaximumCount"],
  ])
    assert.match(env, new RegExp(key + ":\\s*" + value + "\\b"));
  assert.match(env, /workloadProfiles:\s*\[/);
  assert.doesNotMatch(all, /'D4'|'E4'|'Consumption'/);
});
test("two distinct subnets use supplied CIDRs and correct delegation", () => {
  const vnet = resource(network, "vnet");
  assert.match(vnet, /addressPrefixes:\s*\[\s*vnetAddressPrefix\s*\]/);
  const infrastructure = block(vnet, /subnets:\s*\[/);
  assert.match(infrastructure, /name:\s*'aca-infrastructure'/);
  assert.match(infrastructure, /addressPrefix:\s*infrastructureSubnetPrefix/);
  assert.match(infrastructure, /serviceName:\s*'Microsoft.App\/environments'/);
  const pe = vnet.slice(vnet.indexOf("name: 'private-endpoints'"));
  assert.match(pe, /addressPrefix:\s*privateEndpointSubnetPrefix/);
  assert.match(pe, /delegations:\s*\[\s*\]/);
  assert.match(pe, /privateEndpointNetworkPolicies:\s*'Disabled'/);
  assert.doesNotMatch(all, /\b(?:10|172|192)\.\d+\.\d+\.\d+\/\d+/);
});
test("published Reqro digest input is required and described in both boundaries", () => {
  for (const text of [
    files["main.bicep"],
    files["modules/static-origin.bicep"],
  ]) {
    assert.match(text, /@sha256:<64 lowercase hex>/);
    assert.match(
      text,
      /@minLength\(74\)\s*param frontendImageReference string(?:\r?\n|$)/,
    );
  }
  assert.match(resource(origin, "frontend"), /image:\s*frontendImageReference/);
  assert.doesNotMatch(all, /ghcr\.io|:latest|:stable/);
  // The full input check is a required pre-deployment contract, not a decorator guarantee.
  const digest =
    /^(?!.*nginx-unprivileged)[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$/;
  assert.ok(
    digest.test("registry.example/reqro/frontend@sha256:" + "a".repeat(64)),
  );
  for (const invalid of [
    "registry.example/reqro:latest",
    "registry.example/reqro@sha256:abc",
    "ghcr.io/nginx/nginx-unprivileged@sha256:" + "a".repeat(64),
  ])
    assert.equal(digest.test(invalid), false);
});
test("external app ingress stays relative to private environment on 8080", () => {
  const ingress = property(resource(origin, "frontend"), "ingress");
  assert.match(ingress, /external:\s*true/);
  assert.match(ingress, /targetPort:\s*8080/);
  assert.match(ingress, /allowInsecure:\s*false/);
  assert.match(
    resource(origin, "frontend"),
    /environmentId:\s*environment\.id/,
  );
});
test("no replica policy probes secrets or registry defaults", () => {
  assert.doesNotMatch(
    origin,
    /\b(scale|probes|registries|secrets|env|identity|customDomains):/,
  );
  assert.doesNotMatch(
    all,
    /\b(minReplicas|maxReplicas|probeIntervalInSeconds|sampleSize|successfulSamplesRequired):/,
  );
});
test("customer PE targets environment in dedicated subnet", () => {
  const pe = resource(connectivity, "customerEndpoint");
  assert.match(property(pe, "subnet"), /id:\s*privateEndpointSubnetId/);
  assert.match(pe, /privateLinkServiceId:\s*environmentId/);
  assert.match(pe, /groupIds:\s*\[\s*'managedEnvironments'\s*\]/);
});
test("regional DNS links VNet and customer endpoint", () => {
  assert.ok(
    resource(connectivity, "privateDns").includes(
      "name: 'privatelink." + "$" + "{location}.azurecontainerapps.io'",
    ),
  );
  const link = resource(connectivity, "vnetLink");
  assert.match(link, /parent:\s*privateDns/);
  assert.match(link, /registrationEnabled:\s*false/);
  assert.match(property(link, "virtualNetwork"), /id:\s*vnetId/);
  const group = resource(connectivity, "zoneGroup");
  assert.match(group, /parent:\s*customerEndpoint/);
  assert.match(group, /privateDnsZoneId:\s*privateDns\.id/);
});
test("AFD Private Link targets environment without customer PE IP", () => {
  const upstream = resource(edge, "origin");
  assert.match(upstream, /hostName:\s*frontendFqdn/);
  assert.match(upstream, /originHostHeader:\s*frontendFqdn/);
  assert.match(upstream, /httpsPort:\s*443/);
  assert.match(upstream, /enforceCertificateNameCheck:\s*true/);
  const pl = property(upstream, "sharedPrivateLinkResource");
  assert.match(property(pl, "privateLink"), /id:\s*environmentId/);
  assert.match(pl, /groupId:\s*'managedEnvironments'/);
  assert.match(pl, /privateLinkLocation:\s*location/);
  assert.doesNotMatch(
    edge,
    /customerEndpoint|privateIPAddress|privateEndpointSubnetId/,
  );
});
test("no Front Door connection auto-approval", () => {
  assert.doesNotMatch(
    all,
    /privateEndpointConnections@|status:\s*'Approved'|privateLinkServiceConnectionState/,
  );
});
test("edge endpoint origin and route are disabled without default hostname serving", () => {
  for (const name of ["endpoint", "origin", "route"])
    assert.match(resource(edge, name), /enabledState:\s*'Disabled'/);
  assert.match(resource(edge, "route"), /linkToDefaultDomain:\s*'Disabled'/);
});
test("bounded frontend route cannot capture API", () => {
  const route = resource(edge, "route");
  const patterns = [
    .../patternsToMatch:\s*\[([^\]]*)\]/.exec(route)[1].matchAll(/'([^']*)'/g),
  ].map((m) => m[1]);
  assert.ok(
    patterns.includes("/") &&
      patterns.includes("/assets/*") &&
      patterns.includes("/redirect.html"),
  );
  assert.equal(patterns.includes("/*"), false);
  for (const url of [
    "/api",
    "/api/test",
    "/api/v1",
    "/api/v1evil",
    "/API/test",
  ])
    assert.equal(
      patterns.some((p) =>
        p.endsWith("/*")
          ? url.toLowerCase().startsWith(p.slice(0, -1))
          : url.toLowerCase() === p,
      ),
      false,
    );
  assert.match(route, /originGroup:\s*\{\s*id:\s*originGroup\.id/);
  assert.match(route, /forwardingProtocol:\s*'HttpsOnly'/);
  assert.match(route, /supportedProtocols:\s*\[\s*'Https'\s*\]/);
});
test("no edge cache header or certificate policy invented", () => {
  assert.doesNotMatch(
    all,
    /\b(cacheConfiguration|ruleSets|customDomains|certificates):/,
  );
  assert.doesNotMatch(
    all,
    /Content-Security-Policy|Strict-Transport-Security|Cross-Origin-Opener-Policy|max-age/,
  );
});
test("resource inventory is exactly private frontend topology", () => {
  const resources = [...all.matchAll(/resource\s+\w+\s+'([^']+)'/g)]
    .map((m) => m[1].split("@")[0])
    .sort();
  assert.deepEqual(
    resources,
    [
      "Microsoft.Network/virtualNetworks",
      "Microsoft.App/managedEnvironments",
      "Microsoft.App/containerApps",
      "Microsoft.Network/privateEndpoints",
      "Microsoft.Network/privateDnsZones",
      "Microsoft.Network/privateDnsZones/virtualNetworkLinks",
      "Microsoft.Network/privateEndpoints/privateDnsZoneGroups",
      "Microsoft.Cdn/profiles",
      "Microsoft.Cdn/profiles/afdEndpoints",
      "Microsoft.Cdn/profiles/originGroups",
      "Microsoft.Cdn/profiles/originGroups/origins",
      "Microsoft.Cdn/profiles/afdEndpoints/routes",
      "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies",
      "Microsoft.Cdn/profiles/securityPolicies",
    ].sort(),
  );
});
test("no deployment commands auth roles secrets or unsupported security flags", () => {
  assert.doesNotMatch(
    all,
    /roleAssignments|Microsoft\.ManagedIdentity|Microsoft\.ContainerRegistry|Microsoft\.KeyVault|F061|F062|Entra|proxy_pass|@secure|password|clientSecret|az deployment|az login|terraform apply/i,
  );
  assert.doesNotMatch(
    all,
    /\b(param|output)\s+\w*(secret|token|credential|password)\w*/i,
  );
  assert.doesNotMatch(
    all,
    /readOnlyRootFilesystem|capabilities|privileged|securityContext/,
  );
});
test("unsafe boundary mutations are rejected", () => {
  const check = (s) => {
    assert.match(s, /publicNetworkAccess:\s*'Disabled'/);
    assert.match(s, /internal:\s*true/);
    assert.match(s, /name:\s*'Premium_AzureFrontDoor'/);
    assert.doesNotMatch(s, /Standard_AzureFrontDoor/);
    assert.match(s, /linkToDefaultDomain:\s*'Disabled'/);
  };
  check(all);
  for (const [before, after] of [
    ["publicNetworkAccess: 'Disabled'", "publicNetworkAccess: 'Enabled'"],
    ["internal: true", "internal: false"],
    ["'Premium_AzureFrontDoor'", "'Standard_AzureFrontDoor'"],
    ["linkToDefaultDomain: 'Disabled'", "linkToDefaultDomain: 'Enabled'"],
  ])
    assert.throws(() => check(all.replace(before, after)));
});

test("WAF uses stable API, Premium, Enabled Detection and body inspection", () => {
  assert.match(
    waf,
    /resource wafPolicy 'Microsoft\.Network\/FrontDoorWebApplicationFirewallPolicies@2025-11-01'/,
  );
  const policy = resource(waf, "wafPolicy");
  assert.match(policy, /location:\s*'global'/);
  assert.match(property(policy, "sku"), /name:\s*'Premium_AzureFrontDoor'/);
  const settings = property(policy, "policySettings");
  assert.match(settings, /enabledState:\s*'Enabled'/);
  assert.match(settings, /mode:\s*'Detection'/);
  assert.match(settings, /requestBodyCheck:\s*'Enabled'/);
  assert.deepEqual(
    params(waf).map((m) => m[1]),
    ["policyName"],
  );
  assert.doesNotMatch(waf, /Prevention|Disabled|Standard_AzureFrontDoor/);
});

function checkManagedRules(source) {
  const rules = property(resource(source, "wafPolicy"), "managedRules");
  assert.match(
    rules,
    /managedRuleSets:\s*\[\s*\{\s*ruleSetType:\s*'Microsoft_DefaultRuleSet'\s+ruleSetVersion:\s*'2\.2'\s*\}\s*\]/,
  );
  assert.equal([...rules.matchAll(/ruleSetType:/g)].length, 1);
  assert.doesNotMatch(
    source,
    /exclusions|exceptionsList|ruleGroupOverrides|customRules|ruleSetAction|BotManager|RateLimit|CAPTCHA|JSChallenge|action:\s*'Allow'/i,
  );
}

test("DRS 2.2 has no application overrides or custom bypass rules", () => {
  checkManagedRules(waf);
});

function checkAssociation(source) {
  assert.match(
    source,
    /resource securityPolicy 'Microsoft\.Cdn\/profiles\/securityPolicies@2025-04-15'/,
  );
  const policy = resource(source, "securityPolicy");
  assert.match(policy, /parent:\s*profile/);
  const parameters = property(policy, "parameters");
  assert.match(parameters, /type:\s*'WebApplicationFirewall'/);
  assert.match(
    property(parameters, "wafPolicy"),
    /id:\s*waf\.outputs\.policyId/,
  );
  assert.match(
    parameters,
    /associations:\s*\[\s*\{\s*domains:\s*\[\s*\{\s*id:\s*endpoint\.id\s*\}\s*\]\s*patternsToMatch:\s*\[\s*'\/\*'\s*\]\s*\}\s*\]/,
  );
}

test("security association references the WAF output and current endpoint for all paths", () => {
  checkAssociation(edge);
  assert.match(edge, /module waf '\.\/waf\.bicep' =/);
  assert.match(waf, /output policyId string = wafPolicy\.id/);
  assert.equal(
    [
      ...all.matchAll(
        /resource\s+\w+\s+'Microsoft\.Cdn\/profiles\/afdEndpoints@/g,
      ),
    ].length,
    1,
  );
  assert.equal(
    [
      ...all.matchAll(
        /resource\s+\w+\s+'Microsoft\.Cdn\/profiles\/securityPolicies@/g,
      ),
    ].length,
    1,
  );
});

test("WAF association does not expand the reviewed frontend routing surface", () => {
  const route = resource(edge, "route");
  const patterns = [
    .../patternsToMatch:\s*\[([^\]]*)\]/.exec(route)[1].matchAll(/'([^']*)'/g),
  ].map((m) => m[1]);
  assert.deepEqual(patterns, [
    "/",
    "/index.html",
    "/redirect.html",
    "/assets/*",
    "/staff",
    "/staff/*",
    "/admin",
    "/admin/*",
    "/map-preview",
    "/track",
    "/report",
    "/issues",
    "/issues/*",
    "/dashboard",
  ]);
  assert.match(route, /linkToDefaultDomain:\s*'Disabled'/);
});

test("no diagnostic destination custom domain or additional policy surface is introduced", () => {
  assert.doesNotMatch(
    all,
    /Microsoft\.(?:Insights|OperationalInsights|EventHub|Storage)\//i,
  );
  assert.doesNotMatch(
    all,
    /profiles\/customDomains|diagnosticSettings|logAnalytics|retentionInDays|rateLimit|geoMatch|CAPTCHA|JSChallenge|requestBodySize/i,
  );
  assert.doesNotMatch(
    waf,
    /\b(?:customRules|exclusions|exceptionsList|ruleGroupOverrides)\s*:/,
  );
});

test("unsafe WAF and association mutations fail the contracts", () => {
  for (const changed of [
    waf.replace("'2.2'", "'2.1'"),
    waf.replace("managedRules: {", "managedRules: { exclusions: []"),
    waf.replace("managedRules: {", "managedRules: { ruleGroupOverrides: []"),
    waf.replace(
      "policySettings: {",
      "customRules: { rules: [] } policySettings: {",
    ),
    waf.replace("Microsoft_DefaultRuleSet", "Microsoft_BotManagerRuleSet"),
  ])
    assert.throws(() => checkManagedRules(changed));
  for (const changed of [
    edge.replace("id: endpoint.id", "id: anotherEndpoint.id"),
    edge.replace("id: waf.outputs.policyId", "id: unrelatedPolicyId"),
    edge.replace("'/*'", "'/assets/*'"),
  ])
    assert.throws(() => checkAssociation(changed));
});

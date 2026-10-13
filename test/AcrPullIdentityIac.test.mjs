import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadFreshTemplate } from "../scripts/validate-frontend-iac.mjs";

const sourceRoot = new URL("../deploy/azure/frontend/", import.meta.url);
const template = loadFreshTemplate({
  sourceRoot: fileURLToPath(sourceRoot),
  runDirectory: process.env.REQRO_IAC_RUN_DIRECTORY,
  runId: process.env.REQRO_IAC_RUN_ID,
});
const source = (name) => readFileSync(new URL(name, sourceRoot), "utf8");
const moduleOf = (t, name) => t.resources.find((r) => r.name === name);
const inner = (t, name) => moduleOf(t, name).properties.template;
const resourcesOf = (t, type) =>
  t.resources.filter((r) => r.type.toLowerCase() === type.toLowerCase());
const one = (t, type) => {
  const resources = resourcesOf(t, type);
  assert.equal(resources.length, 1, type);
  return resources[0];
};
const registryTemplate = (t) => inner(t, "frontend-registry");
const registry = (t) =>
  one(registryTemplate(t), "Microsoft.ContainerRegistry/registries");
const assignment = (t) =>
  one(registryTemplate(t), "Microsoft.Authorization/roleAssignments");
const app = (t) =>
  one(inner(t, "frontend-origin"), "Microsoft.App/containerApps");
const readActions = ["content/read", "metadata/read"].map(
  (s) => `Microsoft.ContainerRegistry/registries/repositories/${s}`,
);
const expectedCondition = `((!(ActionMatches{'${readActions[0]}'}) AND !(ActionMatches{'${readActions[1]}'})) OR (@Request[Microsoft.ContainerRegistry/registries/repositories:name] StringEqualsIgnoreCase 'reqro/frontend'))`;
const compact = (s) => s.replace(/\s/g, "");

function checkGate(t) {
  assert.equal(t.variables.deploymentEnabled, false);
  assert.equal(t.parameters.deploymentEnabled, undefined);
  assert.equal(t.resources.length, 6);
  for (const r of t.resources) {
    assert.equal(r.type, "Microsoft.Resources/deployments");
    assert.equal(r.condition, "[variables('deploymentEnabled')]");
  }
  const edge = inner(t, "frontend-edge");
  for (const type of [
    "Microsoft.Cdn/profiles/afdEndpoints",
    "Microsoft.Cdn/profiles/originGroups/origins",
    "Microsoft.Cdn/profiles/afdEndpoints/routes",
  ])
    assert.equal(one(edge, type).properties.enabledState, "Disabled");
  assert.equal(
    one(edge, "Microsoft.Cdn/profiles/afdEndpoints/routes").properties
      .linkToDefaultDomain,
    "Disabled",
  );
}

function checkRegistry(t) {
  const r = registry(t);
  assert.equal(r.apiVersion, "2025-11-01");
  assert.equal(r.sku.name, "Premium");
  assert.deepEqual(r.properties, {
    roleAssignmentMode: "AbacRepositoryPermissions",
    adminUserEnabled: false,
    anonymousPullEnabled: false,
    publicNetworkAccess: "Disabled",
    networkRuleSet: { defaultAction: "Deny", ipRules: [] },
    networkRuleBypassOptions: "AzureServices",
    networkRuleBypassAllowedForTasks: false,
    dataEndpointEnabled: true,
    policies: { azureADAuthenticationAsArmPolicy: { status: "enabled" } },
  });
  const rt = registryTemplate(t);
  assert.deepEqual(Object.keys(rt.outputs).sort(), [
    "loginServer",
    "pullIdentityId",
  ]);
  assert.match(rt.outputs.loginServer.value, /\.loginServer\]$/);
  assert.match(
    rt.outputs.pullIdentityId.value,
    /Microsoft\.ManagedIdentity\/userAssignedIdentities/,
  );
}

function checkPermission(t) {
  const rt = registryTemplate(t);
  one(rt, "Microsoft.ManagedIdentity/userAssignedIdentities");
  const a = assignment(t);
  assert.equal(
    a.scope,
    "[resourceId('Microsoft.ContainerRegistry/registries', parameters('registryName'))]",
  );
  assert.equal(a.apiVersion, "2022-04-01");
  assert.equal(
    rt.variables.readerRoleId,
    "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b93aa761-3e63-49ed-ac28-beffa264f7ac')]",
  );
  assert.equal(a.properties.roleDefinitionId, "[variables('readerRoleId')]");
  assert.equal(
    a.properties.principalId,
    "[reference(resourceId('Microsoft.ManagedIdentity/userAssignedIdentities', format('{0}-frontend-pull', parameters('namingPrefix'))), '2024-11-30').principalId]",
  );
  assert.equal(a.properties.principalType, "ServicePrincipal");
  assert.equal(a.properties.conditionVersion, "2.0");
  assert.equal(compact(a.properties.condition), compact(expectedCondition));
}

function checkNetwork(t) {
  const network = one(
    inner(t, "frontend-network"),
    "Microsoft.Network/virtualNetworks",
  );
  assert.equal(network.properties.subnets.length, 3);
  assert.equal(new Set(network.properties.subnets.map((s) => s.name)).size, 3);
  const acr = network.properties.subnets.find(
    (s) => s.name === "acr-private-endpoints",
  );
  assert.deepEqual(acr.properties, {
    addressPrefix: "[parameters('acrPrivateEndpointSubnetPrefix')]",
    delegations: [],
    privateEndpointNetworkPolicies: "Disabled",
  });
  const rt = registryTemplate(t);
  const pe = one(rt, "Microsoft.Network/privateEndpoints");
  assert.deepEqual(pe.properties.subnet, {
    id: "[parameters('acrPrivateEndpointSubnetId')]",
  });
  assert.equal(pe.properties.privateLinkServiceConnections.length, 1);
  assert.deepEqual(pe.properties.privateLinkServiceConnections[0].properties, {
    privateLinkServiceId:
      "[resourceId('Microsoft.ContainerRegistry/registries', parameters('registryName'))]",
    groupIds: ["registry"],
  });
  assert.equal(
    one(rt, "Microsoft.Network/privateDnsZones").name,
    "privatelink.azurecr.io",
  );
  const link = one(rt, "Microsoft.Network/privateDnsZones/virtualNetworkLinks");
  assert.deepEqual(link.properties, {
    registrationEnabled: false,
    virtualNetwork: { id: "[parameters('vnetId')]" },
  });
  const group = one(
    rt,
    "Microsoft.Network/privateEndpoints/privateDnsZoneGroups",
  );
  assert.deepEqual(group.properties.privateDnsZoneConfigs, [
    {
      name: "acr",
      properties: {
        privateDnsZoneId:
          "[resourceId('Microsoft.Network/privateDnsZones', 'privatelink.azurecr.io')]",
      },
    },
  ]);
  assert.ok(
    group.dependsOn.some((s) =>
      s.includes("Microsoft.Network/privateEndpoints"),
    ),
  );
  assert.equal(rt.resources.length, 7); // No manually authored A records or extra authority.
  assert.match(
    moduleOf(t, "frontend-registry").properties.parameters
      .acrPrivateEndpointSubnetId.value,
    /acrPrivateEndpointSubnetId/,
  );
}

function checkIdentity(t) {
  const a = app(t);
  assert.deepEqual(a.identity, {
    type: "UserAssigned",
    userAssignedIdentities: {
      "[format('{0}', parameters('pullIdentityId'))]": {},
    },
  });
  assert.deepEqual(a.properties.configuration.registries, [
    {
      server: "[parameters('registryLoginServer')]",
      identity: "[parameters('pullIdentityId')]",
    },
  ]);
  assert.deepEqual(a.properties.configuration.identitySettings, [
    { identity: "[parameters('pullIdentityId')]", lifecycle: "None" },
  ]);
  assert.equal(a.properties.configuration.secrets, undefined);
  assert.equal(a.properties.template.containers[0].env, undefined);
  assert.equal(
    a.properties.template.containers[0].image,
    "[format('{0}/reqro/frontend@sha256:{1}', parameters('registryLoginServer'), parameters('frontendImageDigest'))]",
  );
  const env = one(
    inner(t, "frontend-origin"),
    "Microsoft.App/managedEnvironments",
  );
  assert.equal(env.properties.publicNetworkAccess, "Disabled");
  assert.equal(env.properties.vnetConfiguration.internal, true);
  assert.equal(a.properties.configuration.ingress.allowInsecure, false);
  const origin = moduleOf(t, "frontend-origin");
  assert.ok(
    origin.dependsOn.includes(
      "[resourceId('Microsoft.Resources/deployments', 'frontend-registry')]",
    ),
  );
  for (const [key, output] of [
    ["registryLoginServer", "loginServer"],
    ["pullIdentityId", "pullIdentityId"],
  ]) {
    const value = origin.properties.parameters[key].value;
    assert.match(value, /frontend-registry/);
    assert.ok(value.includes(output));
    assert.match(value, /tryGet/); // No unsafe conditional module output access.
  }
  for (const p of [
    t.parameters.frontendImageDigest,
    inner(t, "frontend-origin").parameters.frontendImageDigest,
  ]) {
    assert.equal(p.minLength, 64);
    assert.equal(p.maxLength, 64);
    assert.equal(p.defaultValue, undefined);
  }
}

test("compiled deployment and edge activation gates remain closed", () =>
  checkGate(template));
test("compiled registry is private Premium ABAC with explicit trusted-service exception", () =>
  checkRegistry(template));
test("compiled permission is one exact-repository Reader on the declared UAMI", () =>
  checkPermission(template));
test("compiled private endpoint and service-managed DNS have a dedicated subnet", () =>
  checkNetwork(template));
test("compiled ACA pull wiring isolates identity and fixes digest image authority", () =>
  checkIdentity(template));

test("compiled input defaults and resource inventory cannot hide extra authority", () => {
  const walk = (t) => {
    for (const p of Object.values(t.parameters ?? {}))
      assert.equal(p.defaultValue, undefined);
    return t.resources.flatMap((r) =>
      r.type === "Microsoft.Resources/deployments"
        ? walk(r.properties.template)
        : [r],
    );
  };
  const resources = walk(template);
  assert.equal(resources.length, 23);
  assert.equal(
    resources.filter(
      (r) => r.type === "Microsoft.Authorization/roleAssignments",
    ).length,
    1,
  );
  assert.equal(
    resources.filter(
      (r) => r.type === "Microsoft.ManagedIdentity/userAssignedIdentities",
    ).length,
    1,
  );
  assert.doesNotMatch(
    JSON.stringify(template),
    /listCredentials|listKeys|passwordSecretRef|federatedIdentityCredentials|Microsoft.Security\/pricings|Microsoft.DevOpsInfrastructure/i,
  );
});

// Restricted interpreter of the documented ABAC expression, read from actual ARM.
// Not an Azure authorization emulator. Parse only the reviewed grammar; fail otherwise.
function evaluateCondition(condition, action, repository) {
  const pattern =
    /^\(\(!\(ActionMatches\{'([^']+)'\}\)AND!\(ActionMatches\{'([^']+)'\}\)\)OR\(@Request\[Microsoft\.ContainerRegistry\/registries\/repositories:name\]StringEqualsIgnoreCase'([^']+)'\)\)$/;
  const match = pattern.exec(compact(condition));
  assert.ok(match, "unreviewed ABAC expression grammar");
  return (
    (action !== match[1] && action !== match[2]) ||
    (typeof repository === "string" &&
      repository.toLowerCase() === match[3].toLowerCase())
  );
}
const permits = (action, repository) =>
  readActions.includes(action) &&
  evaluateCondition(
    assignment(template).properties.condition,
    action,
    repository,
  );
test("ABAC permits both read operations on exact repository", () => {
  for (const action of readActions)
    assert.equal(permits(action, "reqro/frontend"), true);
});
test("ABAC refuses other repositories, prefixes, descendants and missing attributes", () => {
  for (const action of readActions)
    for (const name of [
      undefined,
      "",
      "frontend",
      "reqro",
      "reqro/frontend-extra",
      "reqro/frontend/child",
      "other/frontend",
    ])
      assert.equal(permits(action, name), false);
});
test("Reader action set refuses write/delete/catalog even when condition exempts those actions", () => {
  assert.equal(
    permits(
      "Microsoft.ContainerRegistry/registries/catalog/read",
      "reqro/frontend",
    ),
    false,
  );
  for (const operation of [
    "content/write",
    "metadata/write",
    "content/delete",
    "metadata/delete",
    "catalog/read",
  ])
    assert.equal(
      permits(
        `Microsoft.ContainerRegistry/registries/repositories/${operation}`,
        "reqro/frontend",
      ),
      false,
    );
});

const mutations = [
  [
    "deployment enabled",
    checkGate,
    (t) => {
      t.variables.deploymentEnabled = true;
    },
  ],
  [
    "registry module ungated",
    checkGate,
    (t) => {
      delete moduleOf(t, "frontend-registry").condition;
    },
  ],
  [
    "public registry",
    checkRegistry,
    (t) => {
      registry(t).properties.publicNetworkAccess = "Enabled";
    },
  ],
  [
    "admin credentials",
    checkRegistry,
    (t) => {
      registry(t).properties.adminUserEnabled = true;
    },
  ],
  [
    "anonymous pull",
    checkRegistry,
    (t) => {
      registry(t).properties.anonymousPullEnabled = true;
    },
  ],
  [
    "legacy permission mode",
    checkRegistry,
    (t) => {
      registry(t).properties.roleAssignmentMode = "LegacyRegistryPermissions";
    },
  ],
  [
    "task bypass",
    checkRegistry,
    (t) => {
      registry(t).properties.networkRuleBypassAllowedForTasks = true;
    },
  ],
  [
    "ARM audience disabled",
    checkRegistry,
    (t) => {
      registry(t).properties.policies.azureADAuthenticationAsArmPolicy.status =
        "disabled";
    },
  ],
  [
    "unconditioned assignment",
    checkPermission,
    (t) => {
      assignment(t).properties.condition = "";
    },
  ],
  [
    "wrong action conjunction",
    checkPermission,
    (t) => {
      assignment(t).properties.condition = assignment(
        t,
      ).properties.condition.replace("AND", "OR");
    },
  ],
  [
    "unrestricted metadata read",
    checkPermission,
    (t) => {
      assignment(t).properties.condition = assignment(
        t,
      ).properties.condition.replace("metadata/read", "metadata/write");
    },
  ],
  [
    "wildcard repository",
    checkPermission,
    (t) => {
      assignment(t).properties.condition = assignment(
        t,
      ).properties.condition.replace("reqro/frontend", "reqro/*");
    },
  ],
  [
    "legacy AcrPull role",
    checkPermission,
    (t) => {
      registryTemplate(t).variables.readerRoleId =
        "[subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')]";
    },
  ],
  [
    "broad grant",
    checkPermission,
    (t) => {
      assignment(t).scope = "[subscription().id]";
    },
  ],
  [
    "caller chosen principal",
    checkPermission,
    (t) => {
      assignment(t).properties.principalId = "[parameters('principalId')]";
    },
  ],
  [
    "ACA endpoint subnet reuse",
    checkNetwork,
    (t) => {
      one(
        registryTemplate(t),
        "Microsoft.Network/privateEndpoints",
      ).properties.subnet.id = "[parameters('privateEndpointSubnetId')]";
    },
  ],
  [
    "wrong DNS zone",
    checkNetwork,
    (t) => {
      one(registryTemplate(t), "Microsoft.Network/privateDnsZones").name =
        "azurecr.io";
    },
  ],
  [
    "container identity exposure",
    checkIdentity,
    (t) => {
      app(t).properties.configuration.identitySettings[0].lifecycle = "All";
    },
  ],
  [
    "floating tag",
    checkIdentity,
    (t) => {
      app(t).properties.template.containers[0].image =
        "registry.example/reqro/frontend:latest";
    },
  ],
  [
    "registry dependency removed",
    checkIdentity,
    (t) => {
      moduleOf(t, "frontend-origin").dependsOn = [];
    },
  ],
];
for (const [name, check, mutate] of mutations)
  test(`compiled unsafe mutation rejected: ${name}`, () => {
    const changed = structuredClone(template);
    mutate(changed);
    assert.throws(() => check(changed));
  });

test("source condition and compiled condition agree; no alternative permission sources", () => {
  const registrySource = source("modules/registry.bicep");
  const condition = /condition: '''\r?\n([\s\S]*?)'''/.exec(registrySource)[1];
  assert.equal(
    compact(condition),
    compact(assignment(template).properties.condition),
  );
  assert.doesNotMatch(
    registrySource,
    /AcrPull|AcrPush|Repository Writer|Repository Contributor|Catalog Lister|listCredentials|listKeys/,
  );
});

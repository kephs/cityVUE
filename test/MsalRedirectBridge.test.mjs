import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { build } from "vite";
import config from "../react/vite.config.mjs";

const reactRoot = fileURLToPath(new URL("../react/", import.meta.url));
const bridgePath = fileURLToPath(
  new URL("../react/redirect.html", import.meta.url),
);
const html = readFileSync(bridgePath, "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
const importStatement =
  /import\s*\{\s*broadcastResponseToMainFrame\s*\}\s*from\s*["']@azure\/msal-browser\/redirect-bridge["'];/;

test("bridge is an independent minimal HTML entry with one MSAL subpath import", () => {
  assert.equal(scripts.length, 1);
  assert.match(scripts[0][1], /type="module"/);
  assert.doesNotMatch(scripts[0][1], /\bsrc=/);
  assert.match(scripts[0][2], importStatement);
  assert.equal([...scripts[0][2].matchAll(/\bimport\b/g)].length, 1);
  assert.doesNotMatch(
    html,
    /(?:React|Router|MsalProvider|createRoot|fetch\s*\(|XMLHttpRequest|serviceWorker|localStorage|sessionStorage|\/api\/|src\/main|iframe|onload=)/,
  );
  assert.doesNotMatch(html, /<(?:link|img|form|iframe)\b|id="root"/);
});

test("bridge invokes MSAL once with no arguments and logs only a fixed message on rejection", async () => {
  for (const rejected of [false, true]) {
    let calls = 0;
    const messages = [];
    runInNewContext(scripts[0][2].replace(importStatement, ""), {
      broadcastResponseToMainFrame: (...args) => {
        calls++;
        assert.deepEqual(args, []);
        return rejected
          ? Promise.reject(new Error("PRIVATE_AUTH_RESPONSE_SENTINEL"))
          : Promise.resolve();
      },
      console: { error: (...args) => messages.push(args) },
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1);
    assert.deepEqual(
      messages,
      rejected ? [["Authentication response could not be processed."]] : [],
    );
  }
});

test("Vite retains the SPA and includes the separate bridge without replacing security configuration", () => {
  assert.deepEqual(config.build.rolldownOptions.input, {
    main: fileURLToPath(new URL("../react/index.html", import.meta.url)),
    redirect: bridgePath,
  });
  assert.ok(
    config.plugins.some(
      (plugin) => plugin.name === "reqro-serving-configuration",
    ),
  );
  assert.ok(config.server.fs.deny.includes("**/.local-uat/**"));
});

test("production bridge output cannot reach SPA modules or unrelated dependencies", async () => {
  const fixture = {
    VITE_CITYVUE_DEPLOYMENT_PROFILE: "client",
    VITE_CITYVUE_DATA_SOURCE: "api",
    VITE_CITYVUE_API_BASE_URL: "",
    VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: "false",
    VITE_ENTRA_TENANT_ID: "",
    VITE_ENTRA_WEB_CLIENT_ID: "",
    VITE_ENTRA_API_SCOPE: "",
  };
  const previous = Object.fromEntries(
    Object.keys(fixture).map((key) => [key, process.env[key]]),
  );
  let result;
  try {
    Object.assign(process.env, fixture);
    result = await build({
      root: reactRoot,
      configFile: fileURLToPath(
        new URL("../react/vite.config.mjs", import.meta.url),
      ),
      envDir: false,
      logLevel: "silent",
      build: { write: false },
    });
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  const output = (Array.isArray(result) ? result : [result]).flatMap(
    (bundle) => bundle.output,
  );
  const page = output.find((item) => item.fileName === "redirect.html");
  const main = output.find((item) => item.fileName === "index.html");
  assert.ok(page && main);
  const builtHtml = String(page.source);
  const bridgeScripts = [
    ...builtHtml.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),
  ].map((m) => m[1].replace(/^\//, ""));
  assert.equal(bridgeScripts.length, 1);
  assert.doesNotMatch(builtHtml, /<link[^>]+rel="stylesheet"|id="root"/);
  const chunks = new Map(
    output
      .filter((item) => item.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
  const seen = new Set();
  function visit(name) {
    if (seen.has(name)) return;
    seen.add(name);
    const chunk = chunks.get(name);
    assert.ok(chunk, "unresolved bridge chunk " + name);
    assert.equal(
      chunk.dynamicImports.length,
      0,
      "bridge must not lazy-load an application",
    );
    for (const moduleId of Object.keys(chunk.modules)) {
      const id = moduleId.replaceAll("\\", "/");
      assert.ok(
        id.startsWith("\0") ||
          id.includes("/@azure/msal-browser/") ||
          id.includes("/@azure/msal-common/") ||
          id === bridgePath.replaceAll("\\", "/") ||
          id === bridgePath.replaceAll("\\", "/") + "?html-proxy&index=0.js",
        "unexpected module in bridge closure: " + id,
      );
      assert.doesNotMatch(
        id,
        /\/react\/src\/|\/react-router|\/@azure\/msal-react\/|\/node_modules\/react(?:-dom)?\//,
      );
    }
    for (const imported of chunk.imports) visit(imported);
  }
  bridgeScripts.forEach(visit);
  const entry = chunks.get(bridgeScripts[0]);
  assert.equal(entry.isEntry, true);
  assert.equal(
    entry.facadeModuleId.replaceAll("\\", "/"),
    bridgePath.replaceAll("\\", "/"),
  );
  const mainScripts = [
    ...String(main.source).matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g),
  ].map((m) => m[1].replace(/^\//, ""));
  assert.ok(mainScripts.length > 0);
  for (const mainScript of mainScripts)
    assert.equal(seen.has(mainScript), false);
  console.log(
    "Bridge output: " +
      [...seen]
        .map(
          (name) =>
            name + " (" + Buffer.byteLength(chunks.get(name).code) + " bytes)",
        )
        .join(", "),
  );
});

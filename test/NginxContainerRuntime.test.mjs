import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const base = new URL(process.env.REQRO_NGINX_TEST_URL ?? "http://invalid/");
assert.equal(
  base.hostname,
  "127.0.0.1",
  "Set REQRO_NGINX_TEST_URL to localhost-published container",
);
assert.equal(base.protocol, "http:");
const root = new URL("../dist-react/", import.meta.url);
const index = readFileSync(new URL("index.html", root));
const bridge = readFileSync(new URL("redirect.html", root));
const assets = readdirSync(new URL("assets/", root));
async function request(path) {
  const response = await fetch(new URL(path, base), {
    redirect: "manual",
    signal: AbortSignal.timeout(5000),
  });
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  for (const header of [
    "content-security-policy",
    "content-security-policy-report-only",
    "strict-transport-security",
  ])
    assert.equal(response.headers.get(header), null);
  return { response, body };
}
for (const path of ["/", "/index.html", "/staff", "/admin/example"]) {
  test("normal HTML " + path, async () => {
    const { response, body } = await request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(body, index);
    assert.match(response.headers.get("content-type"), /^text\/html\b/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("cross-origin-opener-policy"),
      "same-origin",
    );
  });
}
for (const path of ["/redirect.html", "/redirect.html?synthetic=1"]) {
  test("isolated bridge and retained headers " + path, async () => {
    const { response, body } = await request(path);
    assert.equal(response.status, 200);
    assert.deepEqual(body, bridge);
    assert.notDeepEqual(body, index);
    assert.match(response.headers.get("content-type"), /^text\/html\b/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("cross-origin-opener-policy"), null);
    const scripts = [
      ...body.toString().matchAll(/(?:src|href)="(\/assets\/[^"]+\.js)"/g),
    ].map((m) => m[1]);
    assert.ok(scripts.length);
    for (const script of scripts) {
      const delivered = await request(script);
      assert.deepEqual(
        delivered.body,
        readFileSync(new URL(script.slice(1), root)),
      );
    }
  });
}
for (const [extension, mime] of [
  [".js", /^(application|text)\/javascript\b/],
  [".css", /^text\/css\b/],
]) {
  test("real asset MIME/cache " + extension, async () => {
    const name = assets.find((n) => n.endsWith(extension));
    assert.ok(name);
    const { response, body } = await request("/assets/" + name);
    assert.equal(response.status, 200);
    assert.deepEqual(body, readFileSync(new URL("assets/" + name, root)));
    assert.match(response.headers.get("content-type"), mime);
    assert.equal(response.headers.get("cache-control"), "no-cache");
  });
}
for (const path of [
  "/assets/definitely-missing.js",
  "/assets/definitely-missing.css",
  "/definitely-missing.js",
  "/api/test",
  "/api",
  "/REDIRECT.HTML",
  "/redirect.html/extra",
]) {
  test("non-SPA plain-text failure " + path, async () => {
    const { response, body } = await request(path);
    assert.equal(response.status, 404);
    assert.equal(body.toString(), "Not found\n");
    assert.match(response.headers.get("content-type"), /^text\/plain\b/);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(
      response.headers.get("cross-origin-opener-policy"),
      "same-origin",
    );
    assert.notDeepEqual(body, index);
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import config from "../react/vite.config.mjs";

test("exact redirect.html path serves the independent bridge, not SPA fallback", async () => {
  const server = await createServer({
    ...config,
    configFile: false,
    envDir: false,
    root: fileURLToPath(new URL("../react/", import.meta.url)),
    server: {
      ...config.server,
      host: "127.0.0.1",
      port: 0,
      strictPort: true,
      open: false,
      hmr: false,
      watch: null,
    },
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    assert.equal(address.address, "127.0.0.1");
    const base = `http://127.0.0.1:${address.port}`;
    const response = await fetch(`${base}/redirect.html`, {
      redirect: "manual",
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
    const html = await response.text();
    assert.match(html, /Processing authentication/);
    assert.doesNotMatch(html, /id="root"|src\/main|RouterProvider/);
    assert.match(html, /redirect\.html\?html-proxy/);
    const signedOut = await fetch(`${base}/auth/signed-out`, {
      redirect: "manual",
    });
    assert.equal(signedOut.status, 200);
    assert.match(await signedOut.text(), /src\/main\.jsx/);
  } finally {
    await server.close();
  }
});

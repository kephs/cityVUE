import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createServer, resolveConfig } from "vite";
import config from "../react/vite.config.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("private file denial preserves the installed Vite defaults", async () => {
  const defaults = await resolveConfig(
    { configFile: false, logLevel: "silent" },
    "serve",
  );
  for (const pattern of defaults.server.fs.deny) {
    assert.ok(
      config.server.fs.deny.includes(pattern),
      "A Vite default protection was removed",
    );
  }
});

test("Vite denies private development files while serving the frontend", async () => {
  const fixtureRoots = [];
  const protectedRoots = [
    path.join(root, "server/.local-data"),
    path.join(root, ".local-uat"),
  ];
  let server;
  try {
    const marker = "synthetic-private-attachment-fixture";
    for (const protectedRoot of protectedRoots) {
      await mkdir(protectedRoot, { recursive: true });
      const fixtureRoot = await mkdtemp(
        path.join(protectedRoot, "vite-regression-"),
      );
      fixtureRoots.push(fixtureRoot);
      await writeFile(path.join(fixtureRoot, "fictional-object"), marker);
    }
    server = await createServer({
      ...config,
      configFile: false,
      root: path.join(root, "react"),
      logLevel: "silent",
      server: {
        ...config.server,
        host: "127.0.0.1",
        port: 0,
        fs: { ...config.server.fs },
      },
    });
    await server.listen();
    const origin = "http://127.0.0.1:" + server.httpServer.address().port;
    for (const fixtureRoot of fixtureRoots) {
      const url =
        origin +
        "/@fs/" +
        path.join(fixtureRoot, "fictional-object").replaceAll("\\", "/");
      for (const query of ["", "?raw", "?url", "?url&inline", "?raw&import"]) {
        const response = await fetch(url + query);
        const body = await response.text();
        assert.equal(
          response.status,
          403,
          "Private file request must be denied",
        );
        assert.equal(
          body.includes(marker),
          false,
          "Private text must not be returned",
        );
        assert.equal(
          body.includes(Buffer.from(marker).toString("base64")),
          false,
          "Private inline bytes must not be returned",
        );
      }
    }
    assert.equal((await fetch(origin + "/")).status, 200);
    assert.equal((await fetch(origin + "/src/main.jsx")).status, 200);
  } finally {
    await server?.close();
    for (const fixtureRoot of fixtureRoots) {
      assert.ok(
        protectedRoots.includes(path.dirname(path.resolve(fixtureRoot))),
        "Cleanup must remain beneath a protected test root",
      );
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }
});

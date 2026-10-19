import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  createCompilationEvidence,
  loadFreshTemplate,
} from "../scripts/validate-frontend-iac.mjs";

// Synthetic compiler results exercise evidence handling only, not Azure semantics.
const scratch = fileURLToPath(new URL("../.local-uat/", import.meta.url));
function fixture(t) {
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(realpathSync(scratch), "freshness-test-"));
  t.after(() => {
    assert.ok(realpathSync(root).startsWith(realpathSync(scratch) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  const sourceRoot = join(root, "source");
  const runDirectory = join(root, "run");
  mkdirSync(join(sourceRoot, "modules"), { recursive: true });
  mkdirSync(runDirectory);
  writeFileSync(
    join(sourceRoot, "main.bicep"),
    "module registry './modules/registry.bicep' = {}\n",
  );
  writeFileSync(
    join(sourceRoot, "modules/registry.bicep"),
    "var adminUserEnabled = false\n",
  );
  return {
    sourceRoot,
    runDirectory,
    runId: "synthetic-run",
    compile: ({ output }) => {
      writeFileSync(
        join(output, "main.json"),
        JSON.stringify({ resources: [] }),
      );
      return { status: 0 };
    },
  };
}
test("successful current compilation evidence loads", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  assert.deepEqual(loadFreshTemplate(f), { resources: [] });
});
test("missing validation context cannot use an old ignored artifact", () => {
  assert.throws(
    () => loadFreshTemplate({}),
    /fresh compilation evidence is required/,
  );
});
test("missing compilation evidence is rejected", (t) => {
  const f = fixture(t);
  assert.throws(() => loadFreshTemplate(f), /ENOENT/);
});
test("successful exit without compiled output is rejected", (t) => {
  const f = fixture(t);
  assert.throws(
    () => createCompilationEvidence({ ...f, compile: () => ({ status: 0 }) }),
    /ENOENT/,
  );
  assert.equal(existsSync(join(f.runDirectory, "evidence.json")), false);
});
test("failed compilation cannot publish evidence even if it writes a template", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createCompilationEvidence({
        ...f,
        compile: (paths) => {
          f.compile(paths);
          return { status: 1 };
        },
      }),
    /lint\/build failed/,
  );
  assert.equal(existsSync(join(f.runDirectory, "evidence.json")), false);
  assert.throws(() => loadFreshTemplate(f), /ENOENT/);
});
test("unavailable tooling fails closed", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createCompilationEvidence({
        ...f,
        compile: () => ({ status: null, error: new Error("ENOENT") }),
      }),
    /tooling unavailable/,
  );
  assert.equal(existsSync(join(f.runDirectory, "evidence.json")), false);
});
for (const name of ["main.bicep", "modules/registry.bicep"])
  test(`earlier template cannot validate changed ${name}`, (t) => {
    const f = fixture(t);
    createCompilationEvidence(f);
    writeFileSync(join(f.sourceRoot, name), "var adminUserEnabled = true\n");
    assert.throws(() => loadFreshTemplate(f), /Stale compilation/);
  });
test("added dependency or compiler configuration invalidates evidence", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  writeFileSync(join(f.sourceRoot, "bicepconfig.json"), "{}");
  assert.throws(() => loadFreshTemplate(f), /Stale compilation/);
});
test("removed dependency invalidates evidence", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  unlinkSync(join(f.sourceRoot, "modules/registry.bicep"));
  assert.throws(() => loadFreshTemplate(f), /Stale compilation/);
});
test("missing artifact is rejected after successful evidence", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  unlinkSync(join(f.runDirectory, "output/main.json"));
  assert.throws(() => loadFreshTemplate(f), /ENOENT/);
});
test("replaced artifact is rejected", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  writeFileSync(join(f.runDirectory, "output/main.json"), '{"resources":[{}]}');
  assert.throws(() => loadFreshTemplate(f), /Compiled artifact changed/);
});
test("evidence from an earlier run is rejected", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  assert.throws(
    () => loadFreshTemplate({ ...f, runId: "next-run" }),
    /different validation run/,
  );
});
test("failed evidence status is rejected", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  const path = join(f.runDirectory, "evidence.json");
  const evidence = JSON.parse(readFileSync(path));
  writeFileSync(path, JSON.stringify({ ...evidence, status: "failed" }));
  assert.throws(() => loadFreshTemplate(f), /did not succeed/);
});
test("source edits during compilation prevent evidence publication", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createCompilationEvidence({
        ...f,
        compile: (paths) => {
          writeFileSync(join(f.sourceRoot, "main.bicep"), "changed");
          return f.compile(paths);
        },
      }),
    /Source changed during compilation/,
  );
  assert.equal(existsSync(join(f.runDirectory, "evidence.json")), false);
});
test("snapshot edits during compilation prevent evidence publication", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createCompilationEvidence({
        ...f,
        compile: (paths) => {
          writeFileSync(join(paths.snapshot, "main.bicep"), "changed");
          return f.compile(paths);
        },
      }),
    /snapshot changed/,
  );
});
test("occupied validation directory cannot reuse an earlier artifact", (t) => {
  const f = fixture(t);
  createCompilationEvidence(f);
  assert.throws(() => createCompilationEvidence(f), /fresh\/empty/);
});
test("malformed compiler output cannot publish evidence", (t) => {
  const f = fixture(t);
  assert.throws(
    () =>
      createCompilationEvidence({
        ...f,
        compile: ({ output }) => {
          writeFileSync(join(output, "main.json"), "invalid JSON");
          return { status: 0 };
        },
      }),
    SyntaxError,
  );
  assert.equal(existsSync(join(f.runDirectory, "evidence.json")), false);
});
test("direct security suite invocation refuses missing run evidence", () => {
  const env = { ...process.env };
  delete env.REQRO_IAC_RUN_DIRECTORY;
  delete env.REQRO_IAC_RUN_ID;
  // Exercise a standalone invocation, not a nested worker in this Node test run.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      fileURLToPath(new URL("./AcrPullIdentityIac.test.mjs", import.meta.url)),
    ],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 1);
  assert.match(
    result.stdout + result.stderr,
    /fresh compilation evidence is required/,
  );
});

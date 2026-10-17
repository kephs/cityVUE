import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
  rmSync,
  lstatSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

// Include the full local dependency/configuration tree, not only main.bicep.
// Symlinks are refused so compilation cannot silently escape this snapshot.
function sourceFiles(root, relative = "") {
  return readdirSync(join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      assert.ok(!entry.isSymbolicLink(), `Symlink source refused: ${name}`);
      if (entry.isDirectory()) return sourceFiles(root, name);
      assert.ok(entry.isFile(), `Non-file source refused: ${name}`);
      return [[name, readFileSync(join(root, name))]];
    });
}
const fingerprints = (files) =>
  files.map(([name, bytes]) => [name, hash(bytes)]);
const sourceFingerprint = (root) => fingerprints(sourceFiles(root));

export function createCompilationEvidence({
  sourceRoot,
  runDirectory,
  runId,
  compile,
}) {
  assert.ok(runId, "Missing validation run ID");
  assert.deepEqual(
    readdirSync(runDirectory),
    [],
    "Validation directory must be fresh/empty",
  );
  const source = realpathSync(sourceRoot);
  const files = sourceFiles(source);
  assert.ok(
    files.some(([name]) => name === "main.bicep"),
    "Missing main.bicep",
  );
  const inputs = fingerprints(files);
  const snapshot = join(runDirectory, "source");
  const output = join(runDirectory, "output");
  mkdirSync(output);
  for (const [name, bytes] of files) {
    const destination = join(snapshot, name);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: "wx" });
  }
  const result = compile({ snapshot, output });
  assert.ok(
    !result?.error && result?.status === 0,
    "Bicep lint/build failed or tooling unavailable",
  );
  assert.deepEqual(
    sourceFingerprint(source),
    inputs,
    "Source changed during compilation",
  );
  assert.deepEqual(
    sourceFingerprint(snapshot),
    inputs,
    "Compilation snapshot changed",
  );
  const artifact = readFileSync(join(output, "main.json")); // Missing output is fatal.
  const template = JSON.parse(artifact);
  assert.ok(Array.isArray(template.resources), "Invalid compiled ARM template");
  // Published only after successful lint/build AND unchanged inputs AND valid output.
  const evidence = {
    version: 1,
    runId,
    source,
    inputs,
    artifactHash: hash(artifact),
    status: "success",
  };
  writeFileSync(join(runDirectory, "evidence.json"), JSON.stringify(evidence), {
    flag: "wx",
  });
  return evidence;
}

export function loadFreshTemplate({ sourceRoot, runDirectory, runId }) {
  assert.ok(
    runDirectory && runId,
    "Run npm run validate:frontend:iac; fresh compilation evidence is required",
  );
  const evidence = JSON.parse(
    readFileSync(join(runDirectory, "evidence.json"), "utf8"),
  );
  assert.equal(evidence.version, 1, "Unsupported compilation evidence");
  assert.equal(evidence.status, "success", "Compilation did not succeed");
  assert.equal(
    evidence.runId,
    runId,
    "Evidence belongs to a different validation run",
  );
  assert.equal(
    evidence.source,
    realpathSync(sourceRoot),
    "Evidence belongs to a different source tree",
  );
  assert.deepEqual(
    sourceFingerprint(sourceRoot),
    evidence.inputs,
    "Stale compilation: source changed",
  );
  assert.deepEqual(
    sourceFingerprint(join(runDirectory, "source")),
    evidence.inputs,
    "Compilation snapshot changed",
  );
  const artifact = readFileSync(join(runDirectory, "output/main.json"));
  assert.equal(
    hash(artifact),
    evidence.artifactHash,
    "Compiled artifact changed",
  );
  const template = JSON.parse(artifact);
  assert.ok(Array.isArray(template.resources), "Invalid compiled ARM template");
  return template;
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const sourceRoot = join(root, "deploy/azure/frontend");
  const scratch = join(root, ".local-uat");
  mkdirSync(scratch, { recursive: true });
  const scratchRoot = realpathSync(scratch);
  const runDirectory = mkdtempSync(join(scratchRoot, "iac-validation-"));
  const runId = randomUUID();
  try {
    const evidence = createCompilationEvidence({
      sourceRoot,
      runDirectory,
      runId,
      compile: ({ snapshot, output }) => {
        const dockerConfig = join(output, "docker-client");
        mkdirSync(dockerConfig);
        return spawnSync(
          "docker",
          [
            "--config",
            dockerConfig,
            "run",
            "--rm",
            "--mount",
            `type=bind,source=${snapshot},target=/src,readonly`,
            "--mount",
            `type=bind,source=${output},target=/out`,
            "mcr.microsoft.com/azure-cli:2.90.0-azurelinux3.0",
            "sh",
            "-c",
            "az bicep install --version v0.48.1 && az bicep version && az bicep lint --file /src/main.bicep && az bicep build --file /src/main.bicep --outfile /out/main.json",
          ],
          { stdio: "inherit", shell: false },
        );
      },
    });
    loadFreshTemplate({ sourceRoot, runDirectory, runId });
    console.log(
      `Fresh ARM SHA-256: ${evidence.artifactHash}; verified ${evidence.inputs.length} current source files.`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--test",
        "test/PrivateFrontendIacContract.test.mjs",
        "test/AcrPullIdentityIac.test.mjs",
        "test/IacCompilationFreshness.test.mjs",
        "test/NginxImagePin.test.mjs",
        "test/NginxStaticServingContract.test.mjs",
      ],
      {
        cwd: root,
        stdio: "inherit",
        shell: false,
        env: {
          ...process.env,
          REQRO_IAC_RUN_DIRECTORY: runDirectory,
          REQRO_IAC_RUN_ID: runId,
        },
      },
    );
    assert.ok(
      !result.error && result.status === 0,
      "IaC security validation failed",
    );
    loadFreshTemplate({ sourceRoot, runDirectory, runId }); // Refuse edits during tests too.
    console.log(
      "Freshness reverified after tests; deployment remains unauthorized.",
    );
  } finally {
    // Delete only the exact newly created directory within this worktree's scratch root.
    const target = realpathSync(runDirectory);
    assert.ok(
      target.startsWith(scratchRoot + sep) &&
        !lstatSync(runDirectory).isSymbolicLink(),
    );
    rmSync(target, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

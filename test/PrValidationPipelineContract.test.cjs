const assert = require("node:assert/strict");
const {
  readFileSync,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
// Existing server lockfile dependency; absence fails, never skips YAML checks.
const { load } = require("../server/node_modules/js-yaml");
const root = resolve(__dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const entry = load(read("server/azure-pipelines/frontend-iac-pr.yml"));
const template = load(
  read("server/azure-pipelines/templates/frontend-iac-pr.yml"),
);
const parameter = [
  {
    name: "prAgentPool",
    type: "string",
    default: "reqro-pr-validation",
    values: ["reqro-pr-validation"],
  },
];
const validation = "set -euo pipefail\nnpm run validate:frontend:iac\n";
const install =
  "set -euo pipefail\nnpm ci --prefix server --include=dev --ignore-scripts --no-audit --no-fund\nnode -e 'require(\"./server/node_modules/js-yaml\")'\n";
const contracts =
  'set -euo pipefail\nREQRO_TEST_BASH="$BASH" node --test test/PrValidationPipelineContract.test.cjs\n';
const preflight = [
  "set -euo pipefail",
  'test "$BASH_VERSION" = "5.2.15(1)-release"',
  'test "$(node --version)" = "v24.14.0"',
  "npm --version",
  "docker version",
  'test "$(docker info --format \'{{.OSType}}\')" = "linux"',
  "test -f scripts/validate-frontend-iac.mjs",
  'node -e \'const p = require("./package.json"); if (p.scripts["validate:frontend:iac"] !== "node scripts/validate-frontend-iac.mjs") process.exit(1)\'',
  "",
].join("\n");
function keys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}
// Closed structural policy: new resources, tasks, steps or control options must
// receive review. This test is regression evidence, not a platform trust anchor.
function audit(pipeline, body) {
  keys(pipeline, ["trigger", "pr", "parameters", "extends"]);
  assert.equal(pipeline.trigger, "none");
  assert.deepEqual(pipeline.pr, {
    autoCancel: true,
    drafts: true,
    branches: { include: ["main"] },
  });
  assert.deepEqual(pipeline.parameters, parameter);
  assert.deepEqual(pipeline.extends, {
    template: "templates/frontend-iac-pr.yml",
    parameters: { prAgentPool: "${{ parameters.prAgentPool }}" },
  });
  keys(body, ["parameters", "jobs"]);
  assert.deepEqual(body.parameters, parameter);
  assert.equal(body.jobs.length, 1);
  const job = body.jobs[0];
  keys(job, [
    "job",
    "displayName",
    "timeoutInMinutes",
    "workspace",
    "pool",
    "steps",
  ]);
  assert.equal(job.job, "frontend_iac_validation");
  assert.equal(job.timeoutInMinutes, 20);
  assert.deepEqual(job.workspace, { clean: "all" });
  assert.deepEqual(job.pool, {
    name: "${{ parameters.prAgentPool }}",
    demands: ["Agent.OS -equals Linux"],
  });
  assert.equal(job.steps.length, 6);
  assert.deepEqual(job.steps[0], {
    checkout: "self",
    clean: true,
    persistCredentials: false,
    submodules: false,
    lfs: false,
    fetchDepth: 1,
  });
  assert.deepEqual(job.steps[1], {
    task: "UseNode@1",
    inputs: { version: "24.14.0", checkLatest: false },
  });
  for (const [index, script] of [
    [2, preflight],
    [3, install],
    [4, validation],
    [5, contracts],
  ]) {
    keys(job.steps[index], ["bash", "displayName", "workingDirectory"]);
    assert.equal(
      job.steps[index].workingDirectory,
      "$(Build.SourcesDirectory)",
    );
    assert.equal(job.steps[index].bash, script);
  }
}
test("both YAML documents parse and satisfy the bounded PR policy", () =>
  audit(entry, template));
const mutations = [
  [
    "production service connection",
    (p, t) => {
      t.jobs[0].steps.push({
        task: "AzureCLI@2",
        inputs: { azureSubscription: "production" },
      });
    },
  ],
  [
    "production secret variable group",
    (p) => {
      p.variables = [{ group: "reqro-operator-production" }];
    },
  ],
  [
    "credential environment",
    (p, t) => {
      t.jobs[0].steps[4].env = { SYSTEM_ACCESSTOKEN: "$(System.AccessToken)" };
    },
  ],
  [
    "Microsoft-hosted pool fallback",
    (p, t) => {
      t.jobs[0].pool = { vmImage: "ubuntu-latest" };
    },
  ],
  [
    "literal production pool",
    (p, t) => {
      t.jobs[0].pool.name = "production";
    },
  ],
  [
    "unconstrained pool parameter",
    (p) => {
      delete p.parameters[0].values;
    },
  ],
  [
    "production pool parameter choice",
    (p, t) => {
      t.parameters[0].values.push("production");
    },
  ],
  [
    "continueOnError on validation",
    (p, t) => {
      t.jobs[0].steps[4].continueOnError = true;
    },
  ],
  [
    "continueOnError on job",
    (p, t) => {
      t.jobs[0].continueOnError = true;
    },
  ],
  [
    "success fallback",
    (p, t) => {
      t.jobs[0].steps[4].bash += "exit 0\n";
    },
  ],
  [
    "masked command failure",
    (p, t) => {
      t.jobs[0].steps[4].bash = validation.replace(
        "npm run validate:frontend:iac",
        "npm run validate:frontend:iac || true",
      );
    },
  ],
  [
    "skipped validation condition",
    (p, t) => {
      t.jobs[0].steps[4].condition = "false";
    },
  ],
  [
    "deployment job",
    (p, t) => {
      t.jobs[0].deployment = "production";
    },
  ],
  [
    "Azure deployment command",
    (p, t) => {
      t.jobs[0].steps[4].bash += "az deployment group create\n";
    },
  ],
  [
    "cloud role assignment",
    (p, t) => {
      t.jobs[0].steps[4].bash += "az role assignment create\n";
    },
  ],
  [
    "image publication",
    (p, t) => {
      t.jobs[0].steps[4].bash += "docker push registry/image\n";
    },
  ],
  [
    "extra release template",
    (p, t) => {
      t.jobs.push({ template: "operator-job.yml" });
    },
  ],
  [
    "retained checkout credentials",
    (p, t) => {
      t.jobs[0].steps[0].persistCredentials = true;
    },
  ],
  [
    "dirty workspace reuse",
    (p, t) => {
      t.jobs[0].workspace.clean = "outputs";
    },
  ],
  [
    "path-filter check omission",
    (p) => {
      p.pr.paths = { include: ["deploy/**"] };
    },
  ],
  [
    "disabled PR validation",
    (p) => {
      p.pr = "none";
    },
  ],
  [
    "stale-template direct test bypass",
    (p, t) => {
      t.jobs[0].steps[4].bash =
        "node --test test/AcrPullIdentityIac.test.mjs\n";
    },
  ],
];
for (const [name, mutate] of mutations) {
  test(`rejects ${name}`, () => {
    const p = structuredClone(entry);
    const t = structuredClone(template);
    mutate(p, t);
    assert.throws(() => audit(p, t));
  });
}
// Execute the ACTUAL parsed command with a shell-function npm substitute.
// No npm install, Docker or cloud command is executed by these subprocesses.
function runValidation(code) {
  const result = spawnSync(
    process.env.REQRO_TEST_BASH || "bash",
    [
      "--noprofile",
      "--norc",
      "-c",
      `npm() { return ${code}; }\n${template.jobs[0].steps[4].bash}`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, BASH_ENV: "/dev/null" },
    },
  );
  assert.ifError(result.error);
  return result;
}
test("actual validation command preserves npm failure status 37", () =>
  assert.equal(runValidation(37).status, 37));
test("actual validation command preserves missing-tool status 127", () =>
  assert.equal(runValidation(127).status, 127));
test("actual validation command succeeds only when npm succeeds", () =>
  assert.equal(runValidation(0).status, 0));

// Execute every parsed Bash step in order. A failed child terminates the chain,
// matching the pipeline's default succeeded() condition (custom conditions are
// forbidden above). PATH is empty: Docker/cloud executables are unreachable.
// Only Node's package-script check runs for real, against a disposable fixture.
function runSteps({
  missingDocker = false,
  dockerStatus = 0,
  os = "linux",
  nodeVersion = "v24.14.0",
  bashVersion = "5.2.15(1)-release",
  validator = true,
  command = "node scripts/validate-frontend-iac.mjs",
  installStatus = 0,
  parserStatus = 0,
  validationStatus = 0,
  contractStatus = 0,
} = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), "reqro-preflight-"));
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  try {
    mkdirSync(resolve(directory, "scripts"));
    if (validator)
      writeFileSync(
        resolve(directory, "scripts/validate-frontend-iac.mjs"),
        "",
      );
    writeFileSync(
      resolve(directory, "package.json"),
      JSON.stringify({
        scripts: command === null ? {} : { "validate:frontend:iac": command },
      }),
    );
    const setup = `
PATH=/nonexistent-reqro-test-tools
unset -f docker command_not_found_handle
BASH_VERSION=${quote(bashVersion)}
node() {
  if [[ "$1" == --version ]]; then printf '%s\\n' ${quote(nodeVersion)};
  elif [[ "$1" == --test ]]; then echo CONTRACTS; return ${contractStatus};
  elif [[ "$2" == *js-yaml* ]]; then echo PARSER; return ${parserStatus};
  else ${quote(process.execPath.replaceAll("\\", "/"))} "$@"; fi
}
npm() {
  if [[ "$1" == --version ]]; then echo fixture-npm;
  elif [[ "$1" == ci ]]; then echo INSTALL; return ${installStatus};
  else echo IAC; return ${validationStatus}; fi
}
${missingDocker ? "" : `docker() { if [[ "$1" == version ]]; then return ${dockerStatus}; else printf '%s\\n' ${quote(os)}; fi; }`}
`;
    const result = spawnSync(
      process.env.REQRO_TEST_BASH || "bash",
      [
        "--noprofile",
        "--norc",
        "-c",
        setup +
          template.jobs[0].steps
            .slice(2)
            .map(
              (step) =>
                `(\n${step.bash})\nstatus=$?\nif (( status != 0 )); then exit "$status"; fi\n`,
            )
            .join(""),
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: { ...process.env, BASH_ENV: "/dev/null", ENV: "/dev/null" },
      },
    );
    assert.ifError(result.error);
    return result;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [name, options, status] of [
  ["missing Docker executable", { missingDocker: true }, 127],
  ["Docker daemon failure", { dockerStatus: 37 }, 37],
  ["incorrect container OS", { os: "windows" }, 1],
  ["incorrect Node version", { nodeVersion: "v20.20.2" }, 1],
  ["incorrect Bash version", { bashVersion: "4.4.0" }, 1],
  ["missing IaC validator", { validator: false }, 1],
  ["missing package validation command", { command: null }, 1],
  ["incorrect package validation command", { command: "echo skipped" }, 1],
]) {
  test(`parsed preflight fails closed: ${name}`, () => {
    const result = runSteps(options);
    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(result.stdout, /INSTALL|PARSER|IAC|CONTRACTS/);
  });
}
test("parsed preflight with valid prerequisites runs both suites in order", () => {
  const result = runSteps();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /INSTALL\nPARSER\nIAC\nCONTRACTS\n/);
});
for (const [name, options, status, forbidden] of [
  [
    "locked dependency installation fails",
    { installStatus: 38 },
    38,
    /PARSER|IAC|CONTRACTS/,
  ],
  ["locked YAML parser is missing", { parserStatus: 1 }, 1, /IAC|CONTRACTS/],
  ["IaC validation fails", { validationStatus: 39 }, 39, /CONTRACTS/],
  ["PR security contracts fail", { contractStatus: 40 }, 40, /NEVER/],
]) {
  test(`parsed required steps propagate failure: ${name}`, () => {
    const result = runSteps(options);
    assert.equal(result.status, status, result.stderr);
    assert.doesNotMatch(result.stdout, forbidden);
  });
}
test("missing Bash executable fails instead of skipping", () => {
  const result = spawnSync(resolve(tmpdir(), "reqro-no-such-bash", "bash"), [
    "-c",
    preflight,
  ]);
  assert.equal(result.error.code, "ENOENT");
  assert.equal(result.status, null);
});
test("missing checkout-local YAML parser fails suite loading without global fallback", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "reqro-parser-"));
  try {
    mkdirSync(resolve(directory, "test"));
    const path = resolve(
      directory,
      "test/PrValidationPipelineContract.test.cjs",
    );
    writeFileSync(path, readFileSync(__filename));
    const result = spawnSync(process.execPath, [path], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Cannot find module '\.\.\/server\/node_modules\/js-yaml'/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
for (const index of [3, 4, 5]) {
  test(`rejects failure masking or omission of required step ${index}`, () => {
    for (const mutate of [
      (step) => {
        step.continueOnError = true;
      },
      (step) => {
        step.condition = "false";
      },
      (step) => {
        step.bash += "exit 0\n";
      },
    ]) {
      const body = structuredClone(template);
      mutate(body.jobs[0].steps[index]);
      assert.throws(() => audit(entry, body));
    }
    const body = structuredClone(template);
    body.jobs[0].steps.splice(index, 1);
    assert.throws(() => audit(entry, body));
  });
}
test("CODEOWNERS preparation does not fabricate active reviewer assignments", () => {
  const owners = read(".github/CODEOWNERS");
  assert.equal(
    owners.split("\n").filter((line) => line.trim() && !line.startsWith("#"))
      .length,
    0,
  );
  for (const path of [
    "/deploy/azure/",
    "/server/azure-pipelines/",
    "/scripts/validate-frontend-iac.mjs",
    "/test/*Iac*.test.mjs",
    "/test/PrValidationPipelineContract.test.cjs",
    "/.github/CODEOWNERS",
  ])
    assert.ok(owners.includes(`# ${path} <`));
});
test("root and edge activation controls remain disabled", () => {
  const main = read("deploy/azure/frontend/main.bicep");
  assert.match(main, /var deploymentEnabled = false/);
  const modules = main.split("\n").filter((line) => line.startsWith("module "));
  assert.ok(modules.length > 0);
  assert.ok(modules.every((line) => line.includes("if (deploymentEnabled)")));
  const edge = read("deploy/azure/frontend/modules/front-door.bicep");
  assert.equal((edge.match(/enabledState: 'Disabled'/g) || []).length, 3);
  assert.match(edge, /linkToDefaultDomain: 'Disabled'/);
});

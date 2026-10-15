#!/usr/bin/env node
/**
 * F062.2D-2C-3B-2 NEW-a follow-up — the controlled disposable-PostgreSQL
 * validation launcher.
 *
 * Provisions one disposable PostgreSQL 17 container, runs the database tier
 * and the database-dependent E2E tier against it SERIALLY, proves no schema
 * leaked, and tears the container and its anonymous volume down with
 * verification.
 *
 * This launcher is deliberately unforgiving. A missing or partial
 * configuration, a skipped required suite, an unparsable result, an
 * interrupted run or absent teardown evidence are each a FAILURE, because
 * each is a way for an incomplete validation to be mistaken for a passing
 * one. It never reports an incomplete tier as successful.
 *
 * It does not print credentials. `TEST_DATABASE_URL` reaches the child
 * processes through the environment and is redacted wherever it is echoed.
 *
 * Output uses `process.stdout` rather than `console`, matching the lint
 * configuration for `scripts/*.mjs`.
 *
 * Usage:  node scripts/test-db-disposable.mjs [--skip-compile]
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');
const distTest = resolve(serverRoot, 'dist-test', 'test');

const failures = [];
const out = (text) => process.stdout.write(`${text}\n`);
const errOut = (text) => process.stderr.write(`${text}\n`);
const fail = (message) => {
  failures.push(message);
  errOut(`FAIL  ${message}`);
};
const ok = (message) => {
  out(`ok    ${message}`);
};
const info = (message) => {
  out(`info  ${message}`);
};

/** Redacts the password in any URL before it is printed. */
const redact = (text) =>
  String(text).replace(/(postgresql:\/\/[^:]+:)[^@]*@/g, '$1***@');

// ---------------------------------------------------------------------------
// 1. Runtime prerequisites and the trusted image.
// ---------------------------------------------------------------------------
out('== 1. prerequisites ==');

if (!process.argv.includes('--skip-compile')) {
  const tsc = resolve(serverRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    fail('the local TypeScript compiler is missing; run npm install');
  } else {
    const compiled = spawnSync(
      process.execPath,
      [tsc, '-p', 'tsconfig.test.json'],
      { cwd: serverRoot, encoding: 'utf8' },
    );
    if (compiled.status !== 0) {
      fail('test compilation failed');
      errOut(compiled.stdout || compiled.stderr);
    } else ok('test sources compiled');
  }
}

if (failures.length > 0) {
  errOut('\naborting before provisioning: prerequisites failed');
  process.exit(1);
}

const clusterModule = resolve(
  distTest,
  'helpers',
  'f0592-disposable-cluster.js',
);
if (!existsSync(clusterModule)) {
  fail(`the compiled cluster helper is missing at ${clusterModule}`);
  process.exit(1);
}
const { startDisposableCluster, dockerAvailable } = await import(
  pathToFileURL(clusterModule).href
);

if (!dockerAvailable()) {
  fail('Docker is unavailable, so no disposable instance can be provisioned');
  process.exit(1);
}
ok('Docker control plane reachable');

// ---------------------------------------------------------------------------
// 2-3. Ephemeral identity, provisioning.
// ---------------------------------------------------------------------------
out('\n== 2-3. provisioning one disposable PostgreSQL 17 instance ==');

let cluster;
try {
  cluster = await startDisposableCluster();
} catch (error) {
  fail(`provisioning failed: ${redact(error.message)}`);
  process.exit(1);
}
ok(`container ${cluster.container} on 127.0.0.1:${cluster.port}`);
info(`image pinned to ${cluster.imageId}`);

let teardown = null;
let skewMs = null;

try {
  // -------------------------------------------------------------------------
  // 4. Verify the instance against the same predicate the suites use.
  // -------------------------------------------------------------------------
  out('\n== 4. disposable-instance evidence ==');
  const evidenceModule = resolve(
    distTest,
    'helpers',
    'disposable-cluster-evidence.js',
  );
  const { collectDisposableEvidence, refuseUnlessDisposable } = await import(
    pathToFileURL(evidenceModule).href
  );
  const pgModule = await import('pg');
  const PoolCtor = pgModule.default?.Pool ?? pgModule.Pool;

  const admin = new PoolCtor({ connectionString: cluster.testUrl, max: 2 });
  try {
    const evidence = await collectDisposableEvidence(
      admin,
      cluster.testUrl,
      cluster.expectations(),
    );
    const refusal = refuseUnlessDisposable(evidence);
    if (refusal === null)
      ok(
        'database, role, loopback target, nonce, container identity, image digest, port binding, timestamps and anonymous storage all verified',
      );
    else fail(`evidence refused: ${refusal}`);

    // NEW-b context only. Recorded, never corrected here: a container clock
    // behind the host makes `occurred_at <= created_at` violable.
    const before = Date.now();
    const clock = await admin.query('select clock_timestamp() now');
    const after = Date.now();
    skewMs = new Date(clock.rows[0].now).getTime() - (before + after) / 2;
    info(`host-to-container clock skew: ${skewMs.toFixed(0)} ms`);
    if (skewMs < -250)
      info(
        'the container clock trails the host; NEW-b check violations are environmentally possible',
      );
  } catch (error) {
    fail(`evidence collection failed: ${redact(error.message)}`);
  } finally {
    await admin.end().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // 5. Pre-test census.
  // -------------------------------------------------------------------------
  out('\n== 5. pre-test schema census ==');
  const beforeCount = await cluster.census();
  if (beforeCount === 0) ok('clean baseline: zero non-system schemas');
  else fail(`expected a clean database, found ${beforeCount} schema(s)`);

  // -------------------------------------------------------------------------
  // 6-7. The tiers, serially.
  // -------------------------------------------------------------------------
  /**
   * `minimum` closes a silent-success path. `node --test` over a directory
   * holding no test files reports `# tests 0`, zero failures and exit 0, so a
   * stale, emptied or mis-resolved compile directory would otherwise be
   * indistinguishable from a clean pass. A floor makes "ran nothing" a
   * failure. It is a floor rather than an equality so legitimately added
   * tests do not break the harness, while a collapse in coverage does.
   */
  const runTier = (label, directory, minimum) => {
    out(`\n== ${label} ==`);
    const cwd = resolve(distTest, directory);
    if (!existsSync(cwd)) {
      fail(`${label}: compiled directory missing at ${cwd}`);
      return null;
    }
    const result = spawnSync(
      process.execPath,
      ['--test', '--test-concurrency=1', '--test-reporter=tap'],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, ...cluster.environment() },
      },
    );
    if (result.error) {
      fail(`${label}: runner could not start: ${result.error.message}`);
      return null;
    }
    const output = `${result.stdout}\n${result.stderr}`;
    const number = (key) => {
      const match = output.match(new RegExp(`^# ${key} (\\d+)$`, 'm'));
      return match === null ? null : Number(match[1]);
    };
    const counts = {
      tests: number('tests'),
      pass: number('pass'),
      fail: number('fail'),
      skipped: number('skipped'),
      cancelled: number('cancelled'),
      todo: number('todo'),
    };
    // An interrupted run has no summary. That is a failure, never a pass.
    if (counts.tests === null || counts.pass === null || counts.fail === null) {
      fail(`${label}: no parsable summary, so the run is not evidence`);
      errOut(output.slice(-4000));
      return null;
    }
    const notOk = [...output.matchAll(/^not ok \d+ - (.*)$/gm)].map(
      (match) => match[1],
    );
    out(
      `      tests ${counts.tests} | pass ${counts.pass} | fail ${counts.fail} | skipped ${counts.skipped} | cancelled ${counts.cancelled}`,
    );
    if (counts.tests < minimum)
      fail(
        `${label}: only ${counts.tests} test(s) ran, below the required floor of ${minimum}; the suite did not execute`,
      );
    if (counts.pass !== counts.tests)
      fail(
        `${label}: ${counts.pass} passed of ${counts.tests} run, so the tier is not fully green`,
      );
    if (counts.fail > 0) fail(`${label}: ${counts.fail} failing test(s)`);
    if (counts.cancelled > 0)
      fail(`${label}: ${counts.cancelled} cancelled test(s) — interrupted run`);
    if (counts.skipped > 0)
      fail(
        `${label}: ${counts.skipped} skipped test(s); a required suite that did not execute is not a pass`,
      );
    if (
      counts.fail === 0 &&
      counts.skipped === 0 &&
      counts.cancelled === 0 &&
      counts.pass === counts.tests &&
      counts.tests >= minimum
    )
      ok(`${label}: ${counts.pass}/${counts.tests}, zero skips`);
    for (const name of notOk) out(`      not ok: ${name}`);
    // SQLSTATE 23514 on the outbox clock constraint is NEW-b, out of scope
    // here, and must be reported as itself rather than investigated as a
    // disposable-instance defect.
    if (/23514/.test(output) && /occurred_at/.test(output))
      info(
        `${label}: SQLSTATE 23514 on occurred_at observed — classified as NEW-b (timestamp race), not a disposable-instance failure`,
      );
    return counts;
  };

  // Floors set from the verified inventories (1007 database, 115 E2E), with
  // headroom so adding tests does not trip the gate.
  const database = runTier('6. database tier (serial)', 'database', 1000);
  const e2e = runTier('7. E2E tier (serial)', 'e2e', 110);

  // -------------------------------------------------------------------------
  // 8. Post-test census: the NEW-a leak proof.
  // -------------------------------------------------------------------------
  out('\n== 8. post-test schema census ==');
  const afterCount = await cluster.census();
  if (afterCount < 0) fail('the post-test census could not be read');
  else if (afterCount === beforeCount)
    ok(`zero leaked schemas (${beforeCount} before, ${afterCount} after)`);
  else fail(`schema leak: ${beforeCount} before, ${afterCount} after`);

  // -------------------------------------------------------------------------
  // 9. Outcome record.
  // -------------------------------------------------------------------------
  out('\n== 9. recorded outcomes ==');
  for (const [label, counts] of [
    ['database', database],
    ['e2e', e2e],
  ]) {
    if (counts === null) {
      out(`      ${label}: NOT EXECUTED / UNPARSABLE`);
      continue;
    }
    out(
      `      ${label}: tests=${counts.tests} pass=${counts.pass} fail=${counts.fail} skipped=${counts.skipped} cancelled=${counts.cancelled} todo=${counts.todo}`,
    );
  }
} catch (error) {
  fail(`validation aborted: ${redact(error.stack ?? error.message)}`);
} finally {
  // -------------------------------------------------------------------------
  // 10-11. Authorized teardown with removal evidence.
  // -------------------------------------------------------------------------
  out('\n== 10-11. teardown ==');
  try {
    teardown = await cluster.destroy();
  } catch (error) {
    fail(`teardown threw: ${redact(error.message)}`);
  }
  if (teardown === null) fail('no teardown evidence was produced');
  else if (teardown.refusal !== null)
    fail(`teardown refused: ${teardown.refusal}`);
  else {
    if (teardown.containerRemoved) ok('container no longer exists');
    else fail('the container still exists after teardown');
    if (teardown.volumeRemoved) ok('anonymous volume no longer exists');
    else fail(`the anonymous volume ${teardown.volumeName} still exists`);
  }
  if (skewMs !== null) out(`      clock skew: ${skewMs.toFixed(0)} ms`);
}

out('\n== result ==');
if (failures.length === 0) {
  out('PASS — complete disposable validation, zero skips, clean teardown');
  process.exit(0);
}
errOut(`FAILED — ${failures.length} problem(s):`);
for (const message of failures) errOut(`  - ${message}`);
process.exit(1);

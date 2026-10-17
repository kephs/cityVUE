#!/usr/bin/env node
/**
 * F062 — the mandatory disposable-PostgreSQL validation gate.
 *
 * Provisions one disposable PostgreSQL 17 container, runs the database tier
 * and the database-dependent E2E tier against it SERIALLY, proves no schema
 * leaked, and tears the container and its anonymous volume down with
 * verification.
 *
 * The verdict is deliberately unforgiving, because every lenient reading is a
 * way for an incomplete validation to be mistaken for a passing one. The two
 * decisions that matter -- "did this tier really pass?" and "did this run
 * really pass?" -- are PURE functions (`evaluateTier`, `evaluateRun`),
 * exported so they can be proven against fabricated inputs rather than only
 * exercised by a happy-path run.
 *
 * Importing this module has no side effects: `main()` runs only when the file
 * is the process entry point, so the unit tests can load the verdict logic
 * without provisioning anything.
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

/**
 * The mandatory tiers and their floors. Held here rather than at the call
 * site so a caller cannot pair a tier with the wrong floor, and so an
 * unrecognised tier name is itself a refusal.
 *
 * The floors close a silent-success path: `node --test` over a directory
 * holding no test files reports `# tests 0`, zero failures and exit 0, so a
 * stale, emptied or mis-resolved compile directory would otherwise be
 * indistinguishable from a clean pass. Floors rather than equalities, so
 * legitimately added tests do not trip the gate while a collapse in coverage
 * does. Reviewed against measured inventories of 1007 and 115.
 */
export const MANDATORY_TIERS = Object.freeze({
  database: Object.freeze({ directory: 'database', minimum: 1000 }),
  e2e: Object.freeze({ directory: 'e2e', minimum: 110 }),
});

const SUMMARY_KEYS = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];

/**
 * Reads the TAP trailer as DATA. Reports ambiguity and truncation rather than
 * silently taking a first match, because a duplicated or partial summary is
 * not evidence.
 */
export function parseTapSummary(output) {
  const text = typeof output === 'string' ? output : '';
  const counts = {};
  const ambiguous = [];
  const missing = [];
  for (const key of SUMMARY_KEYS) {
    const found = [...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].map(
      (match) => Number(match[1]),
    );
    const distinct = [...new Set(found)];
    if (found.length === 0) {
      missing.push(key);
      counts[key] = null;
    } else if (distinct.length > 1) {
      ambiguous.push(key);
      counts[key] = null;
    } else {
      counts[key] = distinct[0];
    }
  }
  return {
    counts,
    ambiguous,
    missing,
    // `# duration_ms` is the last line the reporter emits, so its absence
    // alongside a present summary means the output was cut off.
    complete: /^# duration_ms /m.test(text),
    hasPlan: /^1\.\.\d+$/m.test(text),
  };
}

/**
 * Pure. The verdict for one mandatory tier.
 *
 * `reasons` is empty exactly when the tier genuinely passed. Anything absent,
 * inconsistent, partial, skipped or cancelled produces a reason.
 */
export function evaluateTier(input) {
  const reasons = [];
  const tier = input?.tier;
  const spec = Object.prototype.hasOwnProperty.call(MANDATORY_TIERS, tier)
    ? MANDATORY_TIERS[tier]
    : undefined;
  if (spec === undefined) {
    reasons.push(
      `unknown mandatory tier ${JSON.stringify(tier ?? null)}; refusing to treat it as validated`,
    );
    return { ok: false, tier, counts: null, reasons };
  }

  if (input.directoryPresent === false)
    reasons.push(`${tier}: the compiled test directory is missing`);
  if (input.spawnError)
    reasons.push(
      `${tier}: the test runner could not start (${input.spawnError})`,
    );
  // A non-zero runner status is independent evidence; it must not be excused
  // by a summary that happens to look clean.
  if (input.status !== 0)
    reasons.push(
      `${tier}: the test runner exited with status ${JSON.stringify(input.status ?? null)}`,
    );

  const summary = parseTapSummary(input.output);
  const { counts } = summary;
  if (summary.missing.length > 0)
    reasons.push(
      `${tier}: the TAP summary is missing ${summary.missing.join(', ')}, so the run is not evidence`,
    );
  if (summary.ambiguous.length > 0)
    reasons.push(
      `${tier}: the TAP summary reports conflicting values for ${summary.ambiguous.join(', ')}`,
    );
  if (!summary.complete)
    reasons.push(`${tier}: the TAP output is truncated or interrupted`);
  if (!summary.hasPlan) reasons.push(`${tier}: the TAP plan line is absent`);

  if (counts.tests !== null) {
    if (counts.tests <= 0)
      reasons.push(
        `${tier}: no tests were discovered, so nothing was validated`,
      );
    else if (counts.tests < spec.minimum)
      reasons.push(
        `${tier}: only ${counts.tests} test(s) ran, below the reviewed floor of ${spec.minimum}`,
      );
  }
  if (counts.pass !== null && counts.pass < 0)
    reasons.push(`${tier}: a negative pass count is not evidence`);
  if (
    counts.pass !== null &&
    counts.tests !== null &&
    counts.pass !== counts.tests
  )
    reasons.push(
      `${tier}: ${counts.pass} passed of ${counts.tests} run, so the tier is not fully green`,
    );
  if (counts.fail !== null && counts.fail > 0)
    reasons.push(`${tier}: ${counts.fail} failing test(s)`);
  if (counts.cancelled !== null && counts.cancelled > 0)
    reasons.push(
      `${tier}: ${counts.cancelled} cancelled test(s) — interrupted run`,
    );
  if (counts.skipped !== null && counts.skipped > 0)
    reasons.push(
      `${tier}: ${counts.skipped} skipped test(s); a required suite that did not execute is not a pass`,
    );

  return { ok: reasons.length === 0, tier, counts, reasons };
}

/**
 * Pure. The verdict for the whole run.
 *
 * Requires BOTH mandatory tiers to be present and passing, so a green unit
 * suite -- or a tier that silently never ran -- can never stand in for
 * database and E2E validation.
 */
export function evaluateRun(input) {
  const reasons = [];

  if (input?.evidence?.verified !== true)
    reasons.push(
      `disposable-instance evidence was not verified${
        input?.evidence?.refusal ? `: ${input.evidence.refusal}` : ''
      }`,
    );

  const before = input?.census?.before;
  const after = input?.census?.after;
  if (typeof before !== 'number' || before < 0)
    reasons.push('the pre-test schema census is missing or unreadable');
  else if (before !== 0)
    reasons.push(`the database was not a clean baseline: ${before} schema(s)`);
  if (typeof after !== 'number' || after < 0)
    reasons.push('the post-test schema census is missing or unreadable');
  else if (typeof before === 'number' && after > before)
    reasons.push(`${after - before} schema(s) leaked during the run`);
  else if (typeof before === 'number' && after !== before)
    reasons.push(`the schema census changed from ${before} to ${after}`);

  const verdicts = Array.isArray(input?.tiers) ? input.tiers : [];
  for (const name of Object.keys(MANDATORY_TIERS)) {
    const verdict = verdicts.find((candidate) => candidate?.tier === name);
    if (verdict === undefined) {
      reasons.push(`the mandatory ${name} tier did not run`);
      continue;
    }
    if (!verdict.ok)
      reasons.push(...(verdict.reasons ?? [`the ${name} tier did not pass`]));
  }

  const teardown = input?.teardown;
  if (teardown === null || teardown === undefined)
    reasons.push('no teardown evidence was produced');
  else if (teardown.refusal)
    reasons.push(`teardown refused: ${teardown.refusal}`);
  else {
    if (teardown.containerRemoved !== true)
      reasons.push('removal of the owned container was not verified');
    if (teardown.volumeRemoved !== true)
      reasons.push('removal of the owned anonymous volume was not verified');
  }

  return { ok: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// Orchestration. Runs only as the entry point.
// ---------------------------------------------------------------------------

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const serverRoot = resolve(here, '..');
  const distTest = resolve(serverRoot, 'dist-test', 'test');

  const out = (text) => process.stdout.write(`${text}\n`);
  const errOut = (text) => process.stderr.write(`${text}\n`);
  const redact = (text) =>
    String(text).replace(/(postgresql:\/\/[^:]+:)[^@]*@/g, '$1***@');

  const hardFailures = [];
  const fail = (message) => {
    hardFailures.push(message);
    errOut(`FAIL  ${message}`);
  };
  const ok = (message) => out(`ok    ${message}`);
  const info = (message) => out(`info  ${message}`);

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
  if (hardFailures.length > 0) {
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

  const evidence = { verified: false, refusal: null };
  const census = { before: null, after: null };
  const tiers = [];
  let teardown = null;
  let skewMs = null;

  try {
    out('\n== 4. disposable-instance evidence ==');
    const { collectDisposableEvidence, refuseUnlessDisposable } = await import(
      pathToFileURL(
        resolve(distTest, 'helpers', 'disposable-cluster-evidence.js'),
      ).href
    );
    const pgModule = await import('pg');
    const PoolCtor = pgModule.default?.Pool ?? pgModule.Pool;
    const admin = new PoolCtor({ connectionString: cluster.testUrl, max: 2 });
    try {
      const collected = await collectDisposableEvidence(
        admin,
        cluster.testUrl,
        cluster.expectations(),
      );
      evidence.refusal = refuseUnlessDisposable(collected);
      evidence.verified = evidence.refusal === null;
      if (evidence.verified)
        ok(
          'database, role, loopback target, nonce, container identity, image digest, port binding, timestamps and anonymous storage all verified',
        );
      else fail(`evidence refused: ${evidence.refusal}`);

      // NEW-b context only. Recorded, never corrected here: a container clock
      // behind the host makes `occurred_at <= created_at` violable.
      const t0 = Date.now();
      const clock = await admin.query('select clock_timestamp() now');
      const t1 = Date.now();
      skewMs = new Date(clock.rows[0].now).getTime() - (t0 + t1) / 2;
      info(`host-to-container clock skew: ${skewMs.toFixed(0)} ms`);
      if (skewMs < -250)
        info(
          'the container clock trails the host; NEW-b check violations are environmentally possible',
        );
    } catch (error) {
      evidence.refusal = redact(error.message);
      fail(`evidence collection failed: ${evidence.refusal}`);
    } finally {
      await admin.end().catch(() => undefined);
    }

    out('\n== 5. pre-test schema census ==');
    census.before = await cluster.census();
    if (census.before === 0) ok('clean baseline: zero non-system schemas');
    else fail(`expected a clean database, found ${census.before} schema(s)`);

    for (const [name, spec] of Object.entries(MANDATORY_TIERS)) {
      out(`\n== ${name} tier (serial, floor ${spec.minimum}) ==`);
      const cwd = resolve(distTest, spec.directory);
      const directoryPresent = existsSync(cwd);
      let status = null;
      let spawnError = null;
      let output = '';
      if (directoryPresent) {
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
        status = result.status;
        spawnError = result.error ? result.error.message : null;
        output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
      }
      const verdict = evaluateTier({
        tier: name,
        directoryPresent,
        status,
        spawnError,
        output,
      });
      tiers.push(verdict);
      const counts = verdict.counts;
      if (counts !== null)
        out(
          `      tests ${counts.tests} | pass ${counts.pass} | fail ${counts.fail} | skipped ${counts.skipped} | cancelled ${counts.cancelled}`,
        );
      for (const name2 of [...output.matchAll(/^not ok \d+ - (.*)$/gm)].map(
        (match) => match[1],
      ))
        out(`      not ok: ${name2}`);
      if (verdict.ok) ok(`${name}: ${counts.pass}/${counts.tests}, zero skips`);
      else for (const reason of verdict.reasons) fail(reason);
      // SQLSTATE 23514 on the outbox clock constraint is NEW-b, out of scope
      // here, and must be reported as itself rather than investigated as a
      // disposable-instance defect.
      if (/23514/.test(output) && /occurred_at/.test(output))
        info(
          `${name}: SQLSTATE 23514 on occurred_at observed — classified as NEW-b (timestamp race), not a disposable-instance failure`,
        );
    }

    out('\n== post-test schema census ==');
    census.after = await cluster.census();
    if (census.after === census.before)
      ok(
        `zero leaked schemas (${census.before} before, ${census.after} after)`,
      );
    else fail(`schema census changed: ${census.before} -> ${census.after}`);
  } catch (error) {
    fail(`validation aborted: ${redact(error.stack ?? error.message)}`);
  } finally {
    // Cleanup is attempted on every outcome, including a failing tier.
    out('\n== teardown ==');
    try {
      teardown = await cluster.destroy();
    } catch (error) {
      fail(`teardown threw: ${redact(error.message)}`);
    }
    if (teardown === null || teardown === undefined)
      fail('no teardown evidence was produced');
    else if (teardown.refusal !== null)
      fail(`teardown refused: ${teardown.refusal}`);
    else {
      if (teardown.containerRemoved) ok('container no longer exists');
      else fail('the container still exists after teardown');
      if (teardown.volumeRemoved) ok('anonymous volume no longer exists');
      else fail(`the anonymous volume ${teardown.volumeName} still exists`);
    }
  }

  out('\n== recorded outcomes ==');
  for (const verdict of tiers)
    out(
      verdict.counts === null
        ? `      ${verdict.tier}: NOT EXECUTED`
        : `      ${verdict.tier}: tests=${verdict.counts.tests} pass=${verdict.counts.pass} fail=${verdict.counts.fail} skipped=${verdict.counts.skipped} cancelled=${verdict.counts.cancelled}`,
    );
  if (skewMs !== null) out(`      clock skew: ${skewMs.toFixed(0)} ms`);

  // The authoritative verdict. Independent of the running tally, so a missing
  // tier or unverified teardown cannot pass by omission.
  const run = evaluateRun({ evidence, census, tiers, teardown });
  out('\n== result ==');
  if (run.ok && hardFailures.length === 0) {
    out('PASS — complete disposable validation, zero skips, clean teardown');
    process.exit(0);
  }
  const reasons = [...new Set([...run.reasons, ...hardFailures])];
  errOut(`FAILED — ${reasons.length} problem(s):`);
  for (const reason of reasons) errOut(`  - ${reason}`);
  process.exit(1);
}

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url)
  await main();

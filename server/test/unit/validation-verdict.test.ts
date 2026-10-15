import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * F062 — the mandatory validation verdict.
 *
 * `node --test` exits 0 when a required suite SKIPS and when NO tests are
 * discovered, so an exit code cannot distinguish "passed" from "never ran".
 * That is not hypothetical: `docs/ROADMAP.md` records a database tier that
 * reported 20 tests, 0 passed, 20 skipped and still exited 0, and the only
 * thing that caught it was a human writing "NOT EXECUTED" in prose.
 *
 * `evaluateTier` and `evaluateRun` are the machine-checked replacement for
 * that diligence. They are pure, so every rejection below is proven against
 * FABRICATED input: no container is provisioned, no database is contacted and
 * no suite is run in order to prove that an incomplete run would be refused.
 *
 * The launcher is a `.mjs` outside the TypeScript program, so it is loaded by
 * dynamic import. Importing it must have no side effects -- it guards
 * `main()` behind an entry-point check -- and that property is itself
 * asserted below.
 */

interface TierCounts {
  tests: number | null;
  pass: number | null;
  fail: number | null;
  cancelled: number | null;
  skipped: number | null;
  todo: number | null;
}

interface TierVerdict {
  ok: boolean;
  tier: string | undefined;
  counts: TierCounts | null;
  reasons: string[];
}

interface RunVerdict {
  ok: boolean;
  reasons: string[];
}

interface LauncherModule {
  MANDATORY_TIERS: Record<string, { directory: string; minimum: number }>;
  parseTapSummary: (output: unknown) => {
    counts: TierCounts;
    ambiguous: string[];
    missing: string[];
    complete: boolean;
    hasPlan: boolean;
  };
  evaluateTier: (input: unknown) => TierVerdict;
  evaluateRun: (input: unknown) => RunVerdict;
}

const launcherPath = resolve(
  __dirname,
  '../../../scripts/test-db-disposable.mjs',
);

async function launcher(): Promise<LauncherModule> {
  return (await import(pathToFileURL(launcherPath).href)) as LauncherModule;
}

interface TapTotals {
  tests: number;
  pass: number;
  fail: number;
  cancelled: number;
  skipped: number;
  todo: number;
}

/** A complete, clean TAP trailer for `count` passing tests. */
function tap(count: number, overrides: Partial<TapTotals> = {}): string {
  const values: TapTotals = {
    tests: count,
    pass: count,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    ...overrides,
  };
  return [
    'TAP version 13',
    `1..${String(values.tests)}`,
    `# tests ${String(values.tests)}`,
    '# suites 0',
    `# pass ${String(values.pass)}`,
    `# fail ${String(values.fail)}`,
    `# cancelled ${String(values.cancelled)}`,
    `# skipped ${String(values.skipped)}`,
    `# todo ${String(values.todo)}`,
    '# duration_ms 1234.5',
  ].join('\n');
}

function tierInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    tier: 'database',
    directoryPresent: true,
    status: 0,
    spawnError: null,
    output: tap(1007),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Import safety.
// ---------------------------------------------------------------------------

test('loading the launcher provisions nothing and exports the verdicts', async () => {
  const module = await launcher();
  assert.equal(typeof module.evaluateTier, 'function');
  assert.equal(typeof module.evaluateRun, 'function');
  assert.deepEqual(Object.keys(module.MANDATORY_TIERS).sort(), [
    'database',
    'e2e',
  ]);
  assert.equal(module.MANDATORY_TIERS.database?.minimum, 1000);
  assert.equal(module.MANDATORY_TIERS.e2e?.minimum, 110);
});

// ---------------------------------------------------------------------------
// evaluateTier — positive.
// ---------------------------------------------------------------------------

test('a complete database tier at 1007/1007 passes', async () => {
  const { evaluateTier } = await launcher();
  const verdict = evaluateTier(tierInput({ output: tap(1007) }));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.counts?.tests, 1007);
});

test('a complete E2E tier at 115/115 passes', async () => {
  const { evaluateTier } = await launcher();
  const verdict = evaluateTier(tierInput({ tier: 'e2e', output: tap(115) }));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

test('a tier exactly at its floor passes, and one below it does not', async () => {
  const { evaluateTier } = await launcher();
  // Exactly at the floor is valid: the floor is a minimum, not an exclusion.
  assert.equal(evaluateTier(tierInput({ output: tap(1000) })).ok, true);
  assert.equal(
    evaluateTier(tierInput({ tier: 'e2e', output: tap(110) })).ok,
    true,
  );
  // One below is not.
  assert.equal(evaluateTier(tierInput({ output: tap(999) })).ok, false);
  assert.equal(
    evaluateTier(tierInput({ tier: 'e2e', output: tap(109) })).ok,
    false,
  );
});

// ---------------------------------------------------------------------------
// evaluateTier — negative.
// ---------------------------------------------------------------------------

test('an incomplete or inconsistent tier is refused, with the cause named', async () => {
  const { evaluateTier } = await launcher();
  const cases: readonly {
    readonly name: string;
    readonly reason: string;
    readonly input: unknown;
  }[] = [
    // THE original silent-success failure: an empty directory reports zero
    // tests, zero failures and exit 0. This case must stay closed.
    {
      name: 'zero tests discovered',
      reason: 'no tests were discovered',
      input: tierInput({ output: tap(0) }),
    },
    {
      name: 'below the database floor',
      reason: 'below the reviewed floor of 1000',
      input: tierInput({ output: tap(12) }),
    },
    {
      name: 'below the E2E floor',
      reason: 'below the reviewed floor of 110',
      input: tierInput({ tier: 'e2e', output: tap(9) }),
    },
    {
      name: 'pass does not equal tests',
      reason: 'so the tier is not fully green',
      input: tierInput({ output: tap(1007, { pass: 1006 }) }),
    },
    {
      name: 'a failing test',
      reason: 'failing test(s)',
      input: tierInput({ output: tap(1007, { pass: 1006, fail: 1 }) }),
    },
    {
      name: 'a skipped required test',
      reason: 'did not execute is not a pass',
      input: tierInput({ output: tap(1007, { pass: 1006, skipped: 1 }) }),
    },
    {
      name: 'a cancelled test',
      reason: 'interrupted run',
      input: tierInput({ output: tap(1007, { pass: 1006, cancelled: 1 }) }),
    },
    {
      name: 'a missing TAP summary',
      reason: 'is missing',
      input: tierInput({ output: 'TAP version 13\n1..5\nok 1 - something' }),
    },
    {
      name: 'an empty output',
      reason: 'is missing',
      input: tierInput({ output: '' }),
    },
    {
      name: 'truncated output with no duration trailer',
      reason: 'truncated or interrupted',
      input: tierInput({
        output: tap(1007).replace('# duration_ms 1234.5', ''),
      }),
    },
    {
      name: 'a missing TAP plan line',
      reason: 'plan line is absent',
      input: tierInput({ output: tap(1007).replace('1..1007', '') }),
    },
    {
      name: 'ambiguous duplicate summary fields',
      reason: 'conflicting values',
      input: tierInput({ output: `${tap(1007)}\n# tests 3` }),
    },
    {
      name: 'an unknown tier',
      reason: 'unknown mandatory tier',
      input: tierInput({ tier: 'unit' }),
    },
    {
      name: 'an absent tier name',
      reason: 'unknown mandatory tier',
      input: tierInput({ tier: undefined }),
    },
    {
      name: 'a non-zero runner exit status',
      reason: 'exited with status 1',
      input: tierInput({ status: 1 }),
    },
    {
      name: 'a null runner exit status',
      reason: 'exited with status null',
      input: tierInput({ status: null }),
    },
    {
      name: 'a runner that could not spawn',
      reason: 'could not start',
      input: tierInput({ status: null, spawnError: 'ENOENT' }),
    },
    {
      name: 'a missing compiled directory',
      reason: 'compiled test directory is missing',
      input: tierInput({ directoryPresent: false, status: null, output: '' }),
    },
  ];
  for (const entry of cases) {
    const verdict = evaluateTier(entry.input);
    assert.equal(verdict.ok, false, `${entry.name} must be refused`);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(entry.reason)),
      `${entry.name} refused for the wrong reason: ${verdict.reasons.join(' | ')}`,
    );
  }
});

test('a clean summary cannot excuse a non-zero runner status', async () => {
  const { evaluateTier } = await launcher();
  // Defence in depth: the runner's own status is independent evidence.
  const verdict = evaluateTier(tierInput({ status: 7, output: tap(1007) }));
  assert.equal(verdict.ok, false);
});

// ---------------------------------------------------------------------------
// evaluateRun.
// ---------------------------------------------------------------------------

function runInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    evidence: { verified: true, refusal: null },
    census: { before: 0, after: 0 },
    tiers: [
      { ok: true, tier: 'database', reasons: [] },
      { ok: true, tier: 'e2e', reasons: [] },
    ],
    teardown: {
      refusal: null,
      containerRemoved: true,
      volumeRemoved: true,
      volumeName: 'a'.repeat(64),
    },
    ...overrides,
  };
}

test('a complete run with both tiers and clean teardown passes', async () => {
  const { evaluateRun } = await launcher();
  const verdict = evaluateRun(runInput());
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

test('an incomplete run is refused, with the cause named', async () => {
  const { evaluateRun } = await launcher();
  const cases: readonly {
    readonly name: string;
    readonly reason: string;
    readonly input: unknown;
  }[] = [
    {
      name: 'unverified disposable evidence',
      reason: 'evidence was not verified',
      input: runInput({
        evidence: {
          verified: false,
          refusal: 'the server nonce does not match',
        },
      }),
    },
    {
      name: 'absent evidence entirely',
      reason: 'evidence was not verified',
      input: runInput({ evidence: undefined }),
    },
    {
      name: 'a failed pre-test census',
      reason: 'pre-test schema census is missing',
      input: runInput({ census: { before: null, after: 0 } }),
    },
    {
      name: 'a failed post-test census',
      reason: 'post-test schema census is missing',
      input: runInput({ census: { before: 0, after: null } }),
    },
    {
      name: 'an unclean baseline',
      reason: 'not a clean baseline',
      input: runInput({ census: { before: 380, after: 380 } }),
    },
    {
      name: 'leaked schemas',
      reason: 'schema(s) leaked during the run',
      input: runInput({ census: { before: 0, after: 57 } }),
    },
    // A green unit suite must never substitute for these.
    {
      name: 'the database tier never ran',
      reason: 'the mandatory database tier did not run',
      input: runInput({ tiers: [{ ok: true, tier: 'e2e', reasons: [] }] }),
    },
    {
      name: 'the E2E tier never ran',
      reason: 'the mandatory e2e tier did not run',
      input: runInput({ tiers: [{ ok: true, tier: 'database', reasons: [] }] }),
    },
    {
      name: 'no tiers at all',
      reason: 'did not run',
      input: runInput({ tiers: [] }),
    },
    {
      name: 'a failing tier',
      reason: 'database: 3 failing test(s)',
      input: runInput({
        tiers: [
          {
            ok: false,
            tier: 'database',
            reasons: ['database: 3 failing test(s)'],
          },
          { ok: true, tier: 'e2e', reasons: [] },
        ],
      }),
    },
    {
      name: 'missing teardown evidence',
      reason: 'no teardown evidence',
      input: runInput({ teardown: null }),
    },
    {
      name: 'refused teardown',
      reason: 'teardown refused',
      input: runInput({
        teardown: {
          refusal: 'refusing teardown: not ours',
          containerRemoved: false,
          volumeRemoved: false,
        },
      }),
    },
    {
      name: 'unverified container removal',
      reason: 'removal of the owned container was not verified',
      input: runInput({
        teardown: {
          refusal: null,
          containerRemoved: false,
          volumeRemoved: true,
        },
      }),
    },
    {
      name: 'unverified volume removal',
      reason: 'removal of the owned anonymous volume was not verified',
      input: runInput({
        teardown: {
          refusal: null,
          containerRemoved: true,
          volumeRemoved: false,
        },
      }),
    },
  ];
  for (const entry of cases) {
    const verdict = evaluateRun(entry.input);
    assert.equal(verdict.ok, false, `${entry.name} must be refused`);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(entry.reason)),
      `${entry.name} refused for the wrong reason: ${verdict.reasons.join(' | ')}`,
    );
  }
});

test('both verdicts fail closed on empty input', async () => {
  const { evaluateTier, evaluateRun } = await launcher();
  assert.equal(evaluateTier({}).ok, false);
  assert.equal(evaluateTier(undefined).ok, false);
  assert.equal(evaluateRun({}).ok, false);
  assert.equal(evaluateRun(undefined).ok, false);
});

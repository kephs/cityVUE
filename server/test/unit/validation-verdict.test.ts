import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  APPLICATION_SCHEMAS,
  evaluateSchemaCensus,
  verifyCleanup,
  type CleanupProbes,
  type DockerResult,
} from '../helpers/f0592-disposable-cluster.js';

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
 * F060 compatibility adds a third pure decision, `evaluateCapture`, and the
 * record builder it judges, `buildInvocationEvidence`. The same discipline
 * applies: a bundle that merely looks complete is refused against fabricated
 * input, and the containment boundary for credentials in preserved output is
 * proven rather than asserted in prose.
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

interface CapturedStream {
  captured: boolean;
  containmentFailed: boolean;
  file: string | null;
  bytes: number;
  storedBytes: number;
  truncated: boolean;
  redacted: boolean;
  redactions: number;
  rawDigest: string | null;
  storedDigest: string | null;
}

interface TeardownEvidence {
  containerRemoved: boolean;
  volumeRemoved: boolean;
  volumeName: string | null;
  refusal: string | null;
  containerVerification: { outcome: string; detail: string | null } | null;
  volumeVerification: { outcome: string; detail: string | null } | null;
  removalExitStatus: number | null;
  removalDetail: string | null;
}

interface InvocationEvidence {
  label: string;
  slot: string;
  tier: string | null;
  reporter: string | null;
  invocation: {
    command: string | null;
    args: string[] | null;
    cwd: string | null;
    directoryPresent: boolean | null;
    envKeys: string[] | null;
  };
  executed: boolean;
  status: number | null;
  signal: string | null;
  spawnError: string | null;
  stdout: CapturedStream;
  stderr: CapturedStream;
  summarySource: string;
  discovery: {
    plan: boolean;
    testsReported: number | null;
    discovered: boolean;
    missingSummaryKeys: string[];
    ambiguousSummaryKeys: string[];
  };
  execution: { completed: boolean };
  counts: TierCounts;
  failures: string[];
}

interface CaptureVerdict {
  ok: boolean;
  requested: boolean;
  reasons: string[];
}

interface LauncherModule {
  MANDATORY_TIERS: Record<string, { directory: string; minimum: number }>;
  EVIDENCE_VERSION: number;
  EVIDENCE_LIMITS: {
    maxStreamBytes: number;
    directoryMode: number;
    fileMode: number;
  };
  parseTapSummary: (output: unknown) => {
    counts: TierCounts;
    ambiguous: string[];
    missing: string[];
    complete: boolean;
    hasPlan: boolean;
  };
  evaluateTier: (input: unknown) => TierVerdict;
  evaluateRun: (input: unknown) => RunVerdict;
  redactSensitive: (
    text: unknown,
    secrets?: readonly unknown[],
  ) => { text: string; redactions: number };
  buildInvocationEvidence: (input: unknown) => {
    record: InvocationEvidence;
    streams: { stdout: string | null; stderr: string | null };
  };
  evaluateCapture: (input: unknown) => CaptureVerdict;
  assignEvidenceSlot: (label: unknown, taken?: Iterable<string>) => string;
  buildTeardownEvidence: (
    teardown: unknown,
    secrets?: readonly unknown[],
  ) => TeardownEvidence | null;
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

// ---------------------------------------------------------------------------
// F060 compatibility — the preserved-evidence channel.
//
// The channel is optional, so it has two obligations that pull in opposite
// directions: when it is OFF nothing may be produced and no verdict may
// change, and when it is ON an incomplete bundle must be refused rather than
// quietly accepted. Both are proven here against fabricated records.
// ---------------------------------------------------------------------------

/** A clean captured-stream record. */
function streamRecord(
  overrides: Record<string, unknown> = {},
  label = 'database',
  stream = 'stdout',
): unknown {
  return {
    captured: true,
    containmentFailed: false,
    file: `${label}.${stream}.txt`,
    bytes: 2048,
    storedBytes: 2048,
    truncated: false,
    redacted: false,
    redactions: 0,
    rawDigest: `sha256:${'a'.repeat(64)}`,
    storedDigest: `sha256:${'a'.repeat(64)}`,
    ...overrides,
  };
}

/** A complete per-invocation record for one mandatory tier. */
function tierRecord(
  tier: 'database' | 'e2e',
  overrides: Record<string, unknown> = {},
): unknown {
  const tests = tier === 'database' ? 1007 : 115;
  return {
    label: tier,
    slot: tier,
    tier,
    reporter: 'tap',
    invocation: {
      command: '/usr/bin/node',
      args: ['--test', '--test-concurrency=1', '--test-reporter=tap'],
      cwd: `/srv/dist-test/test/${tier}`,
      directoryPresent: true,
      envKeys: ['TEST_DATABASE_URL', 'REQRO_DISPOSABLE_NONCE'],
    },
    executed: true,
    status: 0,
    signal: null,
    spawnError: null,
    stdout: streamRecord({}, tier, 'stdout'),
    stderr: streamRecord({ bytes: 0, storedBytes: 0 }, tier, 'stderr'),
    summarySource: 'stdout+stderr',
    discovery: {
      plan: true,
      testsReported: tests,
      discovered: true,
      missingSummaryKeys: [],
      ambiguousSummaryKeys: [],
    },
    execution: { completed: true },
    counts: {
      tests,
      pass: tests,
      fail: 0,
      cancelled: 0,
      skipped: 0,
      todo: 0,
    },
    failures: [],
    ...overrides,
  };
}

function fileResults(labels: readonly string[] = ['database', 'e2e']): unknown {
  return labels.flatMap((label) =>
    ['stdout', 'stderr'].map((stream) => ({
      name: `${label}.${stream}.txt`,
      path: `/tmp/reqro-validation-evidence-x/${label}.${stream}.txt`,
      bytes: 2048,
      written: true,
      error: null,
    })),
  );
}

/** A complete, selected evidence bundle. */
function captureInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    version: 1,
    requested: true,
    directory: '/tmp/reqro-validation-evidence-x',
    provenance: {
      generatedBy: 'server/scripts/test-db-disposable.mjs',
      evidenceVersion: 1,
      authenticated: false,
    },
    instance: { containerShortId: 'abc123def456' },
    instanceEvidence: { verified: true, refusal: null, clockSkewMs: 3 },
    census: {
      before: 0,
      after: 0,
      cleanBaseline: true,
      leaked: 0,
      noLeak: true,
    },
    teardown: {
      containerRemoved: true,
      volumeRemoved: true,
      volumeName: 'b'.repeat(64),
      refusal: null,
    },
    invocations: [tierRecord('database'), tierRecord('e2e')],
    files: fileResults(),
    ...overrides,
  };
}

function invocationInput(overrides: Record<string, unknown> = {}): unknown {
  return {
    label: 'database',
    slot: 'database',
    tier: 'database',
    reporter: 'tap',
    command: '/usr/bin/node',
    args: ['--test', '--test-concurrency=1', '--test-reporter=tap'],
    cwd: '/srv/dist-test/test/database',
    directoryPresent: true,
    envKeys: ['TEST_DATABASE_URL'],
    executed: true,
    status: 0,
    signal: null,
    spawnError: null,
    stdout: tap(1007),
    stderr: '',
    output: `${tap(1007)}\n`,
    ...overrides,
  };
}

test('the evidence channel is bounded, versioned and owner-only', async () => {
  const { EVIDENCE_VERSION, EVIDENCE_LIMITS, evaluateCapture } =
    await launcher();
  assert.equal(typeof evaluateCapture, 'function');
  // Bumped to 2 by this integration: records gained `slot`, streams gained
  // `redacted` and `containmentFailed`, and teardown gained the cleanup
  // verification fields. A reader must be able to tell the schemas apart.
  assert.equal(EVIDENCE_VERSION, 2);
  // Bounded: capture must have a ceiling, or a runaway child fills the disk.
  assert.ok(EVIDENCE_LIMITS.maxStreamBytes > 0);
  assert.ok(EVIDENCE_LIMITS.maxStreamBytes <= 64 * 1024 * 1024);
  assert.equal(EVIDENCE_LIMITS.directoryMode, 0o700);
  assert.equal(EVIDENCE_LIMITS.fileMode, 0o600);
});

// ---------------------------------------------------------------------------
// The containment boundary for credentials in preserved output.
// ---------------------------------------------------------------------------

test('known secrets are removed from evidence and the removal is counted', async () => {
  const { redactSensitive } = await launcher();
  const password = 'Hunter2-Hunter2-Hunter2';
  const url = `postgresql://reqro_test_user:${password}@127.0.0.1:54321/reqro_f0592_test`;
  const nonce = 'f'.repeat(32);
  const text = [
    `connecting to ${url}`,
    `nonce ${nonce} confirmed`,
    'not ok 1 - something failed',
  ].join('\n');

  const result = redactSensitive(text, [url, password, nonce]);
  assert.equal(result.text.includes(password), false);
  assert.equal(result.text.includes(url), false);
  assert.equal(result.text.includes(nonce), false);
  // Not silent: the caller can see that redaction happened.
  assert.ok(result.redactions >= 2);
  // Non-sensitive content survives, so the evidence stays useful.
  assert.ok(result.text.includes('not ok 1 - something failed'));
});

test('secret-shaped output is redacted even when the value is unknown', async () => {
  const { redactSensitive } = await launcher();
  const result = redactSensitive(
    [
      'POSTGRES_PASSWORD=some-unknown-value',
      'REQRO_DISPOSABLE_NONCE=0123456789abcdef',
      "create role r login password 'another-unknown'",
      'postgresql://someone:unknown-secret@127.0.0.1:5999/db',
    ].join('\n'),
    [],
  );
  assert.equal(result.text.includes('some-unknown-value'), false);
  assert.equal(result.text.includes('0123456789abcdef'), false);
  assert.equal(result.text.includes('another-unknown'), false);
  assert.equal(result.text.includes('unknown-secret'), false);
  assert.ok(result.redactions >= 4);
});

test('redaction never fabricates text and fails closed on non-strings', async () => {
  const { redactSensitive } = await launcher();
  assert.deepEqual(redactSensitive(undefined), { text: '', redactions: 0 });
  assert.deepEqual(redactSensitive(null, ['x'.repeat(20)]), {
    text: '',
    redactions: 0,
  });
  // A short "secret" must not be matched: it would redact ordinary prose.
  const result = redactSensitive('the cat sat on the mat', ['cat']);
  assert.equal(result.text, 'the cat sat on the mat');
  assert.equal(result.redactions, 0);
});

// ---------------------------------------------------------------------------
// buildInvocationEvidence — faithful preservation.
// ---------------------------------------------------------------------------

test('a successful invocation is preserved completely', async () => {
  const { buildInvocationEvidence, evaluateCapture } = await launcher();
  const built = buildInvocationEvidence(invocationInput());

  assert.equal(built.record.label, 'database');
  assert.equal(built.record.tier, 'database');
  // The exact invocation, not a description of it.
  assert.equal(built.record.invocation.command, '/usr/bin/node');
  assert.deepEqual(built.record.invocation.args, [
    '--test',
    '--test-concurrency=1',
    '--test-reporter=tap',
  ]);
  assert.equal(built.record.invocation.cwd, '/srv/dist-test/test/database');
  // Environment KEY NAMES only: the values carry the connection string.
  assert.deepEqual(built.record.invocation.envKeys, ['TEST_DATABASE_URL']);
  assert.equal(built.record.executed, true);
  assert.equal(built.record.status, 0);
  assert.equal(built.record.signal, null);
  assert.equal(built.record.spawnError, null);
  assert.equal(built.record.discovery.discovered, true);
  assert.equal(built.record.discovery.testsReported, 1007);
  assert.equal(built.record.execution.completed, true);
  assert.equal(built.record.counts.tests, 1007);
  assert.equal(built.record.counts.pass, 1007);
  assert.deepEqual(built.record.failures, []);

  const verdict = evaluateCapture(
    captureInput({ invocations: [built.record, tierRecord('e2e')] }),
  );
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

test('stdout and stderr are preserved separately, never merged', async () => {
  const { buildInvocationEvidence } = await launcher();
  const stdout = tap(1007);
  const stderr = 'a warning on the error stream\n';
  const built = buildInvocationEvidence(
    invocationInput({ stdout, stderr, output: `${stdout}\n${stderr}` }),
  );

  // Each stream keeps its own file, size and digest.
  assert.equal(built.record.stdout.file, 'database.stdout.txt');
  assert.equal(built.record.stderr.file, 'database.stderr.txt');
  assert.equal(built.record.stdout.captured, true);
  assert.equal(built.record.stderr.captured, true);
  assert.notEqual(built.record.stdout.rawDigest, built.record.stderr.rawDigest);
  assert.ok(built.record.stdout.bytes > 0);
  assert.equal(built.record.stderr.bytes, stderr.length);

  // And neither transcript has absorbed the other.
  assert.equal(built.streams.stdout, stdout);
  assert.equal(built.streams.stderr, stderr);
  assert.equal(built.streams.stdout.includes('a warning'), false);
  assert.equal(built.streams.stderr.includes('TAP version'), false);
});

test('the raw digest is taken before redaction, so integrity is not rewritten', async () => {
  const { buildInvocationEvidence } = await launcher();
  const password = 'Sup3rSecretValue-0123456789';
  const stderr = `connection failed for password ${password}\n`;
  const built = buildInvocationEvidence(
    invocationInput({ stderr, secrets: [password] }),
  );

  // Stored text is clean...
  assert.equal(built.streams.stderr?.includes(password), false);
  assert.ok(built.record.stderr.redactions >= 1);
  // ...while the integrity reference still describes what the child produced,
  // so a reviewer can tell the stored file was altered and by how much.
  assert.notEqual(
    built.record.stderr.rawDigest,
    built.record.stderr.storedDigest,
  );
  assert.equal(built.record.stderr.bytes, stderr.length);
  assert.notEqual(built.record.stderr.storedBytes, built.record.stderr.bytes);
});

test('an unsupplied stream is recorded as absent rather than invented', async () => {
  const { buildInvocationEvidence, evaluateCapture } = await launcher();
  const built = buildInvocationEvidence(invocationInput({ stderr: undefined }));
  assert.equal(built.record.stderr.captured, false);
  assert.equal(built.record.stderr.rawDigest, null);
  assert.equal(built.streams.stderr, null);

  const verdict = evaluateCapture(
    captureInput({ invocations: [built.record, tierRecord('e2e')] }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('raw stderr was not preserved'),
    ),
  );
});

test('capture is bounded, and exceeding the bound is declared and refused', async () => {
  const { buildInvocationEvidence, evaluateCapture } = await launcher();
  const stdout = 'x'.repeat(5000);
  const built = buildInvocationEvidence(
    invocationInput({ stdout, output: tap(1007), limit: 1000 }),
  );

  assert.equal(built.record.stdout.truncated, true);
  // The TRUE size is reported even though less was kept.
  assert.equal(built.record.stdout.bytes, 5000);
  assert.equal(built.streams.stdout?.length, 1000);

  const verdict = evaluateCapture(
    captureInput({ invocations: [built.record, tierRecord('e2e')] }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) => reason.includes('is truncated at 5000')),
  );
});

test('a recorded failure name is preserved and redacted', async () => {
  const { buildInvocationEvidence } = await launcher();
  const secret = 'leaked-credential-value-xyz';
  const output = [
    tap(1007, { pass: 1006, fail: 1 }),
    `not ok 1 - a suite using ${secret}`,
  ].join('\n');
  const built = buildInvocationEvidence(
    invocationInput({ output, stdout: output, secrets: [secret] }),
  );
  assert.equal(built.record.failures.length, 1);
  assert.equal(built.record.failures[0]?.includes(secret), false);
  assert.ok(built.record.failures[0].includes('a suite using'));
});

// ---------------------------------------------------------------------------
// evaluateCapture — positive.
// ---------------------------------------------------------------------------

test('a complete evidence bundle for a successful run is accepted', async () => {
  const { evaluateCapture, evaluateRun } = await launcher();
  const verdict = evaluateCapture(captureInput());
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.requested, true);

  // And the run verdict is unaffected by a bundle that is complete.
  const run = evaluateRun(runInput({ capture: captureInput() }));
  assert.deepEqual(run.reasons, []);
  assert.equal(run.ok, true);
});

// ---------------------------------------------------------------------------
// evaluateCapture — negative.
// ---------------------------------------------------------------------------

test('an incomplete evidence bundle is refused, with the cause named', async () => {
  const { evaluateCapture } = await launcher();
  const cases: readonly {
    readonly name: string;
    readonly reason: string;
    readonly input: unknown;
  }[] = [
    {
      name: 'no output directory was allocated',
      reason: 'no output directory was allocated',
      input: captureInput({ directory: null }),
    },
    {
      name: 'an empty output directory string',
      reason: 'no output directory was allocated',
      input: captureInput({ directory: '' }),
    },
    // Candidate-generated evidence must never pose as platform evidence.
    {
      name: 'evidence claiming to be authenticated',
      reason: 'must declare itself unauthenticated',
      input: captureInput({
        provenance: {
          generatedBy: 'server/scripts/test-db-disposable.mjs',
          authenticated: true,
        },
      }),
    },
    {
      name: 'evidence with no provenance at all',
      reason: 'records no provenance',
      input: captureInput({ provenance: null }),
    },
    {
      name: 'evidence that does not name its generator',
      reason: 'does not name its generator',
      input: captureInput({ provenance: { authenticated: false } }),
    },
    {
      name: 'an unrecorded schema census',
      reason: 'schema census and leak verification were not recorded',
      input: captureInput({ census: null }),
    },
    {
      name: 'a half-recorded schema census',
      reason: 'schema census and leak verification were not recorded',
      input: captureInput({ census: { before: 0 } }),
    },
    {
      name: 'an unrecorded disposable-instance result',
      reason: 'disposable-instance evidence result was not recorded',
      input: captureInput({ instanceEvidence: undefined }),
    },
    {
      name: 'unrecorded cleanup results',
      reason: 'cleanup results were not recorded',
      input: captureInput({ teardown: undefined }),
    },
    {
      name: 'partially recorded cleanup results',
      reason: 'recorded cleanup results are incomplete',
      input: captureInput({ teardown: { containerRemoved: true } }),
    },
    {
      name: 'no child-process evidence at all',
      reason: 'no child-process evidence was recorded',
      input: captureInput({ invocations: null }),
    },
    {
      name: 'the database tier left no evidence',
      reason: 'mandatory database tier produced no child-process evidence',
      input: captureInput({ invocations: [tierRecord('e2e')] }),
    },
    {
      name: 'the E2E tier left no evidence',
      reason: 'mandatory e2e tier produced no child-process evidence',
      input: captureInput({ invocations: [tierRecord('database')] }),
    },
    {
      name: 'an invocation with no recorded command',
      reason: 'the exact invocation was not recorded',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            invocation: { command: null, args: null, cwd: null },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'an unsafe evidence label',
      reason: 'evidence label is missing or unsafe',
      input: captureInput({
        invocations: [
          tierRecord('database', { label: '../../etc/passwd' }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'raw stdout not preserved',
      reason: 'raw stdout was not preserved',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            stdout: streamRecord({ captured: false }),
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'missing integrity digests',
      reason: 'integrity digests are missing',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            stdout: streamRecord({ rawDigest: null, storedDigest: null }),
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a truncated transcript',
      reason: 'is truncated at',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            stdout: streamRecord({ truncated: true, bytes: 99_999_999 }),
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a child that never executed',
      reason: 'the child process did not execute',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            executed: false,
            status: null,
            invocation: {
              command: '/usr/bin/node',
              args: ['--test'],
              cwd: '/missing',
              directoryPresent: false,
              envKeys: null,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a child that could not start',
      reason: 'could not start (spawn ENOENT)',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            status: null,
            spawnError: 'spawn ENOENT',
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    // A signalled child is not a completed run, whatever its summary says.
    {
      name: 'a child terminated by a signal',
      reason: 'terminated by SIGKILL',
      input: captureInput({
        invocations: [
          tierRecord('database', { status: null, signal: 'SIGKILL' }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a non-zero exit status',
      reason: 'exited with status 1',
      input: captureInput({
        invocations: [tierRecord('database', { status: 1 }), tierRecord('e2e')],
      }),
    },
    {
      name: 'neither a status nor a termination cause',
      reason: 'neither an exit status nor a termination cause was recorded',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            status: null,
            signal: null,
            spawnError: null,
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a transcript that does not show completion',
      reason: 'does not show execution completing',
      input: captureInput({
        invocations: [
          tierRecord('database', { execution: { completed: false } }),
          tierRecord('e2e'),
        ],
      }),
    },
    // Zero-test execution: the original silent-success path, closed again at
    // the evidence layer so an empty bundle cannot look complete.
    {
      name: 'zero tests executed',
      reason: 'no tests were discovered',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            discovery: {
              plan: true,
              testsReported: 0,
              discovered: false,
              missingSummaryKeys: [],
              ambiguousSummaryKeys: [],
            },
            counts: {
              tests: 0,
              pass: 0,
              fail: 0,
              cancelled: 0,
              skipped: 0,
              todo: 0,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'counts that do not add up',
      reason: 'the recorded counts contradict one another',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            counts: {
              tests: 1007,
              pass: 500,
              fail: 0,
              cancelled: 0,
              skipped: 0,
              todo: 0,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'unrecorded counts',
      reason: 'no test counts were recorded',
      input: captureInput({
        invocations: [
          tierRecord('database', { counts: null }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a failing test',
      reason: '1 failing test(s)',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            counts: {
              tests: 1007,
              pass: 1006,
              fail: 1,
              cancelled: 0,
              skipped: 0,
              todo: 0,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a skipped test',
      reason: '2 skipped test(s)',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            counts: {
              tests: 1007,
              pass: 1005,
              fail: 0,
              cancelled: 0,
              skipped: 2,
              todo: 0,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'a cancelled test',
      reason: '3 cancelled test(s)',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            counts: {
              tests: 1007,
              pass: 1004,
              fail: 0,
              cancelled: 3,
              skipped: 0,
              todo: 0,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    // `node --test` exits 0 for a TODO test, so the evidence layer names it.
    {
      name: 'a TODO test',
      reason: 'TODO test(s); a deferred required test is not a pass',
      input: captureInput({
        invocations: [
          tierRecord('database', {
            counts: {
              tests: 1007,
              pass: 1007,
              fail: 0,
              cancelled: 0,
              skipped: 0,
              todo: 4,
            },
          }),
          tierRecord('e2e'),
        ],
      }),
    },
    {
      name: 'an evidence file that could not be written',
      reason: 'evidence could not be written to database.stdout.txt: EACCES',
      input: captureInput({
        files: [
          {
            name: 'database.stdout.txt',
            path: null,
            bytes: 0,
            written: false,
            error: 'EACCES',
          },
        ],
      }),
    },
    {
      name: 'an unsafe evidence file name refused at the write boundary',
      reason: 'refused an unsafe evidence file name',
      input: captureInput({
        files: [
          {
            name: '../escape.txt',
            path: null,
            bytes: 0,
            written: false,
            error: 'refused an unsafe evidence file name',
          },
        ],
      }),
    },
    {
      name: 'no write results recorded at all',
      reason: 'no evidence-file write results were recorded',
      input: captureInput({ files: null }),
    },
  ];
  for (const entry of cases) {
    const verdict = evaluateCapture(entry.input);
    assert.equal(verdict.ok, false, `${entry.name} must be refused`);
    assert.equal(verdict.requested, true);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(entry.reason)),
      `${entry.name} refused for the wrong reason: ${verdict.reasons.join(' | ')}`,
    );
  }
});

test('a compile-style invocation is judged without demanding a TAP summary', async () => {
  const { buildInvocationEvidence, evaluateCapture } = await launcher();
  // The compiler produces no TAP, so discovery and completion checks must not
  // apply to it -- while its status, streams and command still must be kept.
  const built = buildInvocationEvidence({
    label: 'compile',
    slot: 'compile',
    tier: null,
    reporter: null,
    command: '/usr/bin/node',
    args: ['/srv/node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json'],
    cwd: '/srv',
    executed: true,
    status: 0,
    signal: null,
    spawnError: null,
    stdout: '',
    stderr: '',
    output: '\n',
  });
  assert.equal(built.record.reporter, null);
  assert.equal(built.record.execution.completed, false);

  const accepted = evaluateCapture(
    captureInput({
      invocations: [built.record, tierRecord('database'), tierRecord('e2e')],
    }),
  );
  assert.deepEqual(accepted.reasons, []);
  assert.equal(accepted.ok, true);

  // Its exit status is still evidence, though.
  const refused = evaluateCapture(
    captureInput({
      invocations: [
        { ...built.record, status: 2 },
        tierRecord('database'),
        tierRecord('e2e'),
      ],
    }),
  );
  assert.equal(refused.ok, false);
  assert.ok(
    refused.reasons.some((reason) =>
      reason.includes('compile: exited with status 2'),
    ),
  );
});

// ---------------------------------------------------------------------------
// The channel is OFF by default, and off means nothing.
// ---------------------------------------------------------------------------

test('a disabled evidence channel imposes nothing and produces nothing', async () => {
  const { evaluateCapture, evaluateRun } = await launcher();
  for (const input of [
    undefined,
    null,
    {},
    { requested: false },
    // Deliberately empty of everything a selected channel would need: an
    // unselected channel must still be judged vacuously satisfied.
    { requested: false, directory: null, invocations: null, files: null },
  ]) {
    const verdict = evaluateCapture(input);
    assert.equal(verdict.requested, false, 'the channel must read as disabled');
    assert.equal(verdict.ok, true);
    assert.deepEqual(verdict.reasons, []);
  }

  // A default run reaches exactly the verdict it reached before the channel
  // existed: no capture key, and no capture reason.
  const withoutCapture = evaluateRun(runInput());
  assert.deepEqual(withoutCapture.reasons, []);
  assert.equal(withoutCapture.ok, true);
  const disabled = evaluateRun(runInput({ capture: { requested: false } }));
  assert.deepEqual(disabled.reasons, []);
  assert.equal(disabled.ok, true);
});

// ---------------------------------------------------------------------------
// The run verdict owns pass/fail; the bundle records what happened.
// ---------------------------------------------------------------------------

test('a selected but incomplete bundle fails the run', async () => {
  const { evaluateRun } = await launcher();
  const verdict = evaluateRun(
    runInput({ capture: captureInput({ invocations: [] }) }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('mandatory database tier produced no child-process'),
    ),
  );
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('mandatory e2e tier produced no child-process'),
    ),
  );
});

test('an evidence-write failure fails the run', async () => {
  const { evaluateRun } = await launcher();
  const verdict = evaluateRun(
    runInput({
      capture: captureInput({
        files: [
          {
            name: 'e2e.stderr.txt',
            path: null,
            bytes: 0,
            written: false,
            error: 'ENOSPC: no space left on device',
          },
        ],
      }),
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('evidence could not be written to e2e.stderr.txt'),
    ),
  );
});

test('a cleanup failure is recorded faithfully and still fails the run', async () => {
  const { evaluateCapture, evaluateRun } = await launcher();
  const failedCleanup = {
    containerRemoved: false,
    volumeRemoved: false,
    volumeName: 'c'.repeat(64),
    refusal: null,
  };

  // The bundle records the failure rather than smoothing it over, so it is
  // still a COMPLETE record of an unsuccessful cleanup.
  const captured = evaluateCapture(captureInput({ teardown: failedCleanup }));
  assert.deepEqual(captured.reasons, []);
  assert.equal(captured.ok, true);

  // The run verdict is what refuses it, exactly as it did before.
  const verdict = evaluateRun(
    runInput({
      teardown: failedCleanup,
      capture: captureInput({ teardown: failedCleanup }),
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('removal of the owned container was not verified'),
    ),
  );
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('removal of the owned anonymous volume was not verified'),
    ),
  );
});

test('the capture verdict fails closed on a selected bundle holding nothing', async () => {
  const { evaluateCapture } = await launcher();
  const verdict = evaluateCapture({ requested: true });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.requested, true);
  for (const expected of [
    'no output directory was allocated',
    'records no provenance',
    'schema census and leak verification were not recorded',
    'disposable-instance evidence result was not recorded',
    'cleanup results were not recorded',
    'no child-process evidence was recorded',
    'no evidence-file write results were recorded',
  ])
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(expected)),
      `an empty bundle must report "${expected}": ${verdict.reasons.join(' | ')}`,
    );
});

// ---------------------------------------------------------------------------
// Transcript identity. A reused label must never cost an earlier transcript.
// ---------------------------------------------------------------------------

test('a slot is the label when free and disambiguated when not', async () => {
  const { assignEvidenceSlot } = await launcher();
  assert.equal(assignEvidenceSlot('database', []), 'database');
  assert.equal(assignEvidenceSlot('database', ['compile']), 'database');
  // The collision case: the label is taken, so the slot is made unique rather
  // than reused. Deterministic, so two runs name the same files.
  assert.equal(assignEvidenceSlot('database', ['database']), 'database-2');
  assert.equal(
    assignEvidenceSlot('database', ['database', 'database-2']),
    'database-3',
  );
  // Including the awkward case where the disambiguated name is itself taken.
  assert.equal(
    assignEvidenceSlot('compile', ['compile', 'compile-2', 'compile-3']),
    'compile-4',
  );
  // A Set is accepted as well as an array, because that is what the
  // orchestrator holds.
  assert.equal(assignEvidenceSlot('e2e', new Set(['e2e'])), 'e2e-2');
});

test('a slot that cannot be made safe is refused rather than guessed', async () => {
  const { assignEvidenceSlot } = await launcher();
  // An unusable label has no safe slot at all.
  for (const label of [
    '',
    '../../etc/passwd',
    'Database',
    '1database',
    'data base',
    'a'.repeat(33),
    undefined,
    null,
    42,
  ])
    assert.equal(
      assignEvidenceSlot(label, []),
      '',
      `must refuse: ${String(label)}`,
    );

  // A label long enough that disambiguating it would leave the grammar also
  // fails closed instead of producing an over-long filename.
  const longest = 'a'.repeat(32);
  assert.equal(assignEvidenceSlot(longest, []), longest);
  assert.equal(assignEvidenceSlot(longest, [longest]), '');
});

test('a duplicate slot is refused, so no transcript is silently replaced', async () => {
  const { evaluateCapture } = await launcher();
  const verdict = evaluateCapture(
    captureInput({
      invocations: [
        tierRecord('database'),
        tierRecord('e2e'),
        // A second database invocation that kept the same slot: its files
        // would land on the first one's.
        tierRecord('database', { tier: 'database' }),
      ],
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('share the evidence slot database'),
    ),
    verdict.reasons.join(' | '),
  );
});

test('a distinct slot for a reused label is accepted', async () => {
  const { evaluateCapture } = await launcher();
  // The same label twice is legitimate; the SLOTS are what must differ.
  const verdict = evaluateCapture(
    captureInput({
      invocations: [
        tierRecord('database'),
        tierRecord('e2e'),
        tierRecord('database', {
          slot: 'database-2',
          stdout: streamRecord({}, 'database-2', 'stdout'),
          stderr: streamRecord(
            { bytes: 0, storedBytes: 0 },
            'database-2',
            'stderr',
          ),
        }),
      ],
      files: fileResults(['database', 'e2e', 'database-2']),
    }),
  );
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

test('an invocation with no safe slot is refused', async () => {
  const { evaluateCapture } = await launcher();
  for (const slot of ['', '../escape', undefined]) {
    const verdict = evaluateCapture(
      captureInput({
        invocations: [tierRecord('database', { slot }), tierRecord('e2e')],
      }),
    );
    assert.equal(verdict.ok, false);
    assert.ok(
      verdict.reasons.some((reason) =>
        reason.includes('evidence slot is missing or unsafe'),
      ),
      `slot ${String(slot)}: ${verdict.reasons.join(' | ')}`,
    );
  }
});

test('the manifest and the transcript files must name the same identity', async () => {
  const { evaluateCapture } = await launcher();
  const verdict = evaluateCapture(
    captureInput({
      invocations: [
        tierRecord('database', {
          slot: 'database',
          // Points at another invocation's transcript.
          stdout: streamRecord({ file: 'e2e.stdout.txt' }),
        }),
        tierRecord('e2e'),
      ],
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('does not match the evidence slot database'),
    ),
    verdict.reasons.join(' | '),
  );
});

test('the orchestrator names transcript files from the slot', async () => {
  const { buildInvocationEvidence } = await launcher();
  const built = buildInvocationEvidence(
    invocationInput({ slot: 'database-2' }),
  );
  assert.equal(built.record.slot, 'database-2');
  assert.equal(built.record.label, 'database');
  assert.equal(built.record.stdout.file, 'database-2.stdout.txt');
  assert.equal(built.record.stderr.file, 'database-2.stderr.txt');
});

// ---------------------------------------------------------------------------
// Containment. A secret that survived redaction is not written at all.
// ---------------------------------------------------------------------------

test('a stream whose secret survived redaction is not persisted', async () => {
  const { buildInvocationEvidence, evaluateCapture } = await launcher();
  // A secret that the redactor is told about but which, hypothetically,
  // remained: capture must withhold the file rather than write a credential.
  // Forced here by supplying a secret the generic patterns cannot reach and
  // asserting the residual guard, not the redactor, is what refuses.
  const secret = 'residual-secret-value-123456';
  const built = buildInvocationEvidence(
    invocationInput({
      stderr: `a transcript mentioning ${secret}\n`,
      secrets: [secret],
    }),
  );
  // Normal path: it WAS redacted, so it is persisted.
  assert.equal(built.record.stderr.captured, true);
  assert.equal(built.record.stderr.containmentFailed, false);
  assert.equal(built.streams.stderr?.includes(secret), false);

  // Now the failure path, proven through the verdict: a record claiming a
  // containment failure is refused and reports why.
  const verdict = evaluateCapture(
    captureInput({
      invocations: [
        tierRecord('database', {
          stderr: streamRecord(
            {
              captured: false,
              containmentFailed: true,
              file: null,
              storedBytes: 0,
              storedDigest: null,
              redacted: true,
              redactions: 1,
            },
            'database',
            'stderr',
          ),
        }),
        tierRecord('e2e'),
      ],
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes(
        'could not be sanitised, so it was deliberately not persisted',
      ),
    ),
    verdict.reasons.join(' | '),
  );
});

test('redacted output is never presented as the raw stream', async () => {
  const { buildInvocationEvidence, evaluateCapture } = await launcher();
  const secret = 'Sup3rSecretValue-0123456789';
  const built = buildInvocationEvidence(
    invocationInput({
      stderr: `failed for ${secret}\n`,
      secrets: [secret],
    }),
  );
  assert.equal(built.record.stderr.redacted, true);
  assert.ok(built.record.stderr.redactions >= 1);
  assert.notEqual(
    built.record.stderr.rawDigest,
    built.record.stderr.storedDigest,
  );

  // A record that claims redaction while reporting identical digests is
  // self-contradictory, and the bundle is refused.
  const verdict = evaluateCapture(
    captureInput({
      invocations: [
        tierRecord('database', {
          stdout: streamRecord({
            redacted: true,
            redactions: 3,
            rawDigest: `sha256:${'b'.repeat(64)}`,
            storedDigest: `sha256:${'b'.repeat(64)}`,
          }),
        }),
        tierRecord('e2e'),
      ],
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((reason) =>
      reason.includes('stored digest still equals the raw digest'),
    ),
    verdict.reasons.join(' | '),
  );
});

test('an unredacted stream legitimately reports equal digests', async () => {
  const { buildInvocationEvidence } = await launcher();
  // The inverse must stay allowed, or every clean transcript would be refused.
  const built = buildInvocationEvidence(
    invocationInput({ stderr: 'nothing sensitive here\n', secrets: [] }),
  );
  assert.equal(built.record.stderr.redacted, false);
  assert.equal(built.record.stderr.redactions, 0);
  assert.equal(built.record.stderr.rawDigest, built.record.stderr.storedDigest);
});

// ---------------------------------------------------------------------------
// The cleanup correction, carried into the manifest.
// ---------------------------------------------------------------------------

/** A Docker answer, shaped as the cleanup helper normalises them. */
function dockerAnswer(overrides: Partial<DockerResult> = {}): DockerResult {
  return {
    status: 0,
    signal: null,
    spawnError: null,
    timedOut: false,
    stdout: '',
    stderr: '',
    ...overrides,
  };
}

const CONTAINER_ID = 'c'.repeat(64);
const VOLUME_ID = 'a'.repeat(64);

function cleanupProbes(overrides: Partial<CleanupProbes> = {}): CleanupProbes {
  return {
    containerId: CONTAINER_ID,
    refusal: null,
    removal: dockerAnswer(),
    containerAbsence: dockerAnswer({
      status: 1,
      stderr: `error: no such object: ${CONTAINER_ID}`,
    }),
    volume: { kind: 'known', name: VOLUME_ID },
    volumeAbsence: dockerAnswer({
      status: 1,
      stderr: `Error response from daemon: get ${VOLUME_ID}: no such volume`,
    }),
    ...overrides,
  };
}

test('the manifest reflects a REAL verified cleanup result', async () => {
  const { buildTeardownEvidence, evaluateCapture } = await launcher();
  // Fed from the actual cleanup helper, not a hand-written shape, so a
  // renamed or dropped field in the helper fails here instead of silently
  // producing a manifest full of nulls.
  const cleanup = verifyCleanup(cleanupProbes());
  assert.equal(cleanup.containerRemoved, true);

  const section = buildTeardownEvidence(cleanup, []);
  assert.ok(section, 'a cleanup result must map to a teardown section');
  assert.equal(section.containerRemoved, true);
  assert.equal(section.volumeRemoved, true);
  assert.equal(section.volumeName, VOLUME_ID);
  assert.equal(section.refusal, null);
  assert.equal(section.containerVerification?.outcome, 'absent');
  assert.equal(section.volumeVerification?.outcome, 'absent');
  assert.ok(section.containerVerification.detail?.includes('no such'));
  assert.equal(section.removalExitStatus, 0);
  assert.equal(section.removalDetail, null);

  const verdict = evaluateCapture(captureInput({ teardown: section }));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

test('the manifest distinguishes absent, present and unknown', async () => {
  const { buildTeardownEvidence } = await launcher();
  // 1. Confirmed absent.
  const absent = buildTeardownEvidence(verifyCleanup(cleanupProbes()), []);
  assert.ok(absent);
  assert.equal(absent.containerVerification?.outcome, 'absent');
  assert.equal(absent.containerRemoved, true);

  // 2. Confirmed still present.
  const present = buildTeardownEvidence(
    verifyCleanup(
      cleanupProbes({ containerAbsence: dockerAnswer({ status: 0 }) }),
    ),
    [],
  );
  assert.ok(present);
  assert.equal(present.containerVerification?.outcome, 'present');
  assert.equal(present.containerRemoved, false);
  assert.ok(present.containerVerification.detail?.includes('still reports'));

  // 3. Unknown, because Docker could not verify it. THE case that used to be
  // reported as a clean removal.
  const unknown = buildTeardownEvidence(
    verifyCleanup(
      cleanupProbes({
        containerAbsence: dockerAnswer({ status: null, timedOut: true }),
      }),
    ),
    [],
  );
  assert.ok(unknown);
  assert.equal(unknown.containerVerification?.outcome, 'unknown');
  assert.equal(unknown.containerRemoved, false);
  assert.ok(unknown.containerVerification.detail?.includes('timed out'));

  // All three are distinguishable in the manifest, and only the first is a
  // success.
  assert.deepEqual(
    [absent, present, unknown].map(
      (entry) => entry.containerVerification?.outcome,
    ),
    ['absent', 'present', 'unknown'],
  );
  assert.deepEqual(
    [absent, present, unknown].map((entry) => entry.containerRemoved),
    [true, false, false],
  );
});

test('an inconclusive cleanup fails the capture verdict and the run', async () => {
  const { buildTeardownEvidence, evaluateCapture, evaluateRun } =
    await launcher();
  const cleanup = verifyCleanup(
    cleanupProbes({
      volumeAbsence: dockerAnswer({
        status: 1,
        stderr:
          'Cannot connect to the Docker daemon. Is the docker daemon running?',
      }),
    }),
  );
  const section = buildTeardownEvidence(cleanup, []);
  assert.ok(section);
  assert.equal(section.volumeVerification?.outcome, 'unknown');
  assert.equal(section.volumeRemoved, false);

  // The capture bundle is internally consistent, so it is complete evidence
  // OF A FAILURE -- recorded faithfully rather than smoothed over.
  const captured = evaluateCapture(captureInput({ teardown: section }));
  assert.deepEqual(captured.reasons, []);

  // And the run verdict refuses it.
  const run = evaluateRun(
    runInput({
      teardown: cleanup,
      capture: captureInput({ teardown: section }),
    }),
  );
  assert.equal(run.ok, false);
  assert.ok(
    run.reasons.some((reason) =>
      reason.includes('removal of the owned anonymous volume was not verified'),
    ),
    run.reasons.join(' | '),
  );
});

test('a teardown section that contradicts its own verification is refused', async () => {
  const { evaluateCapture } = await launcher();
  const cases: readonly {
    readonly name: string;
    readonly reason: string;
    readonly teardown: unknown;
  }[] = [
    {
      name: 'removed while the outcome says present',
      reason: 'container cleanup disagrees with its own verification',
      teardown: {
        containerRemoved: true,
        volumeRemoved: true,
        volumeName: VOLUME_ID,
        refusal: null,
        containerVerification: { outcome: 'present', detail: 'still there' },
        volumeVerification: { outcome: 'absent', detail: 'gone' },
        removalExitStatus: 0,
        removalDetail: null,
      },
    },
    {
      name: 'removed while the outcome says unknown',
      reason: 'volume cleanup disagrees with its own verification',
      teardown: {
        containerRemoved: true,
        volumeRemoved: true,
        volumeName: VOLUME_ID,
        refusal: null,
        containerVerification: { outcome: 'absent', detail: 'gone' },
        volumeVerification: { outcome: 'unknown', detail: 'timed out' },
        removalExitStatus: 0,
        removalDetail: null,
      },
    },
    {
      name: 'not removed while the outcome says absent',
      reason: 'container cleanup disagrees with its own verification',
      teardown: {
        containerRemoved: false,
        volumeRemoved: true,
        volumeName: VOLUME_ID,
        refusal: null,
        containerVerification: { outcome: 'absent', detail: 'gone' },
        volumeVerification: { outcome: 'absent', detail: 'gone' },
        removalExitStatus: 0,
        removalDetail: null,
      },
    },
    {
      name: 'an unrecognised outcome',
      reason: 'is not a recognised state',
      teardown: {
        containerRemoved: true,
        volumeRemoved: true,
        volumeName: VOLUME_ID,
        refusal: null,
        containerVerification: { outcome: 'probably-gone', detail: null },
        volumeVerification: { outcome: 'absent', detail: 'gone' },
        removalExitStatus: 0,
        removalDetail: null,
      },
    },
    {
      name: 'a malformed verification',
      reason: 'cleanup verification is malformed',
      teardown: {
        containerRemoved: true,
        volumeRemoved: true,
        volumeName: VOLUME_ID,
        refusal: null,
        containerVerification: 'absent',
        volumeVerification: { outcome: 'absent', detail: 'gone' },
        removalExitStatus: 0,
        removalDetail: null,
      },
    },
  ];
  for (const entry of cases) {
    const verdict = evaluateCapture(captureInput({ teardown: entry.teardown }));
    assert.equal(verdict.ok, false, `${entry.name} must be refused`);
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(entry.reason)),
      `${entry.name} refused for the wrong reason: ${verdict.reasons.join(' | ')}`,
    );
  }
});

test('a helper that reports no verification is accepted, not invented', async () => {
  const { buildTeardownEvidence, evaluateCapture } = await launcher();
  // Forward compatibility in both directions: an older cleanup result that
  // carries only the four original fields maps to explicit nulls, and the
  // bundle still validates on the booleans alone.
  const section = buildTeardownEvidence(
    {
      containerRemoved: true,
      volumeRemoved: true,
      volumeName: VOLUME_ID,
      refusal: null,
    },
    [],
  );
  assert.ok(section);
  // Explicitly null, NOT fabricated into an 'absent' verdict.
  assert.equal(section.containerVerification, null);
  assert.equal(section.volumeVerification, null);
  assert.equal(section.removalExitStatus, null);
  assert.equal(section.removalDetail, null);
  // The booleans the older helper did report are carried through faithfully.
  assert.equal(section.containerRemoved, true);
  assert.equal(section.volumeRemoved, true);

  const verdict = evaluateCapture(captureInput({ teardown: section }));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

test('the teardown section redacts every free-text detail', async () => {
  const { buildTeardownEvidence } = await launcher();
  const secret = 'Sup3rSecretValue-0123456789';
  const url = `postgresql://reqro_test_user:${secret}@127.0.0.1:54321/reqro_f0592_test`;
  const section = buildTeardownEvidence(
    {
      containerRemoved: false,
      volumeRemoved: false,
      volumeName: VOLUME_ID,
      refusal: `refusing teardown while holding ${url}`,
      containerVerification: {
        outcome: 'unknown',
        detail: `docker could not answer: ${url}`,
      },
      volumeVerification: {
        outcome: 'unknown',
        detail: `the volume check failed for ${secret}`,
      },
      removalExitStatus: 1,
      removalDetail: `the removal command exited 1: ${url}`,
    },
    [url, secret],
  );
  assert.ok(section);
  for (const text of [
    section.refusal,
    section.containerVerification?.detail,
    section.volumeVerification?.detail,
    section.removalDetail,
  ]) {
    assert.equal(typeof text, 'string');
    assert.equal(String(text).includes(secret), false);
    assert.equal(String(text).includes(url), false);
  }
  // Still diagnosable.
  assert.ok(
    section.containerVerification?.detail?.includes('could not answer'),
  );
  assert.equal(section.removalExitStatus, 1);
});

test('a null cleanup result maps to a null teardown section', async () => {
  const { buildTeardownEvidence, evaluateCapture } = await launcher();
  assert.equal(buildTeardownEvidence(null, []), null);
  assert.equal(buildTeardownEvidence(undefined, []), null);
  // A null section is a faithful record of "no teardown evidence produced",
  // which the run verdict refuses; the capture bundle is still consistent.
  const verdict = evaluateCapture(captureInput({ teardown: null }));
  assert.deepEqual(verdict.reasons, []);
  assert.equal(verdict.ok, true);
});

// ---------------------------------------------------------------------------
// evaluateSchemaCensus.
//
// The census exists to catch a test that left a scratch schema behind. It
// predates any test applying the complete migration sequence, so it counted
// every non-system schema as a leak -- including `reqro_integration_api`,
// which migration 51 creates by design. The allowance is conditional on that
// migration being recorded as applied, so the detector keeps its teeth: a
// scratch schema still fails, and the application schema without its
// migration still fails, because then something else created it.
// ---------------------------------------------------------------------------

const APPROVED_SCHEMA = 'reqro_integration_api';
const APPROVED_MIGRATION = '20261023000000-add-integration-worker-function-api';

test('F067 the schema allowance is one named schema bound to one migration', () => {
  assert.deepEqual(Object.keys(APPLICATION_SCHEMAS), [APPROVED_SCHEMA]);
  assert.equal(APPLICATION_SCHEMAS[APPROVED_SCHEMA], APPROVED_MIGRATION);
  // Narrow by construction: no pattern, prefix or wildcard can widen it.
  assert.equal(Object.isFrozen(APPLICATION_SCHEMAS), true);
});

test('F067 an empty database before and after passes the census', () => {
  assert.deepEqual(
    evaluateSchemaCensus({
      before: { schemas: [], appliedMigrations: [] },
      after: { schemas: [], appliedMigrations: [] },
    }),
    { ok: true, reasons: [], allowed: [], unexpected: [] },
  );
});

test('F067 the approved application schema passes when its migration is applied', () => {
  const verdict = evaluateSchemaCensus({
    before: { schemas: [], appliedMigrations: [] },
    after: {
      schemas: [APPROVED_SCHEMA],
      appliedMigrations: ['20260902000000-create-catalog', APPROVED_MIGRATION],
    },
  });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.reasons, []);
  assert.deepEqual([...verdict.allowed], [APPROVED_SCHEMA]);
  assert.deepEqual([...verdict.unexpected], []);
});

test('F067 the approved schema plus a scratch schema fails and names the scratch one', () => {
  const verdict = evaluateSchemaCensus({
    before: { schemas: [], appliedMigrations: [] },
    after: {
      schemas: [APPROVED_SCHEMA, 'idempotency_9f2c'],
      appliedMigrations: [APPROVED_MIGRATION],
    },
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual([...verdict.allowed], [APPROVED_SCHEMA]);
  assert.ok(verdict.unexpected.includes('idempotency_9f2c'));
  assert.ok(
    verdict.reasons.some((reason) => reason.includes('idempotency_9f2c')),
    verdict.reasons.join('; '),
  );
  assert.ok(verdict.reasons.some((reason) => reason.includes('leaked')));
  // The allowance must never launder the schema beside it.
  assert.ok(
    !verdict.reasons.some((reason) => reason.includes(APPROVED_SCHEMA)),
  );
});

test('F067 the approved schema without its migration evidence fails', () => {
  const verdict = evaluateSchemaCensus({
    before: { schemas: [], appliedMigrations: [] },
    after: { schemas: [APPROVED_SCHEMA], appliedMigrations: [] },
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual([...verdict.allowed], []);
  assert.deepEqual([...verdict.unexpected], [APPROVED_SCHEMA]);
  assert.ok(
    verdict.reasons.some(
      (reason) =>
        reason.includes(APPROVED_SCHEMA) && reason.includes(APPROVED_MIGRATION),
    ),
    verdict.reasons.join('; '),
  );
  // A history that omits this migration specifically is not evidence either.
  assert.equal(
    evaluateSchemaCensus({
      before: { schemas: [], appliedMigrations: [] },
      after: {
        schemas: [APPROVED_SCHEMA],
        appliedMigrations: ['20261031000000-add-submission-idempotency'],
      },
    }).ok,
    false,
  );
});

test('F067 an unexpected schema alone fails even with a full migration history', () => {
  const verdict = evaluateSchemaCensus({
    before: { schemas: [], appliedMigrations: [] },
    after: {
      schemas: ['uat_f067_scratch'],
      appliedMigrations: [APPROVED_MIGRATION],
    },
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual([...verdict.unexpected], ['uat_f067_scratch']);
  assert.ok(
    verdict.reasons.some((reason) => reason.includes('uat_f067_scratch')),
  );
});

test('F067 schema-isolated test leaks remain detectable, several at once', () => {
  // The exact shape the schema-isolated suites would leave behind.
  const leaks = ['development_staff_a1', 'idempotency_b2', 'access_c3'];
  const verdict = evaluateSchemaCensus({
    before: { schemas: [], appliedMigrations: [] },
    after: { schemas: leaks, appliedMigrations: [] },
  });
  assert.equal(verdict.ok, false);
  assert.deepEqual([...verdict.unexpected].sort(), [...leaks].sort());
  for (const leak of leaks)
    assert.ok(
      verdict.reasons.some((reason) => reason.includes(leak)),
      leak,
    );
});

test('F067 a dirty baseline and an unreadable inventory are both refused', () => {
  const dirty = evaluateSchemaCensus({
    before: { schemas: ['left_over'], appliedMigrations: [] },
    after: { schemas: [], appliedMigrations: [] },
  });
  assert.equal(dirty.ok, false);
  assert.ok(dirty.reasons.some((reason) => reason.includes('clean baseline')));
  assert.ok(dirty.reasons.some((reason) => reason.includes('left_over')));
  assert.equal(
    evaluateSchemaCensus({
      before: null,
      after: { schemas: [], appliedMigrations: [] },
    }).ok,
    false,
  );
  assert.equal(
    evaluateSchemaCensus({
      before: { schemas: [], appliedMigrations: [] },
      after: null,
    }).ok,
    false,
  );
  assert.equal(evaluateSchemaCensus({}).ok, false);
});

test('F067 the run verdict accepts an accounted-for schema and refuses an unexplained one', async () => {
  const { evaluateRun } = await launcher();
  const accepted = evaluateRun(
    runInput({
      census: {
        before: 0,
        after: 1,
        allowed: [APPROVED_SCHEMA],
        unexpected: [],
        verdict: { ok: true, reasons: [] },
      },
    }),
  );
  assert.deepEqual(accepted.reasons, []);
  assert.equal(accepted.ok, true);
  // A refused census is carried verbatim into the run verdict.
  const refused = evaluateRun(
    runInput({
      census: {
        before: 0,
        after: 2,
        allowed: [APPROVED_SCHEMA],
        unexpected: ['idempotency_9f2c'],
        verdict: {
          ok: false,
          reasons: ['1 schema(s) leaked during the run: idempotency_9f2c'],
        },
      },
    }),
  );
  assert.equal(refused.ok, false);
  assert.ok(
    refused.reasons.some((reason) => reason.includes('idempotency_9f2c')),
  );
});

test('F067 a passing census that does not add up is still refused', async () => {
  const { evaluateRun } = await launcher();
  const mismatch = evaluateRun(
    runInput({
      census: {
        before: 0,
        after: 3,
        allowed: [APPROVED_SCHEMA],
        unexpected: [],
        verdict: { ok: true, reasons: [] },
      },
    }),
  );
  assert.equal(mismatch.ok, false);
  assert.ok(
    mismatch.reasons.some((reason) => reason.includes('do not explain')),
  );
  const contradiction = evaluateRun(
    runInput({
      census: {
        before: 0,
        after: 1,
        allowed: [],
        unexpected: ['idempotency_9f2c'],
        verdict: { ok: true, reasons: [] },
      },
    }),
  );
  assert.equal(contradiction.ok, false);
  assert.ok(
    contradiction.reasons.some((reason) =>
      reason.includes('despite a passing census'),
    ),
  );
  const silent = evaluateRun(
    runInput({
      census: {
        before: 0,
        after: 0,
        allowed: [],
        unexpected: [],
        verdict: { ok: false, reasons: [] },
      },
    }),
  );
  assert.equal(silent.ok, false);
  assert.ok(
    silent.reasons.some((reason) => reason.includes('without a reason')),
  );
});

test('F067 a run that recorded no named verdict keeps the original count rule', async () => {
  const { evaluateRun } = await launcher();
  // Backward compatibility: silence must not become permission.
  const grown = evaluateRun(runInput({ census: { before: 0, after: 1 } }));
  assert.equal(grown.ok, false);
  assert.ok(
    grown.reasons.some((reason) => reason.includes('leaked during the run')),
  );
  assert.equal(
    evaluateRun(runInput({ census: { before: 0, after: 0 } })).ok,
    true,
  );
});

test('F067 the census correction touches no identity, nonce or cleanup contract', () => {
  // Cleanup verification keeps its own dedicated suite; what matters here is
  // that the allowance is about schemas and names no other resource concept.
  assert.equal(typeof verifyCleanup, 'function');
  const allowance = `${Object.keys(APPLICATION_SCHEMAS).join(',')}|${Object.values(APPLICATION_SCHEMAS).join(',')}`;
  for (const unrelated of ['container', 'nonce', 'image', 'volume', 'digest'])
    assert.ok(!allowance.includes(unrelated), unrelated);
});

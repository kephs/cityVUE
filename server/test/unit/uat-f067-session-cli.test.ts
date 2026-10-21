/**
 * F067 — the session CLI, exercised as a real child process.
 *
 * The defect this file exists to keep closed:
 *
 *   `uat-f067-session.mjs` held the shared verdicts AND was the executable
 *   entry, ending in `process.exit(await main())`. That top-level await
 *   suspended the module's own evaluation while `main()` dynamically imported
 *   `uat-f067-orchestrator.mjs` and `uat-f067-effects.mjs` -- both of which
 *   statically imported the suspended module. ES module linking cannot
 *   complete that cycle: the promise never settled, the event loop emptied,
 *   and Node exited **13** with no output whatsoever.
 *
 *   `start --confirm` and `end --confirm` were therefore both dead on
 *   arrival, and `status` would have been too once a record existed. Nothing
 *   caught it: every existing test imports the orchestrator directly, which
 *   creates no cycle because the importer is not an entry suspended on a
 *   top-level await. `start --dry-run` passed because it returns before
 *   reaching those imports.
 *
 * So these tests spawn the actual CLI. A module-level assertion cannot
 * reproduce an entry-module deadlock; only running the entry can.
 *
 * Nothing here creates a container, connects to PostgreSQL or writes a
 * secret. Two cases are deliberately authorized -- see `authorizedEnd` --
 * because reaching the dynamic imports at all requires passing the
 * authorization gate, and that is precisely where the deadlock lived.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import test from 'node:test';

const SERVER_ROOT = resolve(__dirname, '../../..');
const CLI = resolve(SERVER_ROOT, 'scripts/uat-f067-session.mjs');
const CORE = resolve(SERVER_ROOT, 'scripts/uat-f067-session-core.mjs');
const SESSION_FILE = resolve(
  SERVER_ROOT,
  '.local-data',
  'uat-f067-session.json',
);
const SECRET_FILE = resolve(SERVER_ROOT, '.env.uat');

/** Node's exit code for an unsettled top-level await. The bug's signature. */
const UNSETTLED_TOP_LEVEL_AWAIT = 13;
const TIMEOUT_MS = 120_000;

interface Invocation {
  readonly status: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly output: string;
}

/** Runs the real CLI in its own process, under a bounded timeout. */
function run(args: string[], env: Record<string, string> = {}): Invocation {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    env: { ...process.env, ...env },
  });
  const stdout = result.stdout;
  const stderr = result.stderr;
  return {
    status: result.status,
    signal: result.signal ?? null,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`,
  };
}

/** Every invocation must have finished, and never with the deadlock code. */
function assertSettled(invocation: Invocation, label: string): void {
  assert.equal(
    invocation.signal,
    null,
    `${label} was killed by a signal, so it did not complete within the timeout`,
  );
  assert.notEqual(
    invocation.status,
    UNSETTLED_TOP_LEVEL_AWAIT,
    `${label} exited 13: a top-level await never settled, so the module cycle is back`,
  );
  assert.ok(
    typeof invocation.status === 'number',
    `${label} produced no exit status`,
  );
}

/** No session artifact may exist before or after any test in this file. */
function assertNoArtifacts(label: string): void {
  assert.equal(existsSync(SESSION_FILE), false, `${label}: session record`);
  assert.equal(existsSync(SECRET_FILE), false, `${label}: secret file`);
}

// --- safe dry runs ---------------------------------------------------------

void test('F067 start --dry-run succeeds and creates nothing', () => {
  assertNoArtifacts('before start --dry-run');
  const invocation = run(['start', '--dry-run']);
  assertSettled(invocation, 'start --dry-run');
  assert.equal(invocation.status, 0, invocation.output);
  assert.match(invocation.stdout, /dry run/);
  assert.match(invocation.stdout, /nothing was created, migrated, seeded/);
  assert.match(invocation.stdout, /migration count {4}60/);
  assertNoArtifacts('after start --dry-run');
});

void test('F067 end --dry-run succeeds and creates nothing', () => {
  const invocation = run(['end', '--dry-run']);
  assertSettled(invocation, 'end --dry-run');
  assert.equal(invocation.status, 0, invocation.output);
  assert.match(invocation.stdout, /dry run/);
  assertNoArtifacts('after end --dry-run');
});

void test('F067 a dry run performs no Docker, PostgreSQL or secret operation', () => {
  const invocation = run(['start', '--dry-run']);
  assert.equal(invocation.status, 0);
  // The plan is described, not performed. Nothing reports having happened.
  for (const performed of [
    /container [0-9a-f]{12}/,
    /applied \d+ migrations/,
    /secret written/,
    /postgresql:\/\//,
  ])
    assert.ok(!performed.test(invocation.output), String(performed));
  assertNoArtifacts('after a second dry run');
});

// --- safe refusals ---------------------------------------------------------

void test('F067 start --confirm without authorization refuses promptly', () => {
  const invocation = run(['start', '--confirm']);
  assertSettled(invocation, 'start --confirm (unauthorized)');
  assert.equal(invocation.status, 3, invocation.output);
  assert.match(invocation.stderr, /requires an authorized F067 UAT session/);
  assert.match(invocation.stderr, /performs no container, migration, seeding/);
  assertNoArtifacts('after unauthorized start --confirm');
});

void test('F067 end --confirm without authorization refuses promptly', () => {
  const invocation = run(['end', '--confirm']);
  assertSettled(invocation, 'end --confirm (unauthorized)');
  assert.equal(invocation.status, 3, invocation.output);
  assert.match(invocation.stderr, /requires an authorized F067 UAT session/);
  assertNoArtifacts('after unauthorized end --confirm');
});

void test('F067 status with no session record reports so without hanging', () => {
  const invocation = run(['status']);
  assertSettled(invocation, 'status');
  assert.equal(invocation.status, 0, invocation.output);
  assert.match(invocation.stdout, /no session recorded/);
  assertNoArtifacts('after status');
});

void test('F067 invalid arguments exit with a bounded nonzero code', () => {
  // Two distinct contracts, both exit 2: an unknown command prints usage, a
  // missing mode names the flags it needs. Neither prints a stack trace.
  const cases: [string[], RegExp][] = [
    [['bogus'], /unknown command bogus/],
    [['start'], /start requires an explicit --dry-run or --confirm/],
    [['end'], /end requires an explicit --dry-run or --confirm/],
    [['start', '--maybe'], /start requires an explicit --dry-run or --confirm/],
  ];
  for (const [args, expected] of cases) {
    const invocation = run(args);
    const label = `argv ${JSON.stringify(args)}`;
    assertSettled(invocation, label);
    assert.equal(invocation.status, 2, `${label}: ${invocation.output}`);
    assert.match(invocation.output, expected, label);
    assert.ok(!invocation.output.includes('    at '), `${label}: stack trace`);
  }
  assertNoArtifacts('after invalid arguments');
});

void test('F067 no command prints usage and succeeds, as it did before', () => {
  // Pre-existing contract, preserved: a bare invocation is a help request,
  // not an error.
  const invocation = run([]);
  assertSettled(invocation, 'no arguments');
  assert.equal(invocation.status, 0, invocation.output);
  assert.match(invocation.stdout, /F067 isolated interactive UAT session/);
  assert.match(invocation.stdout, /start {2}--dry-run \| --confirm/);
  assertNoArtifacts('after a bare invocation');
});

// --- the deadlock itself ---------------------------------------------------

void test('F067 an authorized end with no session record reaches the orchestrator and refuses', () => {
  // THE regression test. Reaching the dynamic imports of the orchestrator and
  // the effects requires passing the authorization gate, and that import pair
  // is exactly what deadlocked -- before the fix this invocation exited 13
  // with no output at all.
  //
  // Safe because `runEnd` reads the session record and returns `none` before
  // it inspects Docker, connects to PostgreSQL or removes anything, and no
  // record exists here. The secret-write switch is deliberately NOT set.
  assertNoArtifacts('before authorized end');
  const invocation = run(['end', '--confirm'], {
    REQRO_F067_UAT_AUTHORIZED: 'true',
  });
  assertSettled(invocation, 'end --confirm (authorized, no record)');
  assert.equal(invocation.status, 0, invocation.output);
  assert.match(invocation.output, /no session is recorded; nothing to end/);
  assert.match(invocation.stdout, /end: none/);
  // It got far enough to build the live effects, and still touched nothing.
  assertNoArtifacts('after authorized end');
  assert.ok(!invocation.output.includes('postgresql://'));
});

void test('F067 no CLI invocation exits with the unsettled-top-level-await code', () => {
  const invocations: [string, Invocation][] = [
    ['start --dry-run', run(['start', '--dry-run'])],
    ['end --dry-run', run(['end', '--dry-run'])],
    ['status', run(['status'])],
    ['start --confirm', run(['start', '--confirm'])],
    [
      'end --confirm authorized',
      run(['end', '--confirm'], { REQRO_F067_UAT_AUTHORIZED: 'true' }),
    ],
    ['bogus', run(['bogus'])],
  ];
  for (const [label, invocation] of invocations) {
    assertSettled(invocation, label);
    assert.ok(
      [0, 1, 2, 3].includes(invocation.status ?? -1),
      `${label} exited ${String(invocation.status)}, outside the documented 0/1/2/3`,
    );
  }
  assertNoArtifacts('after the full CLI matrix');
});

// --- module topology -------------------------------------------------------

void test('F067 importing the library does not execute the CLI', async () => {
  // Importing the entry must define and return, not run `main()` or exit.
  // This test process surviving the import is the assertion.
  const entry = (await import(pathToFileURLHref(CLI))) as Record<
    string,
    unknown
  >;
  assert.equal(typeof entry.main, 'function');
  // The shared definitions are re-exported, so existing importers still work.
  for (const name of [
    'UAT_DATABASE',
    'OWNERSHIP_LABEL',
    'SESSION_STATES',
    'redactUrl',
    'evaluateSessionRecord',
    'evaluateLock',
    'describeSession',
    'prepareSessionRecord',
    'SESSION_FILE',
    'UAT_ENV_FILE',
  ])
    assert.ok(name in entry, name);
  const core = (await import(pathToFileURLHref(CORE))) as Record<
    string,
    unknown
  >;
  assert.equal('main' in core, false, 'the core module exposes no CLI');
  assert.equal(typeof core.evaluateLock, 'function');
  assertNoArtifacts('after importing both modules');
});

function pathToFileURLHref(path: string): string {
  return `file:///${path.replaceAll('\\', '/')}`;
}

void test('F067 nothing in the harness imports the executable CLI entry', () => {
  // The cycle is gone structurally: the orchestrator and the effects depend
  // on the side-effect-free core, never on the entry. If a future change
  // reintroduces an import of the entry from one of its own dependencies,
  // this fails before anyone runs the CLI.
  const offenders: string[] = [];
  for (const file of readdirSync(resolve(SERVER_ROOT, 'scripts'))) {
    if (!file.endsWith('.mjs') || file === 'uat-f067-session.mjs') continue;
    const text = readFileSync(resolve(SERVER_ROOT, 'scripts', file), 'utf8');
    if (/from\s+['"]\.\/uat-f067-session\.mjs['"]/.test(text))
      offenders.push(file);
  }
  assert.deepEqual(offenders, []);
  // And both dependants do import the core.
  for (const file of ['uat-f067-orchestrator.mjs', 'uat-f067-effects.mjs']) {
    const text = readFileSync(resolve(SERVER_ROOT, 'scripts', file), 'utf8');
    assert.match(text, /from\s+'\.\/uat-f067-session-core\.mjs'/, file);
  }
});

void test('F067 the core module is free of side effects', () => {
  const text = readFileSync(CORE, 'utf8');
  // No I/O, no process control, no execution on import.
  for (const forbidden of [
    'node:child_process',
    'node:fs',
    'node:process',
    'spawnSync',
    'process.exit',
    'process.argv',
    'process.env',
    'readFileSync',
    'writeFileSync',
    'console.',
  ])
    assert.ok(!text.includes(forbidden), forbidden);
  // It computes paths, which touches no filesystem.
  assert.match(text, /from 'node:path'/);
  // No await or async anywhere in the code itself. Comments explain the
  // deadlock and necessarily mention `await`, so the check strips them first
  // rather than forcing the explanation out of the file.
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(!/\bawait\b/.test(code), 'no await in the core module');
  assert.ok(!/\basync\b/.test(code), 'no async function in the core module');
});

// --- bind-identity gates, through the real entry ------------------------------

const NO_SWITCHES = {
  REQRO_F067_UAT_AUTHORIZED: '',
  REQRO_F067_UAT_BIND_AUTHORIZED: '',
};

void test('F067 bind-identity requires an explicit mode and creates nothing', () => {
  const none = run(['bind-identity'], NO_SWITCHES);
  assertSettled(none, 'bind-identity');
  assert.equal(none.status, 2);
  const unknown = run(['bind-identity', '--force'], NO_SWITCHES);
  assert.equal(unknown.status, 2);
  assert.equal(existsSync(SESSION_FILE), false);
  assert.equal(existsSync(SECRET_FILE), false);
});

void test('F067 bind-identity --dry-run reads, connects and writes nothing', () => {
  const dry = run(['bind-identity', '--dry-run'], NO_SWITCHES);
  assertSettled(dry, 'bind-identity --dry-run');
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /nothing was read, connected or written/);
  assert.equal(existsSync(SESSION_FILE), false);
});

void test('F067 bind-identity live modes refuse without their switches, before reading anything', () => {
  const plan = run(['bind-identity', '--plan'], NO_SWITCHES);
  assertSettled(plan, 'bind-identity --plan');
  assert.equal(plan.status, 3);
  assert.match(plan.stderr, /requires an authorized F067 UAT session/);
  // The session switch alone never authorizes a binding write.
  const confirm = run(['bind-identity', '--confirm'], {
    ...NO_SWITCHES,
    REQRO_F067_UAT_AUTHORIZED: 'true',
  });
  assertSettled(confirm, 'bind-identity --confirm');
  assert.equal(confirm.status, 3);
  assert.match(confirm.stderr, /REQRO_F067_UAT_BIND_AUTHORIZED=true/);
  assert.equal(existsSync(SESSION_FILE), false);
  assert.equal(existsSync(SECRET_FILE), false);
});

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * F067 — the isolated interactive UAT session harness.
 *
 * Every decision in the harness is a pure function, so each refusal path is
 * proven here against fabricated input. These tests contact no PostgreSQL
 * server, require no Docker daemon and make no network call: nothing below
 * starts a container, applies a migration, writes a database row or issues a
 * credential. A test that needed any of those would be testing the
 * environment rather than the verdict.
 */

interface Verdict {
  ok: boolean;
  reasons: string[];
}
interface SessionVerdict extends Verdict {
  state: string;
}
interface RecoveryVerdict {
  action: string;
  state: string;
  reasons: string[];
}
interface HarnessModule {
  NATIVE_POSTGRES_PORT: number;
  PERSISTENT_DATABASES: readonly string[];
  UAT_DATABASE: string;
  OWNERSHIP_LABEL: string;
  SESSION_VERSION: number;
  SESSION_STATES: readonly string[];
  REQUIRED_FEATURE_MIGRATIONS: readonly string[];
  SESSION_FILE: string;
  UAT_ENV_FILE: string;
  redactUrl: (text: unknown) => string;
  evaluateSessionRecord: (record: unknown) => SessionVerdict;
  evaluateMigrationInventory: (input: unknown) => Verdict;
  evaluateDisposableTarget: (input: unknown) => Verdict;
  evaluateRecovery: (input: unknown) => RecoveryVerdict;
  evaluateCleanupOutcome: (result: unknown) => SessionVerdict;
  evaluateFixtureReadiness: (counts: unknown) => Verdict;
  evaluateStaffPrerequisites: (facts: unknown) => {
    ready: boolean;
    issuanceAvailable: boolean;
    blockers: string[];
  };
  evaluateSecretFileRequest: (input: unknown) => {
    ok: boolean;
    reasons: string[];
    mode: number;
    exclusive: boolean;
    windowsCaveat: string;
  };
  prepareSessionRecord: (input: unknown) => {
    ok: boolean;
    reasons: string[];
    record: Record<string, unknown> | null;
  };
  describeSession: (
    record: unknown,
    extra?: unknown,
  ) => { state: string; reasons: string[]; lines: string[] };
  readMigrationInventory: (root?: string) => string[];
  main: (argv?: string[]) => Promise<number>;
}

const harnessPath = resolve(__dirname, '../../../scripts/uat-f067-session.mjs');
const serverRoot = resolve(__dirname, '../../..');

async function harness(): Promise<HarnessModule> {
  return (await import(pathToFileURL(harnessPath).href)) as HarnessModule;
}

const NONCE = 'a1'.repeat(16);
const OTHER_NONCE = 'b2'.repeat(16);
const CONTAINER_ID = 'c3'.repeat(32);
const OTHER_CONTAINER_ID = 'd4'.repeat(32);
const DIGEST = `sha256:${'e5'.repeat(32)}`;
const REFERENCE = `postgres@${DIGEST}`;

/** A record that passes every shape check, so each test breaks exactly one. */
function record(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    state: 'active',
    container: 'reqro-f0592-pg17-0123456789abcdef',
    containerId: CONTAINER_ID,
    nonce: NONCE,
    port: 49251,
    database: 'reqro_f0592_test',
    role: 'reqro_test_user',
    epoch: '2026-10-20T01:00:00.000Z',
    imageReference: REFERENCE,
    imageRepositoryDigest: DIGEST,
    imageId: `sha256:${'f6'.repeat(32)}`,
    migrations: ['0001-a', '0002-b'],
    recordedAt: '2026-10-20T01:00:01.000Z',
    ...overrides,
  };
}

function url(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    hostname: '127.0.0.1',
    port: '49251',
    database: 'reqro_f0592_test',
    username: 'reqro_test_user',
    ...overrides,
  };
}

const F065_MIGRATION = '20261030000000-add-requester-intake-tracking-issuance';
const F066_MIGRATION = '20261031000000-add-submission-idempotency';
const INVENTORY = [F065_MIGRATION, F066_MIGRATION];

function migrations(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    required: [...INVENTORY],
    expected: [...INVENTORY],
    applied: [],
    ...overrides,
  };
}

function verification(outcome: string, detail = 'synthetic') {
  return { outcome, detail };
}

function cleanup(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    containerRemoved: true,
    volumeRemoved: true,
    volumeName: 'a'.repeat(64),
    refusal: null,
    containerVerification: verification('absent'),
    volumeVerification: verification('absent'),
    removalExitStatus: 0,
    removalDetail: null,
    ...overrides,
  };
}

const target = (overrides: Record<string, unknown> = {}) => ({
  identityRefusal: null,
  url: url(),
  record: record(),
  migrations: migrations(),
  ...overrides,
});

// --- 1. correct session lifecycle transitions ------------------------------

test('F067 the lifecycle vocabulary distinguishes every required stage', async () => {
  const { SESSION_STATES } = await harness();
  for (const state of [
    'prepared',
    'resource-created',
    'migrated',
    'fixture-ready',
    'active',
    'ended',
    'failed',
    'unknown',
  ])
    assert.ok(SESSION_STATES.includes(state), `${state} is a lifecycle state`);
});

test('F067 a well-formed record is accepted in each writable stage and refused otherwise', async () => {
  const { evaluateSessionRecord, evaluateDisposableTarget } = await harness();
  for (const state of [
    'resource-created',
    'migrated',
    'fixture-ready',
    'active',
  ]) {
    assert.equal(evaluateSessionRecord(record({ state })).ok, true, state);
    assert.equal(
      evaluateDisposableTarget(target({ record: record({ state }) })).ok,
      true,
      `${state} permits a write`,
    );
  }
  // A prepared session owns no resource yet; an ended one must never be
  // written to again. Both are valid records but neither authorizes a write.
  for (const state of ['prepared', 'ended', 'failed', 'unknown']) {
    assert.equal(
      evaluateSessionRecord(record({ state })).ok,
      true,
      `${state} is well formed`,
    );
    const verdict = evaluateDisposableTarget(
      target({ record: record({ state }) }),
    );
    assert.equal(verdict.ok, false, `${state} refuses a write`);
    assert.ok(
      verdict.reasons.some((r) =>
        r.includes('does not permit a database write'),
      ),
    );
  }
});

// --- 2. incorrect or expired session identity ------------------------------

test('F067 a malformed, versioned-forward or non-object record is refused as unknown', async () => {
  const { evaluateSessionRecord } = await harness();
  for (const bad of [null, undefined, 'session', 42, []]) {
    const verdict = evaluateSessionRecord(bad);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.state, 'unknown');
  }
  // An unrecognised version refuses rather than being read under today's
  // assumptions.
  assert.equal(evaluateSessionRecord(record({ version: 2 })).ok, false);
  assert.equal(evaluateSessionRecord(record({ version: undefined })).ok, false);
  for (const field of [
    'nonce',
    'containerId',
    'container',
    'role',
    'epoch',
    'imageReference',
  ])
    assert.equal(
      evaluateSessionRecord(record({ [field]: '' })).ok,
      false,
      `an empty ${field} is refused`,
    );
  assert.equal(
    evaluateSessionRecord(record({ epoch: 'not-a-time' })).ok,
    false,
  );
  assert.equal(evaluateSessionRecord(record({ nonce: 'XYZ' })).ok, false);
  assert.equal(evaluateSessionRecord(record({ containerId: 'abc' })).ok, false);
  // A digest-less reference cannot prove which image ran.
  assert.equal(
    evaluateSessionRecord(record({ imageReference: 'postgres:17' })).ok,
    false,
  );
  assert.equal(evaluateSessionRecord(record({ state: 'running' })).ok, false);
});

// --- 3. wrong database host ------------------------------------------------

test('F067 a non-loopback connected host is refused', async () => {
  const { evaluateDisposableTarget } = await harness();
  for (const hostname of [
    'localhost',
    '::1',
    '10.0.0.5',
    'db.example.test',
    '',
  ]) {
    const verdict = evaluateDisposableTarget(
      target({ url: url({ hostname }) }),
    );
    assert.equal(verdict.ok, false, hostname);
    assert.ok(verdict.reasons.some((r) => r.includes('must be 127.0.0.1')));
  }
});

// --- 4. the native 5432 port is refused ------------------------------------

test('F067 operating on the native PostgreSQL port is refused', async () => {
  const {
    evaluateDisposableTarget,
    evaluateSessionRecord,
    NATIVE_POSTGRES_PORT,
  } = await harness();
  assert.equal(NATIVE_POSTGRES_PORT, 5432);
  const verdict = evaluateDisposableTarget(
    target({ url: url({ port: '5432' }), record: record({ port: 5432 }) }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((r) => r.includes('native PostgreSQL service port')),
  );
  // Refused in the record too, so a stale file cannot authorize it later.
  assert.equal(evaluateSessionRecord(record({ port: 5432 })).ok, false);
  for (const port of [0, -1, 70000, 1.5, '49251']) {
    assert.equal(
      evaluateSessionRecord(record({ port })).ok,
      false,
      String(port),
    );
  }
});

// --- 5. persistent database name refused -----------------------------------

test('F067 a persistent database name is refused even on a loopback port', async () => {
  const { evaluateDisposableTarget, PERSISTENT_DATABASES, UAT_DATABASE } =
    await harness();
  assert.ok(PERSISTENT_DATABASES.includes('reqro_dev'));
  assert.equal(UAT_DATABASE, 'reqro_f0592_test');
  for (const database of ['reqro_dev', 'reqro_bootstrap', 'postgres', '']) {
    const verdict = evaluateDisposableTarget(
      target({ url: url({ database }) }),
    );
    assert.equal(verdict.ok, false, database);
    assert.ok(
      verdict.reasons.some((r) => r.includes(`must be ${UAT_DATABASE}`)),
    );
  }
  // Named explicitly so the refusal is unmistakable, not merely a mismatch.
  const dev = evaluateDisposableTarget(
    target({ url: url({ database: 'reqro_dev' }) }),
  );
  assert.ok(
    dev.reasons.some((r) =>
      r.includes('refusing to operate on the persistent database'),
    ),
  );
});

// --- 6, 7, 8. identity refusals are carried, never second-guessed ----------

test('F067 an instance-identity refusal fails the hard stop', async () => {
  const { evaluateDisposableTarget } = await harness();
  // Nonce, container ID, ownership label, denied volume, image and
  // loopback-publishing are all decided by refuseUnlessDisposable; the harness
  // must carry its refusal rather than re-deciding or overriding it.
  for (const refusal of [
    'the server nonce does not match this run',
    'the container ID does not match the one created by this run',
    'the container carries no com.reqro.disposable label',
    'the container label and the server nonce disagree',
    'the container mounts the persistent volume cityvue-postgres-data',
    'the container must publish to 127.0.0.1 only, got 0.0.0.0',
  ]) {
    const verdict = evaluateDisposableTarget(
      target({ identityRefusal: refusal }),
    );
    assert.equal(verdict.ok, false, refusal);
    assert.ok(verdict.reasons.some((r) => r.includes(refusal)));
  }
  // An absent verdict is not a pass.
  const missing = evaluateDisposableTarget(
    target({ identityRefusal: undefined }),
  );
  assert.equal(missing.ok, false);
  assert.ok(
    missing.reasons.some((r) => r.includes('no instance-identity verdict')),
  );
});

test('F067 the connected port must be the port this session recorded', async () => {
  const { evaluateDisposableTarget } = await harness();
  const verdict = evaluateDisposableTarget(
    target({ url: url({ port: '49999' }) }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((r) =>
      r.includes('not the port this session recorded'),
    ),
  );
});

// --- 10. missing or unexpected migration inventory -------------------------

test('F067 the migration inventory must be complete, ordered and carry F065/F066', async () => {
  const { evaluateMigrationInventory, REQUIRED_FEATURE_MIGRATIONS } =
    await harness();
  assert.deepEqual(
    [...REQUIRED_FEATURE_MIGRATIONS],
    [
      '20261030000000-add-requester-intake-tracking-issuance',
      '20261031000000-add-submission-idempotency',
    ],
  );
  assert.equal(evaluateMigrationInventory(migrations()).ok, true);
  assert.equal(evaluateMigrationInventory({ required: [] }).ok, false);
  assert.equal(evaluateMigrationInventory({ required: 'nope' }).ok, false);
  assert.equal(evaluateMigrationInventory({ required: ['ok', ''] }).ok, false);
  // Dropping either feature migration is refused by name.
  for (const name of REQUIRED_FEATURE_MIGRATIONS) {
    const required = INVENTORY.filter((entry) => entry !== name);
    const verdict = evaluateMigrationInventory({
      required,
      expected: required,
      applied: [],
    });
    assert.equal(verdict.ok, false, name);
    assert.ok(verdict.reasons.some((r) => r.includes(name)));
  }
  // Out of order, and duplicated.
  const reversed = [...INVENTORY].reverse();
  assert.equal(
    evaluateMigrationInventory({
      required: reversed,
      expected: reversed,
      applied: [],
    }).ok,
    false,
  );
  const duplicated = [F065_MIGRATION, F065_MIGRATION];
  assert.equal(
    evaluateMigrationInventory({
      required: duplicated,
      expected: duplicated,
      applied: [],
    }).ok,
    false,
  );
});

test('F067 a source tree that diverged from the recorded inventory is refused', async () => {
  const { evaluateMigrationInventory } = await harness();
  const verdict = evaluateMigrationInventory({
    required: [...INVENTORY, '20261101000000-added-later'],
    expected: [...INVENTORY],
    applied: [],
  });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((r) =>
      r.includes('no longer matches the inventory this session recorded'),
    ),
  );
});

// --- 9. no pre-existing migration state in a fresh target ------------------

test('F067 a target that already holds migration rows is not a fresh disposable database', async () => {
  const { evaluateMigrationInventory, evaluateDisposableTarget } =
    await harness();
  const verdict = evaluateMigrationInventory(
    migrations({
      applied: ['20261030000000-add-requester-intake-tracking-issuance'],
    }),
  );
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((r) =>
      r.includes('newly initialized disposable database'),
    ),
  );
  assert.equal(
    evaluateMigrationInventory(migrations({ applied: 'nope' })).ok,
    false,
  );
  // And it fails the composed hard stop, not merely the sub-check.
  assert.equal(
    evaluateDisposableTarget(
      target({ migrations: migrations({ applied: ['x'] }) }),
    ).ok,
    false,
  );
});

// --- 11. failed or partial migration --------------------------------------

test('F067 a partially applied inventory is never reported ready', async () => {
  const { evaluateFixtureReadiness, evaluateMigrationInventory } =
    await harness();
  // A partial apply shows up as applied rows on what should be a fresh target.
  const partial = evaluateMigrationInventory(
    migrations({ applied: [F065_MIGRATION] }),
  );
  assert.equal(partial.ok, false);
  // And fixtures built on a partial schema cannot satisfy the census.
  assert.equal(evaluateFixtureReadiness({}).ok, false);
});

// --- 12. synthetic fixture initialization failure -------------------------

test('F067 fixture readiness requires every scenario the UAT plan exercises', async () => {
  const { evaluateFixtureReadiness } = await harness();
  const complete = {
    organizations: 1,
    serviceDefinitions: 2,
    publicRequestsWithUpdates: 1,
    publicRequestsWithoutUpdates: 1,
    residentVisibleUpdates: 3,
    trackingManageGrants: 1,
    staffIdentities: 1,
  };
  assert.equal(evaluateFixtureReadiness(complete).ok, true);
  assert.equal(evaluateFixtureReadiness(null).ok, false);
  // A container existing proves nothing: each missing count refuses by name.
  for (const key of Object.keys(complete)) {
    const verdict = evaluateFixtureReadiness({ ...complete, [key]: 0 });
    assert.equal(verdict.ok, false, key);
    assert.ok(verdict.reasons.some((r) => r.includes(key)));
  }
  assert.equal(
    evaluateFixtureReadiness({ ...complete, organizations: -1 }).ok,
    false,
  );
  assert.equal(
    evaluateFixtureReadiness({ ...complete, organizations: 1.5 }).ok,
    false,
  );
});

// --- 13, 14. staff authorization and credential issuance ------------------

test('F067 staff prerequisites refuse a database-only identity without an Entra token', async () => {
  const { evaluateStaffPrerequisites } = await harness();
  const present = {
    staffIdentityPresent: true,
    trackingManageGranted: true,
    entraTenantId: '11111111-1111-4111-8111-111111111111',
    entraObjectId: '22222222-2222-4222-8222-222222222222',
    entraTokenAvailable: false,
  };
  const verdict = evaluateStaffPrerequisites(present);
  assert.equal(verdict.ready, false);
  assert.ok(
    verdict.blockers.some((b) =>
      b.includes('no Entra-authenticated staff token is available'),
    ),
  );
  // A synthetic row alone is explicitly insufficient.
  assert.equal(
    evaluateStaffPrerequisites({ ...present, staffIdentityPresent: false })
      .ready,
    false,
  );
  assert.ok(
    evaluateStaffPrerequisites({
      ...present,
      trackingManageGranted: false,
    }).blockers.some((b) => b.includes('service_request.tracking.manage')),
  );
  assert.equal(evaluateStaffPrerequisites(null).ready, false);
});

test('F067 credential issuance is never offered by the harness, even when every prerequisite is met', async () => {
  const { evaluateStaffPrerequisites } = await harness();
  const verdict = evaluateStaffPrerequisites({
    staffIdentityPresent: true,
    trackingManageGranted: true,
    entraTenantId: '11111111-1111-4111-8111-111111111111',
    entraObjectId: '22222222-2222-4222-8222-222222222222',
    entraTokenAvailable: true,
  });
  assert.equal(verdict.ready, true);
  assert.deepEqual(verdict.blockers, []);
  // Readiness is about the future approved session; the harness itself issues
  // nothing, so this stays false unconditionally.
  assert.equal(verdict.issuanceAvailable, false);
});

// --- 15. F065 automatic tracking stays off --------------------------------

test('F067 the harness never enables F065 automatic requester tracking', async () => {
  const source = resolve(serverRoot, 'scripts/uat-f067-session.mjs');
  assert.ok(existsSync(source));
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(source, 'utf8');
  // The flag is never assigned a truthy value anywhere in the harness.
  assert.equal(
    /REQRO_ENABLE_REQUESTER_INTAKE_TRACKING\s*[:=]\s*['"]?true/.test(text),
    false,
  );
  // Nor is a credential ever issued, rotated or inserted.
  assert.equal(
    /requester-tracking\/issue|insertInto\(\s*['"]request_tracking_credential/.test(
      text,
    ),
    false,
  );
});

// --- 16, 17. crash recovery ------------------------------------------------

test('F067 crash recovery removes only a container whose ID and nonce both match', async () => {
  const { evaluateRecovery } = await harness();
  const verdict = evaluateRecovery({
    record: record(),
    probe: {
      outcome: 'present',
      containerId: CONTAINER_ID,
      label: NONCE,
      candidates: [CONTAINER_ID],
    },
  });
  assert.equal(verdict.action, 'remove');
  assert.deepEqual(verdict.reasons, []);
});

test('F067 crash recovery refuses a missing, mismatched or contradictory identity', async () => {
  const { evaluateRecovery } = await harness();
  const base = {
    outcome: 'present',
    containerId: CONTAINER_ID,
    label: NONCE,
    candidates: [CONTAINER_ID],
  };
  // A different container, even under the right label.
  const wrongId = evaluateRecovery({
    record: record(),
    probe: { ...base, containerId: OTHER_CONTAINER_ID },
  });
  assert.equal(wrongId.action, 'refuse');
  assert.equal(wrongId.state, 'unknown');
  // The right container under someone else's nonce.
  const wrongLabel = evaluateRecovery({
    record: record(),
    probe: { ...base, label: OTHER_NONCE },
  });
  assert.equal(wrongLabel.action, 'refuse');
  // No label at all.
  assert.equal(
    evaluateRecovery({ record: record(), probe: { ...base, label: undefined } })
      .action,
    'refuse',
  );
  // Two containers claiming one nonce is contradictory, so nothing is removed.
  const duplicated = evaluateRecovery({
    record: record(),
    probe: { ...base, candidates: [CONTAINER_ID, OTHER_CONTAINER_ID] },
  });
  assert.equal(duplicated.action, 'refuse');
  assert.ok(duplicated.reasons.some((r) => r.includes('contradictory')));
  // An unusable record can never authorize a removal.
  assert.equal(
    evaluateRecovery({ record: { version: 9 }, probe: base }).action,
    'refuse',
  );
  assert.equal(
    evaluateRecovery({ record: record(), probe: null }).action,
    'refuse',
  );
  assert.equal(
    evaluateRecovery({ record: record(), probe: { outcome: 'weird' } }).action,
    'refuse',
  );
});

test('F067 an already-absent container ends the session without claiming it was removed here', async () => {
  const { evaluateRecovery } = await harness();
  const verdict = evaluateRecovery({
    record: record(),
    probe: { outcome: 'absent', detail: 'no such object' },
  });
  assert.equal(verdict.action, 'none');
  assert.equal(verdict.state, 'ended');
  assert.ok(verdict.reasons.some((r) => r.includes('already absent')));
});

// --- 18. Docker timeout and ambiguous cleanup -----------------------------

test('F067 an unconsultable Docker is UNKNOWN, never a successful cleanup', async () => {
  const { evaluateRecovery, evaluateCleanupOutcome } = await harness();
  const probe = evaluateRecovery({
    record: record(),
    probe: { outcome: 'unknown', detail: 'docker inspect timed out' },
  });
  assert.equal(probe.action, 'refuse');
  assert.equal(probe.state, 'unknown');
  for (const resource of ['container', 'volume']) {
    const verdict = evaluateCleanupOutcome(
      cleanup({
        [`${resource}Verification`]: verification(
          'unknown',
          'docker never answered',
        ),
      }),
    );
    assert.equal(verdict.ok, false, resource);
    assert.equal(
      verdict.state,
      'unknown',
      `${resource} ambiguity is unknown, not failed`,
    );
  }
  assert.equal(evaluateCleanupOutcome(null).state, 'unknown');
  assert.equal(evaluateCleanupOutcome('done').state, 'unknown');
});

// --- 19. container removed but the anonymous volume remains ---------------

test('F067 a surviving anonymous volume is a failure, not a rounded-up success', async () => {
  const { evaluateCleanupOutcome } = await harness();
  const verdict = evaluateCleanupOutcome(
    cleanup({
      volumeRemoved: false,
      volumeVerification: verification('present'),
    }),
  );
  assert.equal(verdict.ok, false);
  assert.equal(verdict.state, 'failed');
  assert.ok(
    verdict.reasons.some((r) => r.includes('volume was not verified absent')),
  );
  // A flag that disagrees with its own verification is refused too.
  const inconsistent = evaluateCleanupOutcome(
    cleanup({
      volumeRemoved: true,
      volumeVerification: verification('present'),
    }),
  );
  assert.equal(inconsistent.ok, false);
  assert.ok(
    inconsistent.reasons.some((r) =>
      r.includes('reported removed but its verification'),
    ),
  );
  // Only a fully verified teardown is `ended`.
  assert.deepEqual(evaluateCleanupOutcome(cleanup()), {
    ok: true,
    state: 'ended',
    reasons: [],
  });
  // A pre-action refusal is a failure with its reason preserved.
  const refused = evaluateCleanupOutcome(
    cleanup({ refusal: 'not an owned cleanup target' }),
  );
  assert.equal(refused.state, 'failed');
  assert.ok(
    refused.reasons.some((r) => r.includes('not an owned cleanup target')),
  );
});

// --- 20. no destructive action against unrelated resources ----------------

test('F067 the harness contains no system-wide prune or wildcard removal', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(
    resolve(serverRoot, 'scripts/uat-f067-session.mjs'),
    'utf8',
  );
  for (const forbidden of [
    'system prune',
    'volume prune',
    'container prune',
    'image prune',
    'rm -f $(',
    '--all',
    'pg_ctl',
    'net stop',
    'Stop-Service',
  ])
    assert.equal(
      text.includes(forbidden),
      false,
      `must not contain ${forbidden}`,
    );
  // The native service and the existing backend are never addressed.
  assert.equal(/localhost:3000|:3000\b/.test(text), false);
});

// --- 21. no credential leakage into output -------------------------------

test('F067 output redacts credentials and the status report carries none', async () => {
  const { redactUrl, describeSession, prepareSessionRecord } = await harness();
  const secret = 'Sup3rSecretPassw0rd';
  assert.equal(
    redactUrl(
      `postgresql://reqro_test_user:${secret}@127.0.0.1:49251/reqro_f0592_test`,
    ),
    'postgresql://reqro_test_user:***@127.0.0.1:49251/reqro_f0592_test',
  );
  assert.equal(
    redactUrl(`postgres://u:${secret}@h/db`).includes(secret),
    false,
  );
  const described = describeSession(record(), {
    identityRefusal: null,
    fixtures: null,
  });
  const text = described.lines.join('\n');
  assert.equal(text.includes(secret), false);
  // The nonce is truncated rather than printed whole, and no URL is shown.
  assert.equal(text.includes(NONCE), false);
  assert.equal(/postgres(ql)?:\/\//.test(text), false);
  // The record a real session would persist carries identity only.
  const prepared = prepareSessionRecord({
    cluster: {
      container: 'reqro-f0592-pg17-0123456789abcdef',
      containerId: CONTAINER_ID,
      nonce: NONCE,
      port: 49251,
      role: 'reqro_test_user',
      epoch: new Date('2026-10-20T01:00:00.000Z'),
      imageReference: REFERENCE,
      imageRepositoryDigest: DIGEST,
      imageId: `sha256:${'f6'.repeat(32)}`,
      testUrl: `postgresql://reqro_test_user:${secret}@127.0.0.1:49251/reqro_f0592_test`,
    },
    state: 'resource-created',
    migrations: INVENTORY,
    now: new Date('2026-10-20T01:00:01.000Z'),
  });
  assert.equal(prepared.ok, true);
  assert.equal(JSON.stringify(prepared.record).includes(secret), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(prepared.record, 'testUrl'),
    false,
  );
});

// --- 22. session-state corruption or replay ------------------------------

test('F067 a record carrying a secret field is refused rather than used', async () => {
  const { evaluateSessionRecord } = await harness();
  for (const field of [
    'password',
    'testUrl',
    'url',
    'connectionString',
    'secret',
  ]) {
    const verdict = evaluateSessionRecord(record({ [field]: 'anything' }));
    assert.equal(verdict.ok, false, field);
    assert.ok(
      verdict.reasons.some((r) =>
        r.includes(`forbidden secret field: ${field}`),
      ),
    );
  }
});

test('F067 a replayed record from another session cannot authorize this one', async () => {
  const { evaluateDisposableTarget, evaluateRecovery } = await harness();
  // The record is internally valid but describes a different container, so a
  // replayed file cannot be used to write to, or tear down, this instance.
  const replayed = record({
    containerId: OTHER_CONTAINER_ID,
    nonce: OTHER_NONCE,
  });
  const recovery = evaluateRecovery({
    record: replayed,
    probe: {
      outcome: 'present',
      containerId: CONTAINER_ID,
      label: NONCE,
      candidates: [CONTAINER_ID],
    },
  });
  assert.equal(recovery.action, 'refuse');
  // And a write is refused when the live identity disagrees.
  const write = evaluateDisposableTarget(
    target({
      record: replayed,
      identityRefusal: 'the server nonce does not match this run',
    }),
  );
  assert.equal(write.ok, false);
});

// --- 23. offline tests perform no real operation -------------------------

test('F067 the harness refuses --confirm and performs no operation in this build', async () => {
  const { main } = await harness();
  // --confirm is refused outright: this milestone authorizes no container,
  // migration, seeding, fixture or removal operation.
  assert.equal(await main(['start', '--confirm']), 3);
  assert.equal(await main(['end', '--confirm']), 3);
  // A mode is mandatory, so a bare command can never act by default.
  assert.equal(await main(['start']), 2);
  assert.equal(await main(['end']), 2);
  assert.equal(await main(['bogus', '--dry-run']), 2);
  assert.equal(await main(['--help']), 0);
  assert.equal(await main([]), 0);
});

test('F067 a dry run reads the real inventory and still touches nothing', async () => {
  const {
    main,
    readMigrationInventory,
    SESSION_FILE,
    UAT_ENV_FILE,
    REQUIRED_FEATURE_MIGRATIONS,
  } = await harness();
  const inventory = readMigrationInventory();
  // The real source inventory is read, and it genuinely carries F065 and F066.
  assert.ok(
    inventory.length >= 60,
    `expected the full inventory, got ${String(inventory.length)}`,
  );
  for (const name of REQUIRED_FEATURE_MIGRATIONS)
    assert.ok(inventory.includes(name), name);
  assert.equal(await main(['start', '--dry-run']), 0);
  assert.equal(await main(['end', '--dry-run']), 0);
  assert.equal(await main(['status']), 0);
  // No state file and no secret-bearing environment file were created.
  assert.equal(existsSync(SESSION_FILE), false);
  assert.equal(existsSync(UAT_ENV_FILE), false);
});

// --- secret-file policy ---------------------------------------------------

test('F067 a secret-bearing file requires a gitignored, exclusive, authorized write', async () => {
  const { evaluateSecretFileRequest, UAT_ENV_FILE } = await harness();
  assert.ok(UAT_ENV_FILE.endsWith('.env.uat'));
  const ok = evaluateSecretFileRequest({
    path: UAT_ENV_FILE,
    gitignored: true,
    exists: false,
    authorized: true,
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.mode, 0o600);
  assert.equal(ok.exclusive, true);
  // The Windows ACL limitation is stated rather than implied.
  assert.ok(ok.windowsCaveat.includes('inherited ACL'));
  for (const broken of [
    { gitignored: false },
    { exists: true },
    { authorized: false },
    { path: '' },
  ]) {
    const verdict = evaluateSecretFileRequest({
      path: UAT_ENV_FILE,
      gitignored: true,
      exists: false,
      authorized: true,
      ...broken,
    });
    assert.equal(verdict.ok, false, JSON.stringify(broken));
  }
});

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

/**
 * F067 — the live session orchestration contract.
 *
 * The orchestrator takes every effect as an injected object, so the complete
 * start-to-active and active-to-ended lifecycles run here against
 * deterministic mocks. Nothing below starts a container, connects to
 * PostgreSQL, writes a real file or makes a network call: a mock that was
 * never asked to do something is the assertion that the orchestrator did not
 * do it.
 */

interface Outcome {
  ok: boolean;
  state: string;
  reasons: string[];
  lines?: string[];
  record?: Record<string, unknown>;
  verified?: boolean;
  windowsCaveat?: string;
}
interface OrchestratorModule {
  runStart: (
    effects: unknown,
    input: { inventory: string[] },
  ) => Promise<Outcome>;
  runStatus: (
    effects: unknown,
    input: { inventory: string[] },
  ) => Promise<Outcome>;
  runEnd: (effects: unknown) => Promise<Outcome>;
  teardown: (
    effects: unknown,
    containerId: string,
    nonce: string,
  ) => Promise<Outcome>;
}
interface SessionModule {
  evaluateLock: (input: unknown) => {
    state: string;
    ok: boolean;
    reasons: string[];
  };
  evaluateSessionConflict: (record: unknown) => {
    ok: boolean;
    reasons: string[];
  };
}

const scripts = resolve(__dirname, '../../../scripts');
const orchestrator = async (): Promise<OrchestratorModule> =>
  (await import(
    pathToFileURL(resolve(scripts, 'uat-f067-orchestrator.mjs')).href
  )) as OrchestratorModule;
const session = async (): Promise<SessionModule> =>
  (await import(
    pathToFileURL(resolve(scripts, 'uat-f067-session.mjs')).href
  )) as SessionModule;

const NONCE = 'a1'.repeat(16);
const CONTAINER_ID = 'c3'.repeat(32);
const OTHER_ID = 'd4'.repeat(32);
const DIGEST = `sha256:${'e5'.repeat(32)}`;
const URL_STRING = `postgresql://reqro_test_user:S3cret@127.0.0.1:49251/reqro_f0592_test`;
const F065_MIGRATION = '20261030000000-add-requester-intake-tracking-issuance';
const F066_MIGRATION = '20261031000000-add-submission-idempotency';
const INVENTORY = [F065_MIGRATION, F066_MIGRATION];

/** Narrows the mock's persisted record, which is null until a session writes. */
function storedOf(mock: {
  _stored: () => Record<string, unknown> | null;
}): Record<string, unknown> {
  const value = mock._stored();
  assert.ok(value !== null, 'a session record was persisted');
  return value;
}

const READY_CENSUS = {
  organizations: 1,
  serviceDefinitions: 2,
  publicRequestsWithUpdates: 1,
  publicRequestsWithoutUpdates: 1,
  residentVisibleUpdates: 3,
  trackingManageGrants: 1,
  staffIdentities: 1,
};

const URL_FACTS = {
  hostname: '127.0.0.1',
  port: '49251',
  database: 'reqro_f0592_test',
  username: 'reqro_test_user',
};

const CLEAN_TEARDOWN = {
  containerRemoved: true,
  volumeRemoved: true,
  volumeName: 'a'.repeat(64),
  refusal: null,
  containerVerification: { outcome: 'absent', detail: 'gone' },
  volumeVerification: { outcome: 'absent', detail: 'gone' },
  removalExitStatus: 0,
  removalDetail: null,
};

/** A mock effects object. Each test overrides only what it is about. */
function effects(overrides: Record<string, unknown> = {}) {
  const calls: Record<string, number> = {};
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  let stored: Record<string, unknown> | null = null;
  let secret: string | null = null;
  let lock: Record<string, unknown> | null = null;
  let fixtureArguments: { url: string; nonce: string } | null = null;
  const base = {
    calls,
    testRole: 'reqro_test_user',
    secretPath: '/tmp/.env.uat',
    secretWriteAuthorized: true,
    now: () => new Date('2026-10-20T02:00:00.000Z'),
    dockerAvailable: () => {
      count('dockerAvailable');
      return true;
    },
    startCluster: async () => {
      count('startCluster');
      return {
        container: 'reqro-f0592-pg17-0123456789abcdef',
        containerId: CONTAINER_ID,
        nonce: NONCE,
        port: 49251,
        epoch: new Date('2026-10-20T01:59:00.000Z'),
        imageReference: `postgres@${DIGEST}`,
        imageRepositoryDigest: DIGEST,
        imageId: `sha256:${'f6'.repeat(32)}`,
        testUrl: URL_STRING,
        expectations: () => ({ database: 'reqro_f0592_test', nonce: NONCE }),
      };
    },
    collectEvidence: async () => {
      count('collectEvidence');
      return { url: URL_FACTS };
    },
    refuseUnlessDisposable: () => {
      count('refuseUnlessDisposable');
      return null;
    },
    expectationsFromRecord: async () => ({ database: 'reqro_f0592_test' }),
    listAppliedMigrations: async () => {
      count('listAppliedMigrations');
      return [];
    },
    applyMigrations: async () => {
      count('applyMigrations');
      return { applied: [...INVENTORY], error: null };
    },
    applyFixtures: async (url: string, nonce: string) => {
      count('applyFixtures');
      // Recorded so a test can prove the fixture process is handed the nonce
      // it needs to verify the destination for itself.
      fixtureArguments = { url, nonce };
      return { ...READY_CENSUS };
    },
    censusFixtures: async () => {
      count('censusFixtures');
      return { ...READY_CENSUS };
    },
    inspectContainer: (id: string) => {
      count('inspectContainer');
      return {
        outcome: 'present',
        containerId: id,
        label: NONCE,
        candidates: [id],
      };
    },
    removeContainerAndVolume: async () => {
      count('removeContainerAndVolume');
      return { ...CLEAN_TEARDOWN };
    },
    readSession: async () => stored,
    writeSession: async (record: Record<string, unknown>) => {
      count('writeSession');
      stored = record;
    },
    removeSession: async () => {
      count('removeSession');
      stored = null;
      return true;
    },
    readLock: async () => lock,
    lockOwnerAlive: async () => false,
    acquireLock: async () => {
      count('acquireLock');
      lock = { pid: 1234, acquiredAt: '2026-10-20T02:00:00.000Z' };
      return true;
    },
    releaseLock: async () => {
      count('releaseLock');
      lock = null;
    },
    secretPathGitignored: async () => true,
    secretExists: async () => secret !== null,
    writeSecret: async ({ url }: { url: string }) => {
      count('writeSecret');
      secret = url;
    },
    readSecretUrl: async () => {
      if (secret === null) throw new Error('no secret');
      return secret;
    },
    removeSecret: async () => {
      count('removeSecret');
      secret = null;
      return true;
    },
    // Test-only accessors.
    _stored: () => stored,
    _secret: () => secret,
    _lock: () => lock,
    _fixtureArguments: () => fixtureArguments,
    _setStored: (value: Record<string, unknown> | null) => {
      stored = value;
    },
    _setSecret: (value: string | null) => {
      secret = value;
    },
    _setLock: (value: Record<string, unknown> | null) => {
      lock = value;
    },
  };
  return { ...base, ...overrides } as typeof base & Record<string, unknown>;
}

// --- full mocked start-to-active lifecycle ---------------------------------

test('F067 a complete start reaches active only after every phase succeeds', async () => {
  const { runStart } = await orchestrator();
  const mock = effects();
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, true);
  assert.equal(result.state, 'active');
  assert.deepEqual(result.reasons, []);
  // Each phase ran exactly once, in order, and the lock was released.
  assert.equal(mock.calls.startCluster, 1);
  assert.equal(mock.calls.applyMigrations, 1);
  assert.equal(mock.calls.applyFixtures, 1);
  assert.equal(mock.calls.writeSecret, 1);
  assert.equal(mock.calls.releaseLock, 1);
  // Identity was rechecked before the fixture write, not only once.
  assert.equal(mock.calls.collectEvidence, 2);
  // Nothing was torn down on the happy path.
  assert.equal(mock.calls.removeContainerAndVolume, undefined);
  const stored = storedOf(mock);
  assert.equal(stored.state, 'active');
  // The Windows ACL limitation is surfaced to the caller, not buried.
  assert.ok(String(result.windowsCaveat).includes('inherited ACL'));
});

test('F067 the persisted record and reported output carry no credential', async () => {
  const { runStart } = await orchestrator();
  const mock = effects();
  const result = await runStart(mock, { inventory: INVENTORY });
  const stored = JSON.stringify(mock._stored());
  assert.equal(stored.includes('S3cret'), false);
  assert.equal(stored.includes(URL_STRING), false);
  assert.equal(JSON.stringify(result.reasons).includes('S3cret'), false);
  // The secret itself is held only in the session secret file.
  assert.equal(mock._secret(), URL_STRING);
});

// --- full mocked active-to-ended lifecycle --------------------------------

test('F067 a complete end verifies absence, deletes the secret and clears the record', async () => {
  const { runStart, runEnd } = await orchestrator();
  const mock = effects();
  await runStart(mock, { inventory: INVENTORY });
  const result = await runEnd(mock);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'ended');
  assert.equal(result.verified, true);
  assert.equal(mock.calls.removeContainerAndVolume, 1);
  assert.equal(mock.calls.removeSecret, 1);
  assert.equal(mock.calls.removeSession, 1);
  assert.equal(mock._stored(), null);
  assert.equal(mock._secret(), null);
  assert.equal(mock._lock(), null);
});

test('F067 ending with no recorded session removes nothing', async () => {
  const { runEnd } = await orchestrator();
  const mock = effects();
  const result = await runEnd(mock);
  assert.equal(result.state, 'none');
  assert.equal(mock.calls.removeContainerAndVolume, undefined);
  assert.equal(mock.calls.acquireLock, undefined);
});

// --- restarting the CLI process between commands --------------------------

test('F067 a second process recovers the session from the record alone', async () => {
  const { runStart, runStatus, runEnd } = await orchestrator();
  const first = effects();
  await runStart(first, { inventory: INVENTORY });
  const persisted = storedOf(first);
  const persistedSecret = first._secret();

  // A fresh effects object models a new process: no cluster closure survives,
  // only the record and the secret file on disk.
  const second = effects();
  second._setStored(persisted);
  second._setSecret(persistedSecret);
  const status = await runStatus(second, { inventory: INVENTORY });
  assert.equal(status.ok, true);
  assert.equal(status.state, 'active');
  assert.equal(second.calls.startCluster, undefined);

  const third = effects();
  third._setStored(persisted);
  third._setSecret(persistedSecret);
  const ended = await runEnd(third);
  assert.equal(ended.state, 'ended');
  assert.equal(third.calls.startCluster, undefined);
});

// --- readiness is verified against live facts ----------------------------

test('F067 status never claims readiness from the state file alone', async () => {
  const { runStatus } = await orchestrator();
  // Record present, container present and matching, but the secret is gone,
  // so in-band identity cannot be confirmed and readiness is withheld.
  const mock = effects();
  mock._setStored({
    version: 1,
    state: 'active',
    container: 'reqro-f0592-pg17-0123456789abcdef',
    containerId: CONTAINER_ID,
    nonce: NONCE,
    port: 49251,
    database: 'reqro_f0592_test',
    role: 'reqro_test_user',
    epoch: '2026-10-20T01:59:00.000Z',
    imageReference: `postgres@${DIGEST}`,
    imageRepositoryDigest: DIGEST,
    imageId: `sha256:${'f6'.repeat(32)}`,
    migrations: INVENTORY,
  });
  mock._setSecret(null);
  const result = await runStatus(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'unknown');
  assert.ok(
    result.reasons.some((r) =>
      r.includes('in-band database identity could not be confirmed'),
    ),
  );
  assert.equal(mock.calls.censusFixtures, undefined);
});

test('F067 status reports no session, ended, failed and unknown distinctly', async () => {
  const { runStatus } = await orchestrator();
  const none = effects();
  assert.equal((await runStatus(none, { inventory: INVENTORY })).state, 'none');
  assert.equal(none.calls.inspectContainer, undefined);

  const base = effects();
  await (await orchestrator()).runStart(base, { inventory: INVENTORY });
  const persisted = storedOf(base);

  // Absent container: the session is over.
  const gone = effects({
    inspectContainer: () => ({ outcome: 'absent', detail: 'no such object' }),
  });
  gone._setStored(persisted);
  gone._setSecret(URL_STRING);
  assert.equal(
    (await runStatus(gone, { inventory: INVENTORY })).state,
    'ended',
  );

  // Fixtures missing on a live instance: failed, not active.
  const broken = effects({
    censusFixtures: async () => ({
      ...READY_CENSUS,
      publicRequestsWithUpdates: 0,
    }),
  });
  broken._setStored(persisted);
  broken._setSecret(URL_STRING);
  const failed = await runStatus(broken, { inventory: INVENTORY });
  assert.equal(failed.ok, false);
  assert.equal(failed.state, 'failed');

  // Corrupt record: unknown.
  const corrupt = effects();
  corrupt._setStored({ version: 99 });
  assert.equal(
    (await runStatus(corrupt, { inventory: INVENTORY })).state,
    'unknown',
  );
});

// --- duplicate and concurrent sessions ------------------------------------

test('F067 a second start is refused while a session is recorded', async () => {
  const { runStart } = await orchestrator();
  const mock = effects();
  await runStart(mock, { inventory: INVENTORY });
  const again = await runStart(mock, { inventory: INVENTORY });
  assert.equal(again.ok, false);
  assert.ok(
    again.reasons.some((r) => r.includes('already recorded in state active')),
  );
  // Critically, no second container was created.
  assert.equal(mock.calls.startCluster, 1);
});

test('F067 a held lock refuses both start and end without touching anything', async () => {
  const { runStart, runEnd } = await orchestrator();
  const held = {
    readLock: async () => ({
      pid: 4321,
      acquiredAt: '2026-10-20T01:50:00.000Z',
    }),
    lockOwnerAlive: async () => true,
  };
  const startMock = effects(held);
  const start = await runStart(startMock, { inventory: INVENTORY });
  assert.equal(start.ok, false);
  assert.ok(start.reasons.some((r) => r.includes('holds the lock')));
  assert.equal(startMock.calls.startCluster, undefined);

  const endMock = effects(held);
  endMock._setStored({ version: 1, state: 'active' });
  const end = await runEnd(endMock);
  assert.equal(end.ok, false);
  assert.equal(endMock.calls.removeContainerAndVolume, undefined);
});

test('F067 a stale or unreadable lock is fail-closed, never auto-cleared', async () => {
  const { evaluateLock } = await session();
  const stale = evaluateLock({
    lock: { pid: 4321, acquiredAt: '2026-10-20T01:00:00.000Z' },
    pidAlive: false,
    now: new Date('2026-10-20T02:00:00.000Z'),
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.state, 'stale');
  assert.ok(
    stale.reasons.some((r) => r.includes('must be inspected with status')),
  );
  // Ambiguity about the owner is also a refusal.
  for (const lock of [
    { unreadable: true },
    { pid: 0, acquiredAt: 'x' },
    { pid: 7, acquiredAt: 'nope' },
    'lock',
  ]) {
    const verdict = evaluateLock({ lock, pidAlive: false, now: new Date() });
    assert.equal(verdict.ok, false, JSON.stringify(lock));
    assert.equal(verdict.state, 'ambiguous');
  }
  assert.equal(
    evaluateLock({
      lock: { pid: 7, acquiredAt: '2026-10-20T01:00:00.000Z' },
      pidAlive: null,
      now: new Date(),
    }).state,
    'ambiguous',
  );
  assert.equal(
    evaluateLock({ lock: null, pidAlive: false, now: new Date() }).state,
    'free',
  );
});

test('F067 a failure to acquire the lock exclusively refuses the session', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({ acquireLock: async () => false });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'unknown');
  assert.equal(mock.calls.startCluster, undefined);
});

test('F067 an unusable record blocks a new session rather than being discarded', async () => {
  const { evaluateSessionConflict } = await session();
  const verdict = evaluateSessionConflict({ version: 99 });
  assert.equal(verdict.ok, false);
  assert.ok(
    verdict.reasons.some((r) =>
      r.includes('may still describe a live container'),
    ),
  );
  // An ended session does not block a new one.
  assert.equal(evaluateSessionConflict(null).ok, true);
});

// --- incorrect database target and ownership -----------------------------

test('F067 a wrong database target aborts start and removes the container it made', async () => {
  const { runStart } = await orchestrator();
  for (const facts of [
    { ...URL_FACTS, hostname: 'localhost' },
    { ...URL_FACTS, port: '5432' },
    { ...URL_FACTS, database: 'reqro_dev' },
    { ...URL_FACTS, database: 'reqro_bootstrap' },
  ]) {
    const mock = effects({ collectEvidence: async () => ({ url: facts }) });
    const result = await runStart(mock, { inventory: INVENTORY });
    assert.equal(result.ok, false, JSON.stringify(facts));
    // No migration ran, and the container this attempt created was removed.
    assert.equal(mock.calls.applyMigrations, undefined);
    assert.equal(mock.calls.removeContainerAndVolume, 1);
    assert.equal(mock.calls.releaseLock, 1);
  }
});

test('F067 an instance-identity refusal aborts before any database write', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({
    refuseUnlessDisposable: () =>
      'the container label and the server nonce disagree',
  });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((r) =>
      r.includes('label and the server nonce disagree'),
    ),
  );
  assert.equal(mock.calls.applyMigrations, undefined);
  assert.equal(mock.calls.applyFixtures, undefined);
  assert.equal(mock.calls.writeSecret, undefined);
});

test('F067 a target that already holds migrations is refused as not fresh', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({ listAppliedMigrations: async () => [F065_MIGRATION] });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.some((r) =>
      r.includes('newly initialized disposable database'),
    ),
  );
  assert.equal(mock.calls.applyMigrations, undefined);
});

test('F067 teardown refuses a container whose ID or label does not match', async () => {
  const { teardown } = await orchestrator();
  const wrongId = effects({
    inspectContainer: () => ({
      outcome: 'present',
      containerId: OTHER_ID,
      label: NONCE,
      candidates: [OTHER_ID],
    }),
  });
  const a = await teardown(wrongId, CONTAINER_ID, NONCE);
  assert.equal(a.ok, false);
  assert.equal(wrongId.calls.removeContainerAndVolume, undefined);

  const wrongLabel = effects({
    inspectContainer: () => ({
      outcome: 'present',
      containerId: CONTAINER_ID,
      label: 'b2'.repeat(16),
      candidates: [CONTAINER_ID],
    }),
  });
  const b = await teardown(wrongLabel, CONTAINER_ID, NONCE);
  assert.equal(b.ok, false);
  assert.equal(wrongLabel.calls.removeContainerAndVolume, undefined);
});

// --- migration and fixture failure ---------------------------------------

test('F067 a reported migration error aborts and tears down', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({
    applyMigrations: async () => ({
      applied: [F065_MIGRATION],
      error: 'relation already exists',
    }),
  });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.ok(
    result.reasons.some((r) =>
      r.includes('migration reported an error after applying 1 of 2'),
    ),
  );
  assert.equal(mock.calls.applyFixtures, undefined);
  assert.equal(mock.calls.removeContainerAndVolume, 1);
});

test('F067 a silently partial migration is refused, not accepted', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({
    applyMigrations: async () => ({ applied: [F065_MIGRATION], error: null }),
  });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('so the schema is partial')));
  assert.equal(mock.calls.removeContainerAndVolume, 1);
});

test('F067 a migration that throws aborts and tears down', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({
    applyMigrations: async () => {
      throw new Error(`connection to ${URL_STRING} failed`);
    },
  });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  // The failure text is redacted before it reaches a report.
  assert.equal(JSON.stringify(result.reasons).includes('S3cret'), false);
  assert.equal(mock.calls.removeContainerAndVolume, 1);
});

test('F067 fixture failure and unmet readiness both abort the session', async () => {
  const { runStart } = await orchestrator();
  const thrown = effects({
    applyFixtures: async () => {
      throw new Error('seed failed');
    },
  });
  const a = await runStart(thrown, { inventory: INVENTORY });
  assert.equal(a.ok, false);
  assert.ok(a.reasons.some((r) => r.includes('fixture initialization failed')));
  assert.equal(thrown.calls.writeSecret, undefined);
  assert.equal(thrown.calls.removeContainerAndVolume, 1);

  const incomplete = effects({
    applyFixtures: async () => ({
      ...READY_CENSUS,
      publicRequestsWithoutUpdates: 0,
    }),
  });
  const b = await runStart(incomplete, { inventory: INVENTORY });
  assert.equal(b.ok, false);
  assert.ok(b.reasons.some((r) => r.includes('publicRequestsWithoutUpdates')));
  assert.equal(incomplete.calls.removeContainerAndVolume, 1);
});

test('F067 a cluster that fails to start leaves nothing to clean up', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({
    startCluster: async () => {
      throw new Error('docker run failed');
    },
  });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.equal(mock.calls.removeContainerAndVolume, undefined);
  assert.equal(mock.calls.writeSession, undefined);
  assert.equal(mock.calls.releaseLock, 1);
});

test('F067 an unavailable Docker refuses before the lock is taken', async () => {
  const { runStart } = await orchestrator();
  const mock = effects({ dockerAvailable: () => false });
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.equal(mock.calls.acquireLock, undefined);
  assert.equal(mock.calls.startCluster, undefined);
});

// --- secret handling ------------------------------------------------------

test('F067 an unsafe secret path aborts the session before the secret is written', async () => {
  const { runStart } = await orchestrator();
  for (const override of [
    { secretPathGitignored: async () => false },
    { secretWriteAuthorized: false },
  ]) {
    const mock = effects(override);
    const result = await runStart(mock, { inventory: INVENTORY });
    assert.equal(result.ok, false, JSON.stringify(Object.keys(override)));
    assert.ok(
      result.reasons.some((r) => r.includes('cannot be written safely')),
    );
    assert.equal(mock.calls.writeSecret, undefined);
    assert.equal(mock.calls.removeContainerAndVolume, 1);
  }
});

test('F067 an existing secret file is never overwritten', async () => {
  const { runStart } = await orchestrator();
  const mock = effects();
  mock._setSecret('postgresql://someone:else@127.0.0.1:1/x');
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('already exists')));
  assert.equal(mock.calls.writeSecret, undefined);
});

test('F067 a secret that cannot be verified deleted fails the end', async () => {
  const { runStart, runEnd } = await orchestrator();
  const mock = effects({ removeSecret: async () => false });
  await runStart(mock, { inventory: INVENTORY });
  const result = await runEnd(mock);
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.ok(
    result.reasons.some((r) =>
      r.includes('secret file could not be verified deleted'),
    ),
  );
  // The record is kept, so the session remains findable.
  assert.notEqual(mock._stored(), null);
});

// --- cleanup failure and crash recovery ---------------------------------

test('F067 a surviving anonymous volume fails the end and keeps the record', async () => {
  const { runStart, runEnd } = await orchestrator();
  const mock = effects({
    removeContainerAndVolume: async () => ({
      ...CLEAN_TEARDOWN,
      volumeRemoved: false,
      volumeVerification: { outcome: 'present', detail: 'still there' },
    }),
  });
  await runStart(mock, { inventory: INVENTORY });
  const result = await runEnd(mock);
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(mock.calls.removeSecret, undefined);
  assert.notEqual(mock._stored(), null);
});

test('F067 an ambiguous Docker answer is UNKNOWN and never converted to success', async () => {
  const { runStart, runEnd, runStatus, teardown } = await orchestrator();
  const timeout = effects({
    inspectContainer: () => ({
      outcome: 'unknown',
      detail: 'docker inspect timed out',
    }),
  });
  await runStart(timeout, { inventory: INVENTORY });
  const ended = await runEnd(timeout);
  assert.equal(ended.ok, false);
  assert.equal(ended.state, 'unknown');
  assert.equal(timeout.calls.removeContainerAndVolume, undefined);
  assert.equal(timeout.calls.removeSession, undefined);

  const status = await runStatus(timeout, { inventory: INVENTORY });
  assert.equal(status.state, 'unknown');

  // Ambiguous absence verification after a removal is also unknown.
  const ambiguous = effects({
    removeContainerAndVolume: async () => ({
      ...CLEAN_TEARDOWN,
      containerVerification: {
        outcome: 'unknown',
        detail: 'daemon never answered',
      },
    }),
  });
  const verdict = await teardown(ambiguous, CONTAINER_ID, NONCE);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.state, 'unknown');
});

test('F067 crash recovery ends a session whose container is already absent', async () => {
  const { runStart, runEnd } = await orchestrator();
  const mock = effects();
  await runStart(mock, { inventory: INVENTORY });
  // Model a crash followed by the container disappearing.
  const recovered = effects({
    inspectContainer: () => ({ outcome: 'absent', detail: 'no such object' }),
  });
  recovered._setStored(mock._stored());
  recovered._setSecret(mock._secret());
  const result = await runEnd(recovered);
  assert.equal(result.ok, true);
  assert.equal(result.state, 'ended');
  // Nothing was removed by this process, and it says so rather than claiming
  // a verified teardown.
  assert.equal(result.verified, false);
  assert.equal(recovered.calls.removeContainerAndVolume, undefined);
  assert.equal(recovered.calls.removeSecret, 1);
});

test('F067 crash recovery refuses when two containers claim one nonce', async () => {
  const { teardown } = await orchestrator();
  const mock = effects({
    inspectContainer: () => ({
      outcome: 'present',
      containerId: CONTAINER_ID,
      label: NONCE,
      candidates: [CONTAINER_ID, OTHER_ID],
    }),
  });
  const result = await teardown(mock, CONTAINER_ID, NONCE);
  assert.equal(result.ok, false);
  assert.ok(result.reasons.some((r) => r.includes('contradictory')));
  assert.equal(mock.calls.removeContainerAndVolume, undefined);
});

// --- no real Docker, PostgreSQL or filesystem interaction ---------------

test('F067 the orchestrator performs no effect it was not given', async () => {
  const { runStart } = await orchestrator();
  // Every effect is injected, so an orchestrator that reached for a real
  // daemon, server or file would throw here rather than succeed.
  const mock = effects();
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.ok, true);
  for (const name of [
    'startCluster',
    'applyMigrations',
    'applyFixtures',
    'writeSecret',
  ]) {
    assert.equal(mock.calls[name], 1, `${name} came from the mock`);
  }
});

test('F067 the effects module is the only place that touches Docker or pg', async () => {
  const { readFileSync } = await import('node:fs');
  const orchestratorSource = readFileSync(
    resolve(scripts, 'uat-f067-orchestrator.mjs'),
    'utf8',
  );
  for (const forbidden of [
    'spawnSync',
    "from 'pg'",
    'child_process',
    'node:fs',
  ]) {
    assert.equal(
      orchestratorSource.includes(forbidden),
      false,
      `the orchestrator must not import ${forbidden}`,
    );
  }
  const effectsSource = readFileSync(
    resolve(scripts, 'uat-f067-effects.mjs'),
    'utf8',
  );
  // No broad cleanup, and no interference with unrelated processes.
  for (const forbidden of [
    'system prune',
    'volume prune',
    'container prune',
    '--all',
    'pg_ctl',
    'Stop-Service',
    'taskkill',
  ])
    assert.equal(
      effectsSource.includes(forbidden),
      false,
      `must not contain ${forbidden}`,
    );
  // Process existence is tested with signal 0, which delivers no signal.
  assert.ok(effectsSource.includes('process.kill(lock.pid, 0)'));
});

// --- F065 and staff authentication boundaries ---------------------------

test('F067 neither orchestration file enables F065 or issues a credential', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['uat-f067-orchestrator.mjs', 'uat-f067-effects.mjs']) {
    const text = readFileSync(resolve(scripts, file), 'utf8');
    assert.equal(
      /REQRO_ENABLE_REQUESTER_INTAKE_TRACKING\s*[:=]\s*['"]?true/.test(text),
      false,
      `${file} must not enable F065`,
    );
    assert.equal(
      /requester-tracking\/issue|insertInto\(\s*['"]request_tracking_credential|into request_tracking_credential/.test(
        text,
      ),
      false,
      `${file} must not issue a credential`,
    );
    // No staff guard is bypassed and no token is fabricated.
    assert.equal(
      /StaffAccessGuard|Bearer |jwtVerify|entra_object_id\s*=/.test(text),
      false,
      file,
    );
  }
});

test('F067 the fixture step reuses seed:development and weakens no guard', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(resolve(scripts, 'uat-f067-effects.mjs'), 'utf8');
  assert.ok(text.includes('src/database/seed-development.ts'));
  // The persistent-database guard is neither imported nor invoked. It may be
  // named in a comment explaining why it is left alone, which is not the same
  // as touching it, so the check is for an import or a call.
  assert.equal(/import\s[^;]*assertDevelopmentDatabaseUrl/.test(text), false);
  assert.equal(/assertDevelopmentDatabaseUrl\s*\(/.test(text), false);
  // No persistent database is ever named as a target.
  assert.equal(/DATABASE_URL\s*[:=]\s*['"][^'"]*reqro_dev/.test(text), false);
  assert.equal(text.includes('reqro_dev'), false);
});

test('F067 the fixture step is handed this run nonce so it can prove the destination itself', async () => {
  const { runStart } = await orchestrator();
  const mock = effects();
  const result = await runStart(mock, { inventory: INVENTORY });
  assert.equal(result.state, 'active');
  const handed = mock._fixtureArguments();
  assert.ok(handed !== null);
  assert.equal(handed.nonce, NONCE);
  assert.equal(handed.url, URL_STRING);
});

test('F067 the fixture step invokes the F067 tracking fixture with the nonce and the disposable role', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(resolve(scripts, 'uat-f067-effects.mjs'), 'utf8');
  assert.ok(text.includes('src/database/uat-f067-tracking-fixture-cli.ts'));
  assert.ok(text.includes('REQRO_F067_UAT_DISPOSABLE_NONCE: nonce'));
  assert.ok(text.includes('REQRO_F067_UAT_DISPOSABLE_ROLE: TEST_ROLE'));
  // The grant the UAT scenario needs is measured, not assumed.
  assert.ok(text.includes('trackingManageGrants'));
  assert.ok(text.includes("permission_key='service_request.tracking.manage'"));
  // Still no credential issuance anywhere in the effects.
  assert.equal(text.includes('request_tracking_credential'), false);
  assert.equal(text.includes('requester-tracking/issue'), false);
});

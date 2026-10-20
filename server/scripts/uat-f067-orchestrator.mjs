/**
 * F067 — live orchestration for the isolated interactive UAT session.
 *
 * The verdicts live in `uat-f067-session-core.mjs`; this file sequences them and
 * performs the effects. Every effect is injected, so the complete
 * start-to-active and active-to-ended lifecycles are exercised offline
 * against deterministic mocks: no Docker daemon, no PostgreSQL server and no
 * network are touched by the tests.
 *
 * Three properties shape the sequencing.
 *
 * A `DisposableCluster` is a process-local closure, so nothing it holds
 * survives the `start` process exiting. `status` and `end` therefore
 * reconstruct what they need from the recorded container ID and nonce and
 * re-verify against Docker, rather than trusting a name prefix.
 *
 * The generated role password exists only inside the cluster's URL. It is
 * never written to the session record and never printed. Continuity for the
 * UAT backend comes from a separate, gitignored, exclusively created secret
 * file, which `end` deletes and verifies gone.
 *
 * Identity is rechecked immediately before each database-writing phase, not
 * once at the start, because a container can be replaced between phases.
 */
import {
  UAT_DATABASE,
  describeSession,
  evaluateCleanupOutcome,
  evaluateDisposableTarget,
  evaluateFixtureReadiness,
  evaluateLock,
  evaluateMigrationInventory,
  evaluateRecovery,
  evaluateSessionConflict,
  evaluateSessionRecord,
  evaluateSecretFileRequest,
  prepareSessionRecord,
  redactUrl,
} from './uat-f067-session-core.mjs';

/** A phase failure carries the state the session should be recorded in. */
function failure(state, reasons) {
  return {
    ok: false,
    state,
    reasons: Array.isArray(reasons) ? reasons : [reasons],
  };
}

/**
 * The hard stop, run before every database write.
 *
 * `collectEvidence` reads the live URL, SQL and Docker facts;
 * `refuseUnlessDisposable` remains the sole authority on whether the instance
 * is disposable. This adds only the port, persistent-name and
 * migration-state guarantees that predicate does not express.
 */
async function verifyTarget(
  effects,
  { record, expectations, url, expectedInventory, requireFresh },
) {
  let evidence;
  try {
    evidence = await effects.collectEvidence(url, expectations);
  } catch (error) {
    return failure('unknown', [
      `instance evidence could not be collected: ${redactUrl(error?.message ?? error)}`,
    ]);
  }
  // The fresh check precedes migrations; every later check follows them. The
  // phase only selects which rule applies -- it accepts nothing by itself. In
  // the `migrated` rule an application schema passes solely because the live
  // history read on this same connection records its creating migration, and
  // every other schema still refuses.
  const identityRefusal = effects.refuseUnlessDisposable(evidence, {
    phase: requireFresh ? 'fresh' : 'migrated',
  });
  let applied = null;
  if (requireFresh) {
    try {
      applied = await effects.listAppliedMigrations(url);
    } catch (error) {
      return failure('unknown', [
        `the applied-migration list could not be read: ${redactUrl(error?.message ?? error)}`,
      ]);
    }
  }
  const verdict = evaluateDisposableTarget({
    identityRefusal,
    url: evidence?.url ?? null,
    record,
    migrations: {
      required: expectedInventory,
      expected: record?.migrations ?? null,
      applied,
    },
  });
  return verdict.ok
    ? { ok: true, state: record.state, reasons: [] }
    : failure('failed', verdict.reasons);
}

/**
 * `start`.
 *
 * Ordered so that nothing is created before the cheap refusals have run, and
 * so that anything created is recorded before it is used. A failure after the
 * container exists tears that container down -- it is this session's own
 * resource, identified by the ID just recorded -- and reports the originating
 * reason rather than the teardown.
 */
export async function runStart(effects, { inventory }) {
  const lock = evaluateLock({
    lock: await effects.readLock(),
    pidAlive: await effects.lockOwnerAlive(),
    now: effects.now(),
  });
  if (!lock.ok)
    return failure(lock.state === 'held' ? 'active' : 'unknown', lock.reasons);

  const conflict = evaluateSessionConflict(await effects.readSession());
  if (!conflict.ok) return failure('failed', conflict.reasons);

  const census = evaluateMigrationInventory({
    required: inventory,
    expected: null,
    applied: [],
  });
  if (!census.ok) return failure('failed', census.reasons);

  if (!effects.dockerAvailable())
    return failure('failed', [
      'Docker is unavailable, so no disposable instance can be provisioned',
    ]);

  if (!(await effects.acquireLock()))
    return failure('unknown', [
      'the session lock could not be acquired exclusively',
    ]);

  let cluster;
  try {
    try {
      cluster = await effects.startCluster();
    } catch (error) {
      return failure('failed', [
        `the disposable cluster did not start: ${redactUrl(error?.message ?? error)}`,
      ]);
    }

    const prepared = prepareSessionRecord({
      cluster: { ...cluster, role: effects.testRole },
      state: 'resource-created',
      migrations: inventory,
      now: effects.now(),
    });
    if (!prepared.ok) {
      // The record is how `end` finds this container. Without a valid one the
      // container is unrecoverable by identity, so it is removed immediately.
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', [
        'the session record could not be prepared',
        ...prepared.reasons,
      ]);
    }
    await effects.writeSession(prepared.record);

    const expectations = cluster.expectations();
    const url = cluster.testUrl;

    const before = await verifyTarget(effects, {
      record: prepared.record,
      expectations,
      url,
      expectedInventory: inventory,
      requireFresh: true,
    });
    if (!before.ok) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure(before.state, before.reasons);
    }

    let migrated;
    try {
      // The nonce goes with it: the migration process re-proves the
      // destination in band before it applies a single statement, and it
      // reads the declared inventory from source rather than trusting ours.
      migrated = await effects.applyMigrations(url, cluster.nonce);
    } catch (error) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', [
        `migration failed: ${redactUrl(error?.message ?? error)}`,
      ]);
    }
    const appliedNames = Array.isArray(migrated?.applied)
      ? migrated.applied
      : [];
    if (migrated?.error) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', [
        `migration reported an error after applying ${String(appliedNames.length)} of ${String(inventory.length)}: ${redactUrl(migrated.error)}`,
      ]);
    }
    if (appliedNames.length !== inventory.length) {
      // A partial apply leaves a schema that does not match the source. It is
      // never left available for UAT.
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', [
        `migration applied ${String(appliedNames.length)} of ${String(inventory.length)} migrations, so the schema is partial`,
      ]);
    }
    await effects.writeSession({ ...prepared.record, state: 'migrated' });

    // Rechecked here: the previous verification happened before the schema
    // existed, and a container can be replaced between phases.
    const beforeFixtures = await verifyTarget(effects, {
      record: { ...prepared.record, state: 'migrated' },
      expectations,
      url,
      expectedInventory: inventory,
      requireFresh: false,
    });
    if (!beforeFixtures.ok) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure(beforeFixtures.state, beforeFixtures.reasons);
    }

    let fixtures;
    try {
      // The nonce goes with it: the fixture process proves the destination
      // independently by reading this value back from the server in band.
      fixtures = await effects.applyFixtures(url, cluster.nonce);
    } catch (error) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', [
        `fixture initialization failed: ${redactUrl(error?.message ?? error)}`,
      ]);
    }
    const readiness = evaluateFixtureReadiness(fixtures);
    if (!readiness.ok) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', readiness.reasons);
    }
    await effects.writeSession({ ...prepared.record, state: 'fixture-ready' });

    const secret = evaluateSecretFileRequest({
      path: effects.secretPath,
      gitignored: await effects.secretPathGitignored(),
      exists: await effects.secretExists(),
      authorized: effects.secretWriteAuthorized === true,
    });
    if (!secret.ok) {
      await teardown(effects, cluster.containerId, cluster.nonce);
      return failure('failed', [
        'the session secret file cannot be written safely',
        ...secret.reasons,
      ]);
    }
    await effects.writeSecret({
      url,
      mode: secret.mode,
      exclusive: secret.exclusive,
    });

    const active = { ...prepared.record, state: 'active' };
    await effects.writeSession(active);
    // Readiness is reported only here, after identity, a complete migration,
    // fixture readiness and a safe secret file have all succeeded.
    return {
      ok: true,
      state: 'active',
      reasons: [],
      record: active,
      windowsCaveat: secret.windowsCaveat,
    };
  } finally {
    await effects.releaseLock();
  }
}

/**
 * Targeted teardown for one recorded container.
 *
 * `verifyCleanup` stays the authority on absence, and
 * `refuseUnlessOwnedCleanupTarget` runs before `docker rm`, so a wrong
 * container is refused rather than removed. Ownership requires the container
 * ID and the nonce label to agree; a name prefix is never sufficient.
 */
export async function teardown(effects, containerId, nonce) {
  const probe = await effects.inspectContainer(containerId);
  const recovery = evaluateRecovery({
    record: {
      version: 1,
      state: 'active',
      container: 'recorded',
      containerId,
      nonce,
      port: 49251,
      database: UAT_DATABASE,
      role: effects.testRole,
      epoch: new Date(0).toISOString(),
      imageReference: `postgres@sha256:${'0'.repeat(64)}`,
    },
    probe,
  });
  if (recovery.action === 'none')
    return {
      ok: true,
      state: 'ended',
      reasons: recovery.reasons,
      verified: false,
    };
  if (recovery.action !== 'remove')
    return failure(recovery.state, recovery.reasons);
  const result = await effects.removeContainerAndVolume(containerId);
  const verdict = evaluateCleanupOutcome(result);
  return verdict.ok
    ? { ok: true, state: 'ended', reasons: [], verified: true }
    : failure(verdict.state, verdict.reasons);
}

/**
 * `status`.
 *
 * Never reports readiness from the state file. The recorded container is
 * re-inspected and its ID and ownership label compared; in-band SQL identity
 * is additionally confirmed when the session secret is available, and its
 * absence is reported as unavailable verification rather than as a pass.
 */
export async function runStatus(effects, { inventory }) {
  const record = await effects.readSession();
  if (record === null || record === undefined)
    return {
      ok: true,
      state: 'none',
      reasons: [],
      lines: ['state                no session recorded'],
    };

  const session = evaluateSessionRecord(record);
  if (!session.ok)
    return failure('unknown', [
      'the session record is not usable',
      ...session.reasons,
    ]);

  const probe = await effects.inspectContainer(record.containerId);
  const recovery = evaluateRecovery({ record, probe });
  const lines = [...describeSession(record).lines];

  if (recovery.action === 'none')
    return {
      ok: true,
      state: 'ended',
      reasons: recovery.reasons,
      lines: [...lines, 'container             absent — the session is over'],
    };
  if (recovery.action !== 'remove')
    return { ...failure('unknown', recovery.reasons), lines };

  lines.push(
    'container            present, ID and ownership label match this session',
  );

  const secretAvailable = await effects.secretExists();
  if (!secretAvailable)
    return {
      ok: false,
      state: 'unknown',
      reasons: [
        'the session secret is unavailable, so in-band database identity could not be confirmed; Docker ownership alone does not establish readiness',
      ],
      lines,
    };

  const url = await effects.readSecretUrl();
  const verified = await verifyTarget(effects, {
    record,
    expectations: await effects.expectationsFromRecord(record),
    url,
    expectedInventory: inventory,
    requireFresh: false,
  });
  if (!verified.ok)
    return { ...failure(verified.state, verified.reasons), lines };

  let fixtures;
  try {
    fixtures = await effects.censusFixtures(url);
  } catch (error) {
    return {
      ok: false,
      state: 'unknown',
      reasons: [
        `the fixture census could not be read: ${redactUrl(error?.message ?? error)}`,
      ],
      lines,
    };
  }
  const readiness = evaluateFixtureReadiness(fixtures);
  lines.push(`instance identity    verified in band`);
  lines.push(`fixtures             ${readiness.ok ? 'ready' : 'NOT ready'}`);
  return readiness.ok
    ? { ok: true, state: 'active', reasons: [], lines }
    : { ...failure('failed', readiness.reasons), lines };
}

/**
 * `end`.
 *
 * Removes this session's container and its anonymous volume only, verifies
 * both are absent, deletes the secret file and verifies that too. Reports
 * `ended` only when every one of those is positively confirmed.
 */
export async function runEnd(effects) {
  const lock = evaluateLock({
    lock: await effects.readLock(),
    pidAlive: await effects.lockOwnerAlive(),
    now: effects.now(),
  });
  if (!lock.ok)
    return failure(lock.state === 'held' ? 'active' : 'unknown', lock.reasons);

  const record = await effects.readSession();
  if (record === null || record === undefined)
    return {
      ok: true,
      state: 'none',
      reasons: ['no session is recorded; nothing to end'],
    };
  const session = evaluateSessionRecord(record);
  if (!session.ok)
    return failure('unknown', [
      'the session record is not usable',
      ...session.reasons,
    ]);

  if (!(await effects.acquireLock()))
    return failure('unknown', [
      'the session lock could not be acquired exclusively',
    ]);
  try {
    const removed = await teardown(effects, record.containerId, record.nonce);
    if (!removed.ok) return removed;

    // The secret outlives the container otherwise, so its deletion is part of
    // ending the session and is verified rather than assumed.
    const secretGone = await effects.removeSecret();
    if (secretGone !== true)
      return failure('failed', [
        'the session secret file could not be verified deleted',
      ]);

    await effects.removeSession();
    return {
      ok: true,
      state: 'ended',
      reasons: removed.verified ? [] : removed.reasons,
      verified: removed.verified === true,
    };
  } finally {
    await effects.releaseLock();
  }
}

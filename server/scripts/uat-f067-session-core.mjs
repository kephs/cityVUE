/**
 * F067 — the disposable UAT session's shared definitions.
 *
 * Constants, path locations and pure verdicts, with no side effect of any
 * kind: nothing here reads a file, spawns a process, opens a socket, writes
 * output or terminates the process. Importing this module does nothing but
 * define values, which is the property that makes it safe for every other
 * F067 module to depend on it.
 *
 * It exists because the CLI entry used to hold these definitions. The
 * orchestrator and the effects both import them, so when the entry was run
 * directly its own `await main()` suspended its evaluation while `main()`
 * dynamically imported those two modules -- each of which statically imported
 * the suspended entry. ES module linking cannot complete that cycle: the
 * promise never settled, the event loop emptied and Node exited 13 with no
 * output at all. `start --dry-run` worked precisely because it never reached
 * those imports.
 *
 * Moving the shared definitions here removes the cycle rather than reordering
 * it. Nothing imports the CLI entry now, so no amount of top-level await in
 * an entry can deadlock a dependency again. A regression test asserts that
 * no module imports the entry, and child-process tests run the real CLI.
 */
import { dirname, resolve } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

/** The native PostgreSQL service port. A disposable session must never use it. */
export const NATIVE_POSTGRES_PORT = 5432;
/** The persistent development database, named here only to be refused. */
export const PERSISTENT_DATABASES = Object.freeze([
  'reqro_dev',
  'reqro_bootstrap',
]);
/** The disposable database the cluster helper creates. */
export const UAT_DATABASE = 'reqro_f0592_test';
/** The Docker label the cluster helper applies, carrying the session nonce. */
export const OWNERSHIP_LABEL = 'com.reqro.disposable';
/** Bumped when the persisted record's shape changes incompatibly. */
export const SESSION_VERSION = 1;

/**
 * The migrations whose presence this harness must positively confirm, because
 * the F067 tracking read path depends on them: F065 adds
 * `request_tracking_credential.expires_at`, which the resolver filters on, and
 * F066 adds the submission idempotency table the intake path writes.
 */
export const REQUIRED_FEATURE_MIGRATIONS = Object.freeze([
  '20261030000000-add-requester-intake-tracking-issuance',
  '20261031000000-add-submission-idempotency',
]);

/**
 * The session lifecycle. `unknown` is a real state, not an error code: an
 * ambiguous Docker answer must never be reported as `ended`.
 */
export const SESSION_STATES = Object.freeze([
  'prepared',
  'resource-created',
  'migrated',
  'fixture-ready',
  'active',
  'ended',
  'failed',
  'unknown',
]);

/** States from which the database may still be written by this harness. */
const WRITABLE_STATES = Object.freeze([
  'resource-created',
  'migrated',
  'fixture-ready',
  'active',
]);

/** Replaces a password inside any postgres URL. Applied to every output line. */
export function redactUrl(text) {
  return String(text).replace(
    /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]*@/g,
    '$1***@',
  );
}

/** A canonical 32-character hex nonce, as `randomUUID` without dashes yields. */
const NONCE = /^[0-9a-f]{32}$/;
/** A 64-character hex container ID, as `docker run --detach` prints. */
const CONTAINER_ID = /^[0-9a-f]{64}$/;

/**
 * Validates a persisted session record before anything is done with it.
 *
 * A corrupt, truncated, replayed or hand-edited record must not be able to
 * authorize a write or a removal, so every field is checked for shape rather
 * than merely for presence. An unrecognised version refuses instead of being
 * interpreted under today's assumptions.
 */
export function evaluateSessionRecord(record) {
  const reasons = [];
  if (record === null || typeof record !== 'object' || Array.isArray(record))
    return {
      ok: false,
      state: 'unknown',
      reasons: ['the session record is not an object'],
    };
  if (record.version !== SESSION_VERSION)
    reasons.push(
      `the session record version ${String(record.version)} is not the supported version ${String(SESSION_VERSION)}`,
    );
  if (
    typeof record.state !== 'string' ||
    !SESSION_STATES.includes(record.state)
  )
    reasons.push(
      `the session state ${String(record.state)} is not a known state`,
    );
  if (typeof record.nonce !== 'string' || !NONCE.test(record.nonce))
    reasons.push('the session nonce is not a canonical 32-character hex value');
  if (
    typeof record.containerId !== 'string' ||
    !CONTAINER_ID.test(record.containerId)
  )
    reasons.push(
      'the session container ID is not a canonical 64-character hex value',
    );
  if (typeof record.container !== 'string' || record.container.trim() === '')
    reasons.push('the session container name is empty');
  if (!Number.isInteger(record.port) || record.port < 1 || record.port > 65535)
    reasons.push('the session port is not a valid TCP port');
  else if (record.port === NATIVE_POSTGRES_PORT)
    reasons.push(
      `the session port is ${String(NATIVE_POSTGRES_PORT)}, the native PostgreSQL service port`,
    );
  if (record.database !== UAT_DATABASE)
    reasons.push(
      `the session database must be ${UAT_DATABASE}, got ${String(record.database)}`,
    );
  if (typeof record.role !== 'string' || record.role.trim() === '')
    reasons.push('the session role is empty');
  if (
    typeof record.epoch !== 'string' ||
    Number.isNaN(Date.parse(record.epoch))
  )
    reasons.push('the session epoch is not a valid timestamp');
  if (
    typeof record.imageReference !== 'string' ||
    !record.imageReference.includes('@sha256:')
  )
    reasons.push('the session image reference does not carry a digest');
  // A record must never carry a credential. If one is present the file has
  // been written by something other than this harness, or by an older unsafe
  // version, and it is refused rather than used.
  for (const key of [
    'password',
    'testUrl',
    'url',
    'connectionString',
    'secret',
  ])
    if (Object.prototype.hasOwnProperty.call(record, key))
      reasons.push(
        `the session record carries a forbidden secret field: ${key}`,
      );
  return reasons.length === 0
    ? { ok: true, state: record.state, reasons: [] }
    : { ok: false, state: 'unknown', reasons };
}

/**
 * The migration inventory check.
 *
 * `required` is the inventory read from this source tree; `expected` is what
 * the session recorded when it started. A tree that changed underneath a live
 * session is refused, because the schema already applied would no longer match
 * the code about to be exercised. `applied` must be empty for a freshly
 * created target: a target that already holds migration rows is not the empty
 * disposable database this harness believes it created.
 */
export function evaluateMigrationInventory({ required, expected, applied }) {
  const reasons = [];
  if (!Array.isArray(required) || required.length === 0)
    return {
      ok: false,
      reasons: ['the source migration inventory is empty or unreadable'],
    };
  if (required.some((name) => typeof name !== 'string' || name.trim() === ''))
    return {
      ok: false,
      reasons: ['the source migration inventory contains a malformed entry'],
    };
  if (new Set(required).size !== required.length)
    reasons.push('the source migration inventory contains duplicate names');
  const sorted = [...required].every(
    (name, index) => index === 0 || required[index - 1] <= name,
  );
  if (!sorted)
    reasons.push('the source migration inventory is not in ascending order');
  for (const name of REQUIRED_FEATURE_MIGRATIONS)
    if (!required.includes(name))
      reasons.push(
        `the source migration inventory is missing the required migration ${name}`,
      );
  if (expected !== undefined && expected !== null) {
    if (!Array.isArray(expected))
      reasons.push('the recorded migration inventory is not a list');
    else if (
      expected.length !== required.length ||
      expected.some((name, i) => name !== required[i])
    )
      reasons.push(
        `the source migration inventory (${String(required.length)}) no longer matches the inventory this session recorded (${String(expected.length)})`,
      );
  }
  if (applied !== undefined && applied !== null) {
    if (!Array.isArray(applied))
      reasons.push('the applied migration list is not a list');
    else if (applied.length !== 0)
      reasons.push(
        `the target already holds ${String(applied.length)} applied migration(s), so it is not a newly initialized disposable database`,
      );
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * The hard stop before any migration, seed or fixture write.
 *
 * Instance identity is delegated to `refuseUnlessDisposable`, which already
 * cross-binds the URL, the in-band server nonce, the postmaster start time,
 * the container ID, the ownership label, loopback-only publishing and
 * anonymous-only storage. Passing its refusal in keeps this function pure and
 * avoids a second, divergent copy of those rules.
 *
 * Three guarantees are added here because that predicate does not express
 * them: the port must not be the native service port, the connected database
 * must not be a persistent one by name, and the migration state must be the
 * empty inventory this harness expects.
 */
export function evaluateDisposableTarget({
  identityRefusal,
  url,
  record,
  migrations,
}) {
  const reasons = [];
  if (identityRefusal === undefined)
    return {
      ok: false,
      reasons: ['no instance-identity verdict was supplied'],
    };
  if (identityRefusal !== null)
    reasons.push(`instance identity refused: ${String(identityRefusal)}`);

  if (url === null || typeof url !== 'object')
    reasons.push('no connected-database facts were supplied');
  else {
    // Not a string comparison against the connection string: these are the
    // facts the server and the URL actually reported.
    if (url.hostname !== '127.0.0.1')
      reasons.push(
        `the connected host must be 127.0.0.1, got ${String(url.hostname)}`,
      );
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      reasons.push(
        `the connected port ${String(url.port)} is not a valid TCP port`,
      );
    else if (port === NATIVE_POSTGRES_PORT)
      reasons.push(
        `refusing to operate on port ${String(NATIVE_POSTGRES_PORT)}, the native PostgreSQL service port`,
      );
    if (url.database !== UAT_DATABASE)
      reasons.push(
        `the connected database must be ${UAT_DATABASE}, got ${String(url.database)}`,
      );
    if (PERSISTENT_DATABASES.includes(String(url.database)))
      reasons.push(
        `refusing to operate on the persistent database ${String(url.database)}`,
      );
  }

  const session = evaluateSessionRecord(record);
  if (!session.ok)
    reasons.push(
      ...session.reasons.map((reason) => `session record: ${reason}`),
    );
  else {
    if (!WRITABLE_STATES.includes(session.state))
      reasons.push(
        `the session state ${session.state} does not permit a database write`,
      );
    if (
      url &&
      typeof url === 'object' &&
      String(url.port) !== String(record.port)
    )
      reasons.push('the connected port is not the port this session recorded');
  }

  const inventory = evaluateMigrationInventory(migrations ?? {});
  if (!inventory.ok)
    reasons.push(...inventory.reasons.map((reason) => `migrations: ${reason}`));

  return { ok: reasons.length === 0, reasons };
}

/**
 * Crash recovery.
 *
 * Ownership is never inferred from the container name prefix: a name is not
 * proof, and removing something this session does not own is the destructive
 * mistake worth preventing. Recovery requires the recorded container ID and
 * the recorded nonce to agree with what Docker reports under the ownership
 * label. Anything ambiguous returns `unknown` and asks for a human, which is
 * why no outcome here is `remove` unless both identities matched.
 */
export function evaluateRecovery({ record, probe }) {
  const session = evaluateSessionRecord(record);
  if (!session.ok)
    return {
      action: 'refuse',
      state: 'unknown',
      reasons: session.reasons.map((reason) => `session record: ${reason}`),
    };
  if (probe === null || typeof probe !== 'object')
    return {
      action: 'refuse',
      state: 'unknown',
      reasons: ['no Docker ownership probe was supplied'],
    };
  if (probe.outcome === 'unknown')
    return {
      action: 'refuse',
      state: 'unknown',
      reasons: [
        `Docker could not be consulted: ${String(probe.detail ?? 'no detail')}`,
      ],
    };
  if (probe.outcome === 'absent')
    // Nothing to remove. The session is over, but cleanup was not verified by
    // this process, so it is reported as such rather than as a clean end.
    return {
      action: 'none',
      state: 'ended',
      reasons: [
        'the recorded container is already absent; nothing was removed',
      ],
    };
  if (probe.outcome !== 'present')
    return {
      action: 'refuse',
      state: 'unknown',
      reasons: [`unrecognised probe outcome ${String(probe.outcome)}`],
    };

  const matches = [];
  if (probe.containerId !== record.containerId)
    matches.push(
      'the container Docker reports is not the one this session recorded',
    );
  if (probe.label !== record.nonce)
    matches.push(
      `the container ${OWNERSHIP_LABEL} label does not match this session's nonce`,
    );
  if (Array.isArray(probe.candidates) && probe.candidates.length > 1)
    matches.push(
      `${String(probe.candidates.length)} containers claim this session nonce, which is contradictory`,
    );
  if (matches.length)
    return { action: 'refuse', state: 'unknown', reasons: matches };
  return { action: 'remove', state: 'active', reasons: [] };
}

/**
 * Turns a `CleanupResult` into a session verdict.
 *
 * `containerRemoved`/`volumeRemoved` already mean VERIFIED absence in the
 * helper, so the only work here is refusing to call a partial or unverifiable
 * teardown `ended`. A removed container whose anonymous volume survives is a
 * leak and is reported as `failed`, not rounded up to success.
 */
export function evaluateCleanupOutcome(result) {
  if (result === null || result === undefined)
    return {
      ok: false,
      state: 'unknown',
      reasons: ['no teardown evidence was produced'],
    };
  if (typeof result !== 'object')
    return {
      ok: false,
      state: 'unknown',
      reasons: ['the teardown evidence is not an object'],
    };
  if (result.refusal !== null && result.refusal !== undefined)
    return {
      ok: false,
      state: 'failed',
      reasons: [`teardown refused: ${redactUrl(result.refusal)}`],
    };
  const reasons = [];
  const ambiguous = [];
  for (const resource of ['container', 'volume']) {
    const removed = result[`${resource}Removed`];
    const verification = result[`${resource}Verification`];
    if (typeof removed !== 'boolean') {
      reasons.push(`the ${resource} removal flag is not a boolean`);
      continue;
    }
    const outcome =
      verification && typeof verification === 'object'
        ? verification.outcome
        : undefined;
    if (outcome === 'unknown') {
      ambiguous.push(
        `the ${resource} absence could not be verified: ${String(verification.detail ?? 'no detail')}`,
      );
      continue;
    }
    if (removed !== true)
      reasons.push(
        `the ${resource} was not verified absent${outcome ? ` (reported ${String(outcome)})` : ''}`,
      );
    else if (outcome !== 'absent')
      reasons.push(
        `the ${resource} is reported removed but its verification says ${String(outcome)}`,
      );
  }
  if (ambiguous.length)
    // Ambiguity is never success and never a confident failure: the resource
    // may still exist, so a human must look.
    return { ok: false, state: 'unknown', reasons: [...reasons, ...ambiguous] };
  return reasons.length === 0
    ? { ok: true, state: 'ended', reasons: [] }
    : { ok: false, state: 'failed', reasons };
}

/** The fixture's own staff identity, whose authority and scope readiness
 * measures. Mirrors `trackingUatFixture.staffId`; a test holds them equal. */
export const UAT_FIXTURE_STAFF_ID = '90000000-0000-4000-8000-000000000067';
/** The fixture's PUBLIC requests that identity must be able to reach. Mirrors
 * the manifest's request count; a test holds them equal. */
export const UAT_FIXTURE_REQUEST_COUNT = 2;

/**
 * Fixture readiness. A container existing proves nothing about whether the
 * UAT scenarios can actually be exercised, so readiness is expressed in terms
 * of the rows the scenarios need.
 */
export function evaluateFixtureReadiness(counts) {
  const reasons = [];
  if (counts === null || typeof counts !== 'object')
    return { ok: false, reasons: ['no fixture census was supplied'] };
  // `trackingManageGrants` is part of readiness because the UAT scenario is
  // not reachable without it: a staff operator cannot issue the tracking
  // credential the resident experience depends on. It counts an effective
  // grant -- an active assignment to an active role carrying the permission --
  // rather than the mere existence of a role.
  //
  // A grant is still not reach. `trackingStaffAuthorized` requires the
  // fixture's own identity to hold both permissions, and
  // `trackingStaffScopedRequests` requires its own active memberships to bring
  // every fixture request into `staffRequestScope`; another staff member's
  // grant or membership satisfies neither.
  const need = {
    organizations: 1,
    serviceDefinitions: 1,
    publicRequestsWithUpdates: 1,
    publicRequestsWithoutUpdates: 1,
    residentVisibleUpdates: 1,
    trackingManageGrants: 1,
    staffIdentities: 1,
    trackingStaffAuthorized: 1,
    trackingStaffScopedRequests: UAT_FIXTURE_REQUEST_COUNT,
  };
  for (const [key, minimum] of Object.entries(need)) {
    const value = counts[key];
    if (!Number.isInteger(value) || value < 0)
      reasons.push(`the ${key} count is missing or not a non-negative integer`);
    else if (value < minimum)
      reasons.push(
        `expected at least ${String(minimum)} ${key}, got ${String(value)}`,
      );
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Staff authorization prerequisites for a future, separately approved session.
 *
 * `StaffAccessGuard` refuses the tracking controller whenever Entra-only
 * admission or a permission union is annotated, which that controller does, so
 * its development fallback is unreachable. A synthetic `staff_identity` row is
 * therefore necessary but not sufficient: a real Entra token, resolvable to
 * that row by tenant and object ID, is required. This function reports that
 * rather than pretending the harness can satisfy it.
 */
export function evaluateStaffPrerequisites(facts) {
  const blockers = [];
  if (facts === null || typeof facts !== 'object')
    return {
      ready: false,
      issuanceAvailable: false,
      blockers: ['no staff prerequisite facts were supplied'],
    };
  if (facts.staffIdentityPresent !== true)
    blockers.push(
      'no synthetic staff identity exists in the disposable database',
    );
  if (facts.trackingManageGranted !== true)
    blockers.push(
      'the synthetic staff identity does not hold service_request.tracking.manage',
    );
  if (
    typeof facts.entraTenantId !== 'string' ||
    facts.entraTenantId.trim() === ''
  )
    blockers.push('no Entra tenant is bound to the synthetic staff identity');
  if (
    typeof facts.entraObjectId !== 'string' ||
    facts.entraObjectId.trim() === ''
  )
    blockers.push(
      'no Entra object ID is bound to the synthetic staff identity',
    );
  if (facts.entraTokenAvailable !== true)
    blockers.push(
      'no Entra-authenticated staff token is available; StaffAccessGuard admits no development fallback for tracking management',
    );
  return {
    ready: blockers.length === 0,
    // Issuance is never performed by this harness. Even with every
    // prerequisite met, the credential is created by the existing staff
    // endpoint under its own authorization, not here.
    issuanceAvailable: false,
    blockers,
  };
}

/**
 * The policy for a local secret-bearing file, evaluated before it is written.
 *
 * On Windows an inherited ACL is not reduced by a mode argument, so the mode
 * requested below is a best effort and the real protection is that the path is
 * gitignored, created exclusively, and deleted at teardown. Saying so plainly
 * is part of the policy.
 */
export function evaluateSecretFileRequest({
  path,
  gitignored,
  exists,
  authorized,
}) {
  const reasons = [];
  if (typeof path !== 'string' || path.trim() === '')
    reasons.push('no secret file path was supplied');
  if (gitignored !== true)
    reasons.push('the secret file path is not gitignored');
  if (exists === true)
    reasons.push('the secret file already exists; it is never overwritten');
  if (authorized !== true)
    reasons.push(
      'writing a secret-bearing file requires an explicitly authorized session',
    );
  return {
    ok: reasons.length === 0,
    reasons,
    mode: 0o600,
    exclusive: true,
    windowsCaveat:
      'On Windows the file mode does not remove inherited ACL entries; confidentiality rests on the gitignored path, exclusive creation and verified deletion at teardown.',
  };
}

/**
 * The exclusive-lock verdict.
 *
 * Two invocations must never operate on one session, and a crashed process
 * must not leave a lock that silently authorizes the next caller. A held lock
 * refuses. A lock whose owning process is gone is reported as `stale` and
 * still refuses: clearing it is a human decision, because "the pid is gone"
 * does not prove the container and database it was mid-way through touching
 * are in a known state. Anything unreadable is `ambiguous`, which also
 * refuses -- every outcome here except `free` is fail-closed.
 */
export function evaluateLock({
  lock,
  pidAlive,
  now,
  staleAfterMs = 86_400_000,
}) {
  if (lock === null || lock === undefined)
    return { state: 'free', ok: true, reasons: [] };
  if (typeof lock !== 'object' || Array.isArray(lock))
    return {
      state: 'ambiguous',
      ok: false,
      reasons: ['the lock file could not be parsed'],
    };
  if (!Number.isInteger(lock.pid) || lock.pid <= 0)
    return {
      state: 'ambiguous',
      ok: false,
      reasons: ['the lock file records no usable process id'],
    };
  const acquired = Date.parse(String(lock.acquiredAt));
  if (!Number.isFinite(acquired))
    return {
      state: 'ambiguous',
      ok: false,
      reasons: ['the lock file records no valid acquisition time'],
    };
  if (pidAlive === true) {
    const age = (now instanceof Date ? now.getTime() : Date.now()) - acquired;
    return {
      state: 'held',
      ok: false,
      reasons: [
        `another F067 session command (pid ${String(lock.pid)}) holds the lock, acquired ${String(Math.max(0, Math.round(age / 1000)))}s ago`,
      ],
    };
  }
  if (pidAlive !== false)
    return {
      state: 'ambiguous',
      ok: false,
      reasons: [
        'whether the lock owner is still running could not be determined',
      ],
    };
  return {
    state: 'stale',
    ok: false,
    reasons: [
      `the lock was held by pid ${String(lock.pid)}, which is gone; the session it was operating on is in an unverified state and must be inspected with status before the lock is cleared`,
      ...(Number.isFinite(staleAfterMs) && Date.now() - acquired > staleAfterMs
        ? ['the lock is older than the staleness horizon']
        : []),
    ],
  };
}

/**
 * Whether a recorded session conflicts with starting a new one. A session
 * still holding a resource must be ended, not silently replaced, or its
 * container and volume would be orphaned.
 */
export function evaluateSessionConflict(record) {
  if (record === null || record === undefined) return { ok: true, reasons: [] };
  const verdict = evaluateSessionRecord(record);
  if (!verdict.ok)
    // A corrupt record may still describe a real container, so it blocks a
    // new session rather than being discarded.
    return {
      ok: false,
      reasons: [
        'an unusable session record exists; it may still describe a live container, so it must be resolved before a new session starts',
        ...verdict.reasons,
      ],
    };
  if (verdict.state === 'ended') return { ok: true, reasons: [] };
  return {
    ok: false,
    reasons: [
      `a session is already recorded in state ${verdict.state}; end it before starting another`,
    ],
  };
}

/** The status report. Built from the record alone, which never holds a secret. */
export function describeSession(record, { identityRefusal, fixtures } = {}) {
  const session = evaluateSessionRecord(record);
  if (!session.ok)
    return { state: 'unknown', reasons: session.reasons, lines: [] };
  const lines = [
    `state                ${session.state}`,
    `container            ${record.container}`,
    `containerId          ${String(record.containerId).slice(0, 12)}`,
    `nonce                ${String(record.nonce).slice(0, 8)}… (truncated)`,
    `published            127.0.0.1:${String(record.port)}`,
    `database             ${record.database}`,
    `role                 ${record.role}`,
    `imageReference       ${record.imageReference}`,
    `migrations recorded  ${String(Array.isArray(record.migrations) ? record.migrations.length : 0)}`,
    `epoch                ${record.epoch}`,
  ];
  if (identityRefusal !== undefined)
    lines.push(
      `instance identity    ${identityRefusal === null ? 'verified' : `REFUSED — ${String(identityRefusal)}`}`,
    );
  if (fixtures !== undefined) {
    const verdict = evaluateFixtureReadiness(fixtures);
    lines.push(
      `fixtures             ${verdict.ok ? 'ready' : `not ready (${String(verdict.reasons.length)} reason(s))`}`,
    );
  }
  // No credential is ever part of a status report; the redactor is applied
  // anyway so a future field cannot leak one by being added carelessly.
  return { state: session.state, reasons: [], lines: lines.map(redactUrl) };
}

// --- development seed ------------------------------------------------------

/**
 * The synthetic Organization `seed-development.ts` provisions. The seed
 * hard-codes this ID; it is named here only so the seed subprocess and the
 * UAT backend file can state it explicitly. It is never a global default:
 * `validateEnvironment` still requires every caller to supply one.
 */
export const UAT_DEVELOPMENT_ORGANIZATION_ID =
  '10000000-0000-4000-8000-000000000001';

/**
 * The tenant settings the seed subprocess is given, each set explicitly.
 *
 * The seed validates its own environment with `validateEnvironment`, whose
 * default tenant strategy is `development`, and that strategy requires an
 * explicit `DEVELOPMENT_ORGANIZATION_ID` with no default. A harness that
 * passed only the database URL therefore failed validation before it
 * connected. F065 automatic issuance is stated as OFF rather than left to a
 * default.
 */
const SEED_SETTINGS = Object.freeze({
  NODE_ENV: 'development',
  CITYVUE_DEPLOYMENT_PROFILE: 'development',
  TENANT_RESOLUTION_STRATEGY: 'development',
  DEVELOPMENT_ORGANIZATION_ID: UAT_DEVELOPMENT_ORGANIZATION_ID,
  REQRO_ENABLE_REQUESTER_INTAKE_TRACKING: 'false',
});

/**
 * Builds the seed subprocess's own settings, or refuses.
 *
 * An inherited value that disagrees with a setting above refuses rather than
 * being silently overridden: a parent configured for another Organization or
 * profile is a misconfiguration worth stopping on, not one to paper over. The
 * URL is rechecked by shape as well, so the seed can only ever be pointed at
 * a loopback, non-5432 `reqro_f0592_test` database. That is in addition to,
 * not instead of, the instance-identity gate the orchestrator has already run.
 */
export function buildSeedEnvironment({ url, inherited }) {
  const reasons = [];
  let parsed = null;
  try {
    parsed = new URL(String(url));
  } catch {
    reasons.push('the seed database URL is not a valid URL');
  }
  if (parsed) {
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
      reasons.push('the seed database URL is not a PostgreSQL URL');
    if (parsed.hostname !== '127.0.0.1')
      reasons.push(
        `the seed database host must be 127.0.0.1, got ${parsed.hostname}`,
      );
    const port = Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      reasons.push('the seed database port is not a valid TCP port');
    else if (port === NATIVE_POSTGRES_PORT)
      reasons.push(
        `refusing to seed on port ${String(NATIVE_POSTGRES_PORT)}, the native PostgreSQL service port`,
      );
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (PERSISTENT_DATABASES.includes(database))
      reasons.push(`refusing to seed the persistent database ${database}`);
    else if (database !== UAT_DATABASE)
      reasons.push(
        `the seed database must be ${UAT_DATABASE}, got ${database || '(none)'}`,
      );
    if (parsed.search || parsed.hash)
      reasons.push('the seed database URL carries unexpected parameters');
  }
  const parent =
    inherited !== null && typeof inherited === 'object' ? inherited : {};
  for (const [key, value] of Object.entries(SEED_SETTINGS)) {
    const present = parent[key];
    if (present !== undefined && present !== '' && present !== value)
      reasons.push(
        `the inherited ${key} conflicts with the disposable seed setting; unset it before starting a session`,
      );
  }
  if (reasons.length) return { ok: false, reasons, env: null };
  const target = String(url);
  return {
    ok: true,
    reasons: [],
    env: { ...SEED_SETTINGS, DATABASE_URL: target, TEST_DATABASE_URL: target },
  };
}

/** A field the seed's sanitized log may carry, accepted only in this shape. */
const SAFE_TOKEN = /^[A-Za-z0-9_]{1,64}$/;
const SAFE_SIGNAL = /^SIG[A-Z0-9]{1,16}$/;
/** Only the final stderr line is examined, and only up to this length. */
const MAX_DIAGNOSTIC_LINE = 4096;

/**
 * Reads the one structured line `commandFailure` writes, and nothing else.
 *
 * The seed already sanitizes its failure into `errorName`, `errorCode` and an
 * optional `classification`, each from an allowlist. That line is parsed;
 * every other byte of stderr and stdout is discarded unread, so no URL, SQL
 * parameter or token can be echoed through here. A value outside the
 * expected shape is dropped rather than shown.
 */
function readSanitizedFailure(stderr) {
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines[lines.length - 1];
  if (!last || last.length > MAX_DIAGNOSTIC_LINE) return null;
  let parsed;
  try {
    parsed = JSON.parse(last);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const safe = (value) =>
    typeof value === 'string' && SAFE_TOKEN.test(value) ? value : undefined;
  return {
    configuration: parsed.classification === 'Invalid server configuration',
    errorName: safe(parsed.errorName),
    errorCode: safe(parsed.errorCode),
  };
}

/**
 * Classifies a finished fixture subprocess from its synchronous spawn result.
 *
 * Distinguishes a spawn failure, a timeout, a signal, a configuration
 * refusal and any other nonzero exit. The exit status is always preserved.
 * The seed's log does not name which configuration key failed, so the
 * message names the keys this harness supplies rather than inventing one.
 */
export function classifySubprocessFailure(step, result) {
  const name = String(step);
  const input = result !== null && typeof result === 'object' ? result : {};
  const status = Number.isInteger(input.status) ? input.status : null;
  const errorCode =
    input.error && typeof input.error.code === 'string'
      ? input.error.code
      : null;
  const signal =
    typeof input.signal === 'string' && SAFE_SIGNAL.test(input.signal)
      ? input.signal
      : null;
  if (status === 0 && !input.error) return { ok: true, kind: 'success' };

  if (errorCode === 'ETIMEDOUT')
    return {
      ok: false,
      kind: 'timeout',
      status,
      message: `${name} timed out${signal ? ` and was terminated with ${signal}` : ''}`,
    };
  if (input.error)
    return {
      ok: false,
      kind: 'spawn-failure',
      status,
      message: `${name} could not be started${errorCode && SAFE_TOKEN.test(errorCode) ? ` (${errorCode})` : ''}`,
    };
  if (status === null)
    return {
      ok: false,
      kind: 'terminated',
      status,
      message: `${name} was terminated${signal ? ` by ${signal}` : ''} before reporting an exit status`,
    };

  const detail = readSanitizedFailure(input.stderr);
  const fields = [`status ${String(status)}`];
  if (detail?.errorName) fields.push(`errorName=${detail.errorName}`);
  if (detail?.errorCode) fields.push(`errorCode=${detail.errorCode}`);
  if (detail?.configuration)
    return {
      ok: false,
      kind: 'configuration-invalid',
      status,
      message: `${name} refused its configuration (${fields.join(', ')}); the harness supplies ${Object.keys(SEED_SETTINGS).join(', ')} and DATABASE_URL`,
    };
  return {
    ok: false,
    kind: 'subprocess-failure',
    status,
    message: `${name} failed (${fields.join(', ')})${detail ? '' : '; it reported no sanitized diagnostic'}`,
  };
}

// --- locations -------------------------------------------------------------
// Path computation only. Resolving a path touches no filesystem, so these
// remain side-effect-free and the modules that write to them keep the I/O.

const HERE = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(HERE, '..');
export const SESSION_FILE = resolve(
  SERVER_ROOT,
  '.local-data',
  'uat-f067-session.json',
);
export const UAT_ENV_FILE = resolve(SERVER_ROOT, '.env.uat');

/**
 * Builds the record a future authorized session would persist.
 *
 * Pure, so the "no secret ever reaches the state file" property is provable
 * without writing one. The cluster's `testUrl` carries a generated password
 * and is deliberately not among the fields copied; the record keeps only
 * identity.
 */
export function prepareSessionRecord({ cluster, state, migrations, now }) {
  if (cluster === null || typeof cluster !== 'object')
    return {
      ok: false,
      reasons: ['no cluster facts were supplied'],
      record: null,
    };
  const record = {
    version: SESSION_VERSION,
    state,
    container: cluster.container,
    containerId: cluster.containerId,
    nonce: cluster.nonce,
    port: cluster.port,
    database: UAT_DATABASE,
    role: cluster.role,
    epoch:
      cluster.epoch instanceof Date
        ? cluster.epoch.toISOString()
        : String(cluster.epoch),
    imageReference: cluster.imageReference,
    imageRepositoryDigest: cluster.imageRepositoryDigest,
    imageId: cluster.imageId,
    migrations: Array.isArray(migrations) ? [...migrations] : [],
    recordedAt: (now instanceof Date ? now : new Date()).toISOString(),
  };
  const verdict = evaluateSessionRecord(record);
  return verdict.ok
    ? { ok: true, reasons: [], record }
    : { ok: false, reasons: verdict.reasons, record: null };
}

/**
 * F067 — the isolated interactive UAT session harness.
 *
 * `test-db-disposable.mjs` is the mandatory validation gate. It destroys its
 * cluster in a `finally` block on every outcome and then exits, which is
 * exactly right for a run-to-completion gate and exactly wrong for manual
 * UAT. Adding a keep-alive flag there would put a "do not clean up" switch
 * inside the gate that proves cleanup happens, so this is a separate harness
 * that reuses the same provisioning, identity and teardown mechanisms rather
 * than duplicating or weakening them.
 *
 * Everything that decides anything is a pure function exported below and
 * proven against fabricated input, so the refusal paths are tested without a
 * Docker daemon, a PostgreSQL server or a network. The imperative `main`
 * only gathers facts and hands them to these functions.
 *
 * Nothing here runs on import.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

/**
 * Fixture readiness. A container existing proves nothing about whether the
 * UAT scenarios can actually be exercised, so readiness is expressed in terms
 * of the rows the scenarios need.
 */
export function evaluateFixtureReadiness(counts) {
  const reasons = [];
  if (counts === null || typeof counts !== 'object')
    return { ok: false, reasons: ['no fixture census was supplied'] };
  const need = {
    organizations: 1,
    serviceDefinitions: 1,
    publicRequestsWithUpdates: 1,
    publicRequestsWithoutUpdates: 1,
    residentVisibleUpdates: 1,
    staffIdentities: 1,
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

// --- imperative shell ------------------------------------------------------
// Everything below gathers facts and prints; the decisions are above.

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(HERE, '..');
export const SESSION_FILE = resolve(
  SERVER_ROOT,
  '.local-data',
  'uat-f067-session.json',
);
export const UAT_ENV_FILE = resolve(SERVER_ROOT, '.env.uat');

/** The inventory this source tree declares, in applied order. */
export function readMigrationInventory(root = SERVER_ROOT) {
  const directory = resolve(root, 'migrations');
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort();
}

function loadRecord(file = SESSION_FILE) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { corrupt: true };
  }
}

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

/** Persists identity only, and refuses an invalid record rather than writing it. */
export function saveRecord(record, file = SESSION_FILE) {
  const verdict = evaluateSessionRecord(record);
  if (!verdict.ok)
    throw new Error(
      `refusing to persist an invalid session record: ${verdict.reasons.join('; ')}`,
    );
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

const USAGE = `F067 isolated interactive UAT session harness

  start  --dry-run | --confirm   provision a disposable PostgreSQL session
  status                         report session identity and readiness
  end    --dry-run | --confirm   targeted teardown with verified absence

--dry-run prints the plan and touches nothing. --confirm performs the
operation and requires a separately authorized session. No tracking
credential is ever issued by this harness, and F065 automatic issuance is
never enabled by it.
`;

async function main(argv = process.argv.slice(2)) {
  const out = (text) => process.stdout.write(`${redactUrl(text)}\n`);
  const errOut = (text) => process.stderr.write(`${redactUrl(text)}\n`);
  const [command, mode] = argv;

  if (command === undefined || command === '--help' || command === 'help') {
    out(USAGE);
    return 0;
  }
  if (!['start', 'status', 'end'].includes(command)) {
    errOut(`unknown command ${String(command)}`);
    out(USAGE);
    return 2;
  }
  if (
    command !== 'status' &&
    !['--dry-run', '--confirm'].includes(mode ?? '')
  ) {
    errOut(`${command} requires an explicit --dry-run or --confirm`);
    return 2;
  }

  const required = readMigrationInventory();

  if (command === 'status') {
    const record = loadRecord();
    if (record === null) {
      out('state                no session recorded');
      return 0;
    }
    const described = describeSession(record);
    if (described.state === 'unknown') {
      errOut('state                unknown — the session record is not usable');
      for (const reason of described.reasons) errOut(`  - ${reason}`);
      return 1;
    }
    for (const line of described.lines) out(line);
    const inventory = evaluateMigrationInventory({
      required,
      expected: record.migrations,
      applied: null,
    });
    out(
      `source inventory     ${inventory.ok ? 'matches this session' : 'DIVERGED'}`,
    );
    for (const reason of inventory.reasons) errOut(`  - ${reason}`);
    // Readiness is never asserted from a record alone. Confirming the live
    // instance needs a connection, which `status` deliberately does not make.
    out(
      'readiness            not asserted; run a verified start --confirm session to establish it',
    );
    return inventory.ok ? 0 : 1;
  }

  if (mode === '--dry-run') {
    out(
      `${command}: dry run — nothing was created, migrated, seeded or removed.`,
    );
    out(`  session file       ${SESSION_FILE}`);
    out(`  migration count    ${String(required.length)}`);
    const inventory = evaluateMigrationInventory({
      required,
      expected: null,
      applied: [],
    });
    out(
      `  inventory          ${inventory.ok ? 'complete, F065 and F066 present' : 'INCOMPLETE'}`,
    );
    for (const reason of inventory.reasons) errOut(`  - ${reason}`);
    if (command === 'start') {
      out(
        '  would then         start a disposable cluster, verify instance identity,',
      );
      out(
        '                     refuse unless loopback / non-5432 / reqro_f0592_test / nonce / label match,',
      );
      out(
        '                     apply the full migration inventory, prepare synthetic fixtures,',
      );
      out('                     and hold the session open.');
    } else {
      const record = loadRecord();
      out(
        `  recorded session   ${record === null ? 'none' : String(record.container ?? 'unusable')}`,
      );
      out(
        '  would then         match the recorded container ID and nonce against the',
      );
      out(
        '                     ownership label, remove that container and its anonymous',
      );
      out('                     volume only, and verify both are absent.');
    }
    return inventory.ok ? 0 : 1;
  }

  // --confirm. This milestone authorizes no container creation, migration,
  // seeding or removal, so the harness refuses rather than carrying it out.
  // The refusal is the safety property: an unauthorized session cannot
  // provision or destroy anything, and the dry-run path above is the only
  // thing the implementation milestone exercises.
  errOut(
    `${command} --confirm requires an authorized F067 UAT session. This build performs no container, migration, seeding, fixture or removal operation.`,
  );
  errOut(
    'Re-run with --dry-run to see the exact plan, or obtain authorization for a live session.',
  );
  return 3;
}

export { main };

const entry = process.argv[1];
if (entry !== undefined && pathToFileURL(entry).href === import.meta.url)
  process.exit(await main());

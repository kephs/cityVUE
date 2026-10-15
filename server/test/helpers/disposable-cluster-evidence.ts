import { spawnSync } from 'node:child_process';
import type { Pool } from 'pg';

/**
 * F062.2D-2C-3B-2 NEW-a follow-up — disposable-instance evidence.
 *
 * Two database suites used to assert `inet_server_addr() in ('::1/128',
 * '127.0.0.1/32')` as their proof that the target was a throwaway local
 * server. That assertion is unsatisfiable once PostgreSQL is reached through
 * Docker's bridge: the client connects to host loopback, but the server
 * reports the container's bridge address. No container-side setting changes
 * that, so the check was replaced rather than relaxed.
 *
 * **Address privacy is never accepted as evidence.** A managed PostgreSQL on
 * a private endpoint also has a private address, so `172.17.0.2` and
 * `10.1.2.3` are refused exactly like a public address.
 *
 * What is proven instead is ownership. The nonce is injected OUT OF BAND, by
 * `docker run`, as both a server setting and a container label; it is then
 * read back IN BAND over SQL. The harness never writes the nonce through the
 * database connection, so a server that reports it must be the container this
 * run created. That asymmetry is the whole design: a marker the harness wrote
 * over SQL would only confirm itself.
 *
 * **This is corroborating evidence under a trusted Docker control plane, not
 * cryptographic attestation.** Someone who can already forge `docker inspect`
 * output is outside the threat model.
 *
 * `refuseUnlessDisposable` is pure so the negative cases can be proven
 * against fabricated evidence, without ever contacting an incorrect database,
 * a persistent volume or a foreign container.
 */

/** Hosts that may appear in the client URL. Loopback literals only. */
const LOOPBACK = ['localhost', '127.0.0.1', '::1', '[::1]'];

/** Anonymous Docker volume names are 64 lowercase hex characters. */
const ANONYMOUS_VOLUME = /^[0-9a-f]{64}$/;

export interface DisposableExpectations {
  readonly database: string;
  readonly role: string;
  readonly nonce: string;
  readonly containerId: string;
  /** The pinned reference passed to `docker run`, e.g. `postgres@sha256:…`. */
  readonly imageReference: string;
  /** The resolved image ID, e.g. `sha256:…`. */
  readonly imageId: string;
  /** Nothing owned by this run can predate the harness. */
  readonly harnessEpoch: Date;
  /** Named volumes that must never be mounted, e.g. the development volume. */
  readonly deniedVolumeNames: readonly string[];
}

export interface DisposableUrlFacts {
  readonly hostname: string;
  readonly port: string;
  readonly database: string;
  readonly username: string;
}

export interface DisposableSqlFacts {
  readonly database: string;
  readonly user: string;
  readonly nonce: string | null;
  readonly postmasterStart: Date | null;
  /** Schemas in the test database that this run did not create. */
  readonly unexpectedSchemaCount: number | null;
}

export interface DisposableMount {
  readonly type: string;
  readonly name: string;
  readonly destination: string;
}

export interface DisposablePortBinding {
  readonly hostIp: string;
  readonly hostPort: string;
}

export interface DisposableContainerFacts {
  readonly id: string;
  readonly imageReference: string;
  readonly imageId: string;
  readonly running: boolean;
  readonly created: Date | null;
  readonly portBindings: readonly DisposablePortBinding[];
  readonly mounts: readonly DisposableMount[];
  readonly labels: Readonly<Record<string, string>>;
}

export interface DisposableEvidence {
  readonly url: DisposableUrlFacts;
  readonly sql: DisposableSqlFacts;
  /** `null` when `docker inspect` found nothing, which is a refusal. */
  readonly container: DisposableContainerFacts | null;
  readonly expected: DisposableExpectations;
}

/**
 * The refusal reason, or `null` when every check passes.
 *
 * Fail-closed: absent, malformed and mismatched evidence all refuse, and the
 * first failing check wins so the reason names one specific cause. Reasons
 * carry database, role, container, port and volume names so a failure is
 * diagnosable, and never carry the credential.
 */
export function refuseUnlessDisposable(
  evidence: DisposableEvidence,
): string | null {
  const { url, sql, container, expected } = evidence;

  // The expectations themselves must be complete. An empty nonce would
  // otherwise compare equal to an absent server setting and pass.
  if (expected.nonce.trim() === '')
    return 'the expected disposable-instance nonce is empty';
  if (expected.containerId.trim() === '')
    return 'the expected container ID is empty';
  if (expected.imageReference.trim() === '')
    return 'the expected image reference is empty';
  if (expected.imageId.trim() === '') return 'the expected image ID is empty';
  if (Number.isNaN(expected.harnessEpoch.getTime()))
    return 'the harness epoch is not a valid time';

  // 1-3. The existing destination checks, unchanged in meaning.
  if (!LOOPBACK.includes(url.hostname))
    return `the connection host must be loopback, got ${url.hostname}`;
  if (url.database !== expected.database)
    return `the URL database must be ${expected.database}, got ${url.database}`;
  if (url.username !== expected.role)
    return `the URL role must be ${expected.role}, got ${url.username}`;
  if (sql.database !== expected.database)
    return `the server reports database ${sql.database}, expected ${expected.database}`;
  if (sql.user !== expected.role)
    return `the server reports role ${sql.user}, expected ${expected.role}`;

  // 4. The unforgeable core: a setting only `docker run` could have placed.
  if (sql.nonce === null)
    return 'the server does not expose a disposable-instance nonce';
  if (sql.nonce.trim() === '')
    return 'the server reports an empty disposable-instance nonce';
  if (sql.nonce !== expected.nonce)
    return 'the server nonce does not match this run';

  // 5. The cluster was started by this run, not merely reachable.
  if (sql.postmasterStart === null)
    return 'the server did not report a postmaster start time';
  if (Number.isNaN(sql.postmasterStart.getTime()))
    return 'the postmaster start time is not a valid time';
  if (sql.postmasterStart.getTime() < expected.harnessEpoch.getTime())
    return 'the server started before this harness run, so it is not ours';

  // 6. A fresh database, never an inherited backlog.
  if (sql.unexpectedSchemaCount === null)
    return 'the unexpected-schema census is missing';
  if (sql.unexpectedSchemaCount !== 0)
    return `the database already holds ${String(
      sql.unexpectedSchemaCount,
    )} unexpected schema(s), so it is not a clean disposable baseline`;

  // 7-12. Out-of-band evidence. Absence refuses: an instance that Docker
  // cannot account for is exactly the managed-database case being excluded.
  if (container === null)
    return 'Docker does not account for this instance, so disposability is unproven';
  if (container.id !== expected.containerId)
    return 'the container ID does not match the one created by this run';
  if (container.imageReference !== expected.imageReference)
    return `the container image reference is not the pinned digest, got ${container.imageReference}`;
  if (container.imageId !== expected.imageId)
    return 'the resolved container image ID is not the pinned image';
  if (!container.running) return 'the container is not running';
  if (container.created === null)
    return 'the container creation time is missing';
  if (Number.isNaN(container.created.getTime()))
    return 'the container creation time is not a valid time';
  if (container.created.getTime() < expected.harnessEpoch.getTime())
    return 'the container predates this harness run, so it is reused rather than disposable';

  // 12. Cross-binds the two channels: without this, the container Docker
  // describes and the server SQL answered could be different servers.
  const label = container.labels['com.reqro.disposable'];
  if (label === undefined)
    return 'the container carries no com.reqro.disposable label';
  if (label !== sql.nonce)
    return 'the container label and the server nonce disagree';

  // 9. Loopback-only publishing, and the port actually in use.
  if (container.portBindings.length !== 1)
    return `expected exactly one published port binding, got ${String(
      container.portBindings.length,
    )}`;
  const [binding] = container.portBindings;
  if (binding === undefined) return 'the published port binding is missing';
  if (binding.hostIp !== '127.0.0.1')
    return `the container must publish to 127.0.0.1 only, got ${binding.hostIp}`;
  if (binding.hostPort !== url.port)
    return `the published port ${binding.hostPort} is not the connected port ${url.port}`;

  // 10. Anonymous storage only. The image declares a VOLUME, so exactly one
  // anonymous volume is correct and an empty mount list is not.
  if (container.mounts.length !== 1)
    return `expected exactly one mount, got ${String(container.mounts.length)}`;
  const [mount] = container.mounts;
  if (mount === undefined) return 'the container mount is missing';
  if (mount.type !== 'volume')
    return `storage must be an anonymous volume, got a ${mount.type} mount`;
  if (expected.deniedVolumeNames.includes(mount.name))
    return `the container mounts the persistent volume ${mount.name}`;
  if (!ANONYMOUS_VOLUME.test(mount.name))
    return `storage must be an anonymous volume, got the named volume ${mount.name}`;

  return null;
}

/**
 * Guards teardown. Cleanup removes resources by name, so a wrong name is a
 * destructive action against something this run does not own; the check runs
 * before `docker rm`, not after. Anonymous-only volume names also mean a
 * named development volume can never be a teardown target.
 */
export function refuseUnlessOwnedCleanupTarget(
  target: {
    readonly containerId: string;
    readonly volumeNames: readonly string[];
  },
  expected: {
    readonly containerId: string;
    readonly deniedVolumeNames: readonly string[];
  },
): string | null {
  if (expected.containerId.trim() === '')
    return 'refusing teardown: this run recorded no container to remove';
  if (target.containerId.trim() === '')
    return 'refusing teardown: no container ID was supplied';
  if (target.containerId !== expected.containerId)
    return 'refusing teardown: the target container is not the one this run created';
  for (const name of target.volumeNames) {
    if (expected.deniedVolumeNames.includes(name))
      return `refusing teardown: ${name} is a persistent volume`;
    if (!ANONYMOUS_VOLUME.test(name))
      return `refusing teardown: ${name} is not an anonymous volume`;
  }
  return null;
}

/** How the surrounding suite should treat the ambient configuration. */
export type DisposableConfigState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'partial'; readonly missing: readonly string[] }
  | { readonly kind: 'configured'; readonly expected: DisposableExpectations };

const ENV_KEYS = [
  'REQRO_DISPOSABLE_NONCE',
  'REQRO_DISPOSABLE_CONTAINER_ID',
  'REQRO_DISPOSABLE_IMAGE_REFERENCE',
  'REQRO_DISPOSABLE_IMAGE_ID',
  'REQRO_DISPOSABLE_EPOCH',
] as const;

/**
 * Absent means "this is not a disposable-cluster run", which the suites treat
 * as a skip, matching the existing `skip: !url` convention. Partial means
 * someone configured half a disposable run, which is never a skip: it is the
 * shape a tampered or half-torn-down environment takes, so it fails.
 */
export function disposableConfigFromEnv(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: {
    readonly database?: string;
    readonly role?: string;
    readonly deniedVolumeNames?: readonly string[];
  } = {},
): DisposableConfigState {
  const present = ENV_KEYS.filter(
    (key) => (environment[key] ?? '').trim() !== '',
  );
  if (present.length === 0) return { kind: 'absent' };
  if (present.length !== ENV_KEYS.length)
    return {
      kind: 'partial',
      missing: ENV_KEYS.filter((key) => !present.includes(key)),
    };
  return {
    kind: 'configured',
    expected: {
      database: options.database ?? 'reqro_f0592_test',
      role: options.role ?? 'reqro_test_user',
      nonce: (environment.REQRO_DISPOSABLE_NONCE ?? '').trim(),
      containerId: (environment.REQRO_DISPOSABLE_CONTAINER_ID ?? '').trim(),
      imageReference: (
        environment.REQRO_DISPOSABLE_IMAGE_REFERENCE ?? ''
      ).trim(),
      imageId: (environment.REQRO_DISPOSABLE_IMAGE_ID ?? '').trim(),
      harnessEpoch: new Date((environment.REQRO_DISPOSABLE_EPOCH ?? '').trim()),
      deniedVolumeNames: options.deniedVolumeNames ?? [
        'cityvue-postgres-data',
        'server_cityvue-postgres-data',
      ],
    },
  };
}

/**
 * The `skip` reason for a suite that needs a disposable cluster, or `false`
 * to run.
 *
 * A PARTIAL configuration deliberately does not skip. Half a disposable
 * configuration is the shape a tampered or half-torn-down environment takes,
 * and skipping it would report an unverified environment as an intentional
 * omission. It runs, and then fails inside `assertDisposableCluster`.
 */
export function disposableSkipReason(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | false {
  if ((environment.TEST_DATABASE_URL ?? '').trim() === '')
    return 'TEST_DATABASE_URL missing';
  if (disposableConfigFromEnv(environment).kind === 'absent')
    return 'disposable-cluster evidence absent; run scripts/test-db-disposable.mjs';
  return false;
}

/**
 * Proves the connected instance is a disposable cluster this run owns, and
 * throws with the specific cause otherwise.
 *
 * Replaces the former `inet_server_addr()` loopback assertion, which cannot
 * hold through Docker's bridge. The surrounding database, role and
 * connection-host assertions are unchanged and still apply.
 */
export async function assertDisposableCluster(
  admin: Pool,
  connectionString: string,
  options: {
    readonly environment?: Readonly<Record<string, string | undefined>>;
  } = {},
): Promise<void> {
  const state = disposableConfigFromEnv(options.environment ?? process.env);
  if (state.kind === 'absent')
    throw new Error(
      'disposable-cluster evidence is absent; this suite must be skipped rather than run',
    );
  if (state.kind === 'partial')
    throw new Error(
      `the disposable-cluster configuration is incomplete, missing: ${state.missing.join(
        ', ',
      )}`,
    );
  const evidence = await collectDisposableEvidence(
    admin,
    connectionString,
    state.expected,
  );
  const refusal = refuseUnlessDisposable(evidence);
  if (refusal !== null)
    throw new Error(`refusing a non-disposable PostgreSQL target: ${refusal}`);
}

/** Reads container facts. Fixed argument vector, no shell, no user script. */
export function inspectContainer(
  containerId: string,
): DisposableContainerFacts | null {
  const result = spawnSync('docker', ['inspect', containerId], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  const raw = parsed[0] as {
    Id?: string;
    Created?: string;
    Image?: string;
    State?: { Running?: boolean };
    Config?: { Image?: string; Labels?: Record<string, string> };
    Mounts?: { Type?: string; Name?: string; Destination?: string }[];
    NetworkSettings?: {
      Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null>;
    };
  };
  const bindings = raw.NetworkSettings?.Ports?.['5432/tcp'] ?? [];
  return {
    id: raw.Id ?? '',
    imageReference: raw.Config?.Image ?? '',
    imageId: raw.Image ?? '',
    running: raw.State?.Running === true,
    created: raw.Created === undefined ? null : new Date(raw.Created),
    portBindings: bindings.map((binding) => ({
      hostIp: binding.HostIp ?? '',
      hostPort: binding.HostPort ?? '',
    })),
    mounts: (raw.Mounts ?? []).map((mount) => ({
      type: mount.Type ?? '',
      name: mount.Name ?? '',
      destination: mount.Destination ?? '',
    })),
    labels: raw.Config?.Labels ?? {},
  };
}

/** Gathers both evidence channels for an already-connected admin pool. */
export async function collectDisposableEvidence(
  admin: Pool,
  connectionString: string,
  expected: DisposableExpectations,
): Promise<DisposableEvidence> {
  const url = new URL(connectionString);
  const facts = await admin.query<{
    db: string;
    usr: string;
    nonce: string | null;
    started: Date | null;
  }>(
    `select current_database() db, current_user usr,
            current_setting('reqro.disposable_nonce', true) nonce,
            pg_postmaster_start_time() started`,
  );
  const census = await admin.query<{ count: number }>(
    `select count(*)::int count from pg_namespace
      where nspname not like 'pg_%'
        and nspname not in ('information_schema', 'public')`,
  );
  const row = facts.rows[0];
  return {
    url: {
      hostname: url.hostname,
      port: url.port === '' ? '5432' : url.port,
      database: url.pathname.replace(/^\//, ''),
      username: decodeURIComponent(url.username),
    },
    sql: {
      database: row?.db ?? '',
      user: row?.usr ?? '',
      nonce: row?.nonce ?? null,
      postmasterStart:
        row?.started === null || row?.started === undefined
          ? null
          : new Date(row.started),
      unexpectedSchemaCount: census.rows[0]?.count ?? null,
    },
    container: inspectContainer(expected.containerId),
    expected,
  };
}

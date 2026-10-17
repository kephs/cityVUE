import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { Pool } from 'pg';
import {
  inspectContainer,
  refuseUnlessOwnedCleanupTarget,
  type DisposableExpectations,
} from './disposable-cluster-evidence.js';

/**
 * F062.2D-2C-3B-2 NEW-a follow-up — the disposable `reqro_f0592_test` cluster.
 *
 * Provisions ONE PostgreSQL 17 container per validation run, holding the
 * database and role the ten identity-guarded suites require. One container
 * for the whole run, not one per file: `node --test` gives each of the 66
 * database files its own process, and a per-file cluster would add 66 cold
 * starts.
 *
 * Follows `operator-role-cluster.ts`, with three deliberate differences.
 * The image is pinned by DIGEST rather than by the mutable `postgres:17-alpine`
 * tag, because the digest is the trusted identity the evidence predicate
 * checks. A nonce is injected as both a server setting and a container label,
 * so a suite can prove in-band that it is talking to this container. And
 * teardown is authorized by name before it runs, so a mistyped identifier
 * cannot remove something this run does not own.
 *
 * Credentials are generated in memory for the container's lifetime. Nothing
 * is written to any `.env`, nothing is printed and nothing is committed.
 * `reqro_dev`, `reqro_test`, the development Compose stack and the local
 * PostgreSQL 18 service are never referenced: the published port is an
 * ephemeral free port, never 5432.
 */

/**
 * Pinned by digest, verified locally before use. `postgres:17-alpine` is
 * mutable and therefore not an identity.
 */
const IMAGE_DIGEST =
  'sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const IMAGE_REFERENCE = `postgres@${IMAGE_DIGEST}`;
const REQUIRED_MAJOR = 17;

export const TEST_DATABASE = 'reqro_f0592_test';
export const TEST_ROLE = 'reqro_test_user';

/** Volumes that must never be mounted or removed by this harness. */
export const DENIED_VOLUMES = [
  'cityvue-postgres-data',
  'server_cityvue-postgres-data',
] as const;

function docker(args: readonly string[], timeout = 120_000) {
  const result = spawnSync('docker', [...args], {
    encoding: 'utf8',
    timeout,
  });
  return {
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
  };
}

/** Ephemeral, in-memory only. Never persisted or printed. */
function secret(): string {
  return randomBytes(24).toString('base64url');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    // Loopback only, matching how the container publishes.
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not determine a free port'));
        return;
      }
      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

export function dockerAvailable(): boolean {
  return (
    docker(['info', '--format', '{{.ServerVersion}}'], 60_000).status === 0
  );
}

export interface DisposableCluster {
  readonly container: string;
  readonly containerId: string;
  readonly port: number;
  readonly nonce: string;
  readonly epoch: Date;
  readonly imageReference: string;
  readonly imageId: string;
  /** The URL the suites receive as `TEST_DATABASE_URL`. */
  readonly testUrl: string;
  /** The expectations the evidence predicate is given. */
  expectations(): DisposableExpectations;
  /** Environment the test child processes inherit. No credential leaves here
   * except inside `TEST_DATABASE_URL`, which the suites require. */
  environment(): Record<string, string>;
  /** Counts schemas that no test created. */
  census(): Promise<number>;
  /** Authorized teardown. Returns removal evidence. */
  destroy(): Promise<{
    readonly containerRemoved: boolean;
    readonly volumeRemoved: boolean;
    readonly volumeName: string | null;
    readonly refusal: string | null;
  }>;
}

/** Confirms the pinned image is present locally and really is that digest. */
function verifyImage(): void {
  const probe = docker([
    'image',
    'inspect',
    IMAGE_REFERENCE,
    '--format',
    '{{.Id}}',
  ]);
  if (probe.status !== 0)
    throw new Error(
      `the pinned PostgreSQL image is unavailable locally: ${IMAGE_REFERENCE}`,
    );
  if (probe.stdout !== IMAGE_DIGEST)
    throw new Error(
      `the pinned image resolved to ${probe.stdout}, expected ${IMAGE_DIGEST}`,
    );
}

/**
 * Starts the cluster and provisions the test identity. The returned handle
 * must be destroyed in a `finally`.
 */
export async function startDisposableCluster(): Promise<DisposableCluster> {
  verifyImage();

  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const container = `reqro-f0592-pg17-${suffix}`;
  const nonce = randomUUID().replaceAll('-', '');
  const bootstrap = { user: 'reqro_cluster_admin', password: secret() };
  const testRole = { user: TEST_ROLE, password: secret() };
  const port = await freePort();
  // Recorded BEFORE the container exists, so "created after the epoch" is a
  // real ordering rather than a tautology.
  const epoch = new Date();

  if (port === 5432)
    throw new Error('refusing to publish on 5432, the local service port');

  const urlFor = (role: { user: string; password: string }, database: string) =>
    `postgresql://${encodeURIComponent(role.user)}:${encodeURIComponent(
      role.password,
    )}@127.0.0.1:${String(port)}/${database}`;

  const started = docker([
    'run',
    '--detach',
    '--name',
    container,
    '--publish',
    `127.0.0.1:${String(port)}:5432`,
    '--label',
    `com.reqro.disposable=${nonce}`,
    '--env',
    `POSTGRES_USER=${bootstrap.user}`,
    '--env',
    `POSTGRES_PASSWORD=${bootstrap.password}`,
    '--env',
    'POSTGRES_DB=reqro_bootstrap',
    // No `--volume`: the image declares its own VOLUME, so Docker creates an
    // ANONYMOUS volume that `docker rm --volumes` removes. No development
    // volume is named, mounted or reachable.
    IMAGE_REFERENCE,
    // The nonce as a server setting. Injected out of band, read back in band.
    'postgres',
    '-c',
    `reqro.disposable_nonce=${nonce}`,
  ]);
  if (started.status !== 0)
    throw new Error(
      `could not start the disposable cluster: ${started.stderr}`,
    );
  const containerId = started.stdout;

  const bootstrapUrl = urlFor(bootstrap, 'reqro_bootstrap');
  const testUrl = urlFor(testRole, TEST_DATABASE);

  const expectations = (): DisposableExpectations => ({
    database: TEST_DATABASE,
    role: TEST_ROLE,
    nonce,
    containerId,
    imageReference: IMAGE_REFERENCE,
    imageId: IMAGE_DIGEST,
    harnessEpoch: epoch,
    deniedVolumeNames: DENIED_VOLUMES,
  });

  const volumeName = (): string | null => {
    const facts = inspectContainer(containerId);
    const mount = facts?.mounts[0];
    return mount === undefined ? null : mount.name;
  };

  const destroy = async (): Promise<{
    containerRemoved: boolean;
    volumeRemoved: boolean;
    volumeName: string | null;
    refusal: string | null;
  }> => {
    const volume = volumeName();
    // Authorize before destroying, not after.
    const refusal = refuseUnlessOwnedCleanupTarget(
      {
        containerId,
        volumeNames: volume === null ? [] : [volume],
      },
      { containerId, deniedVolumeNames: DENIED_VOLUMES },
    );
    if (refusal !== null)
      return {
        containerRemoved: false,
        volumeRemoved: false,
        volumeName: volume,
        refusal,
      };
    docker(['rm', '--force', '--volumes', containerId], 90_000);
    await Promise.resolve();
    return {
      containerRemoved: docker(['inspect', containerId]).status !== 0,
      volumeRemoved:
        volume === null || docker(['volume', 'inspect', volume]).status !== 0,
      volumeName: volume,
      refusal: null,
    };
  };

  try {
    // Readiness, bounded. `pg_isready` runs inside the container, so the host
    // needs no PostgreSQL client.
    let ready = false;
    for (let attempt = 0; attempt < 90 && !ready; attempt++) {
      ready =
        docker(
          [
            'exec',
            container,
            'pg_isready',
            '-U',
            bootstrap.user,
            '-d',
            'reqro_bootstrap',
          ],
          20_000,
        ).status === 0;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready)
      throw new Error('the disposable cluster did not become ready in time');

    // `pg_isready` is necessary but not sufficient: the official entrypoint
    // initializes against a temporary local-only server and then restarts the
    // real one, so there is a window in which `pg_isready` succeeds while a
    // published-port connection is still refused. The real condition is a
    // successful round trip over TCP.
    let accepted = false;
    let lastRefusal = '';
    for (let attempt = 0; attempt < 60 && !accepted; attempt++) {
      const probe = new Pool({
        connectionString: bootstrapUrl,
        max: 1,
        connectionTimeoutMillis: 5000,
      });
      try {
        await probe.query('select 1');
        accepted = true;
      } catch (error) {
        lastRefusal = (error as Error).message;
      } finally {
        await probe.end().catch(() => undefined);
      }
      if (!accepted) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!accepted)
      throw new Error(
        `the disposable cluster never accepted a connection: ${lastRefusal}`,
      );

    const admin = new Pool({ connectionString: bootstrapUrl, max: 2 });
    try {
      // The authoritative version gate: refuse anything but 17.
      const version = await admin.query<{ setting: string; full: string }>(
        `select current_setting('server_version_num') as setting,
                current_setting('server_version') as full`,
      );
      const major = Math.floor(Number(version.rows[0]?.setting ?? 0) / 10_000);
      if (major !== REQUIRED_MAJOR)
        throw new Error(
          `the disposable cluster must be PostgreSQL ${String(
            REQUIRED_MAJOR,
          )}, got ${version.rows[0]?.full ?? 'unknown'}`,
        );

      // The nonce must be readable by the NON-superuser test role, which is
      // what makes the in-band check available to the suites at all.
      const setting = await admin.query<{ value: string | null }>(
        "select current_setting('reqro.disposable_nonce', true) as value",
      );
      if (setting.rows[0]?.value !== nonce)
        throw new Error('the disposable nonce was not applied to the server');

      // Deliberately not a superuser and unable to create roles or
      // databases: the suites prove constrained behaviour, so the role they
      // run as must actually be constrained.
      await admin.query(
        `create role ${TEST_ROLE} login password '${testRole.password}'
           nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
      );
      // Owning the database grants CREATE on it and on its `public` schema,
      // which is what the per-test disposable schemas need.
      await admin.query(`create database ${TEST_DATABASE} owner ${TEST_ROLE}`);
      // PUBLIC keeps TEMPORARY and `public` CREATE on purpose. Revoking them
      // would be a tighter production posture but would disable the `pg_temp`
      // shadowing evidence F060.3C-2c-2 depends on.
    } finally {
      await admin.end();
    }
  } catch (error) {
    await destroy();
    throw error;
  }

  return {
    container,
    containerId,
    port,
    nonce,
    epoch,
    imageReference: IMAGE_REFERENCE,
    imageId: IMAGE_DIGEST,
    testUrl,
    expectations,
    environment: () => ({
      TEST_DATABASE_URL: testUrl,
      REQRO_DISPOSABLE_NONCE: nonce,
      REQRO_DISPOSABLE_CONTAINER_ID: containerId,
      REQRO_DISPOSABLE_IMAGE_REFERENCE: IMAGE_REFERENCE,
      REQRO_DISPOSABLE_IMAGE_ID: IMAGE_DIGEST,
      REQRO_DISPOSABLE_EPOCH: epoch.toISOString(),
    }),
    census: async () => {
      const pool = new Pool({ connectionString: testUrl, max: 1 });
      try {
        const result = await pool.query<{ count: number }>(
          `select count(*)::int count from pg_namespace
            where nspname not like 'pg_%'
              and nspname not in ('information_schema', 'public')`,
        );
        return result.rows[0]?.count ?? -1;
      } finally {
        await pool.end();
      }
    },
    destroy,
  };
}

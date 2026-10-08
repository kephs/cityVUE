import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { basename } from 'node:path';
import { Pool } from 'pg';

/**
 * ADR-027 F060.3C-2c-3. Launches a disposable PostgreSQL 17 cluster that this
 * test owns outright, so a genuinely constrained non-owner role can be proven.
 *
 * The existing disposable database cannot serve this purpose: `reqro_test_user`
 * lacks `CREATEROLE`, it owns the objects it creates, and the production
 * privilege posture this slice must prove — revoking `TEMPORARY` and schema
 * `CREATE` from `PUBLIC` — would disable the `pg_temp` shadowing evidence that
 * F060.3C-2c-2 depends on. A separate cluster keeps both intact.
 *
 * **PostgreSQL 17 is authoritative** because that is what `server/compose.yml`
 * pins. The developer's local 18.x server is corroborating only and is never
 * used here.
 *
 * Credentials are generated in memory for the container's lifetime. Nothing is
 * written to any `.env`, nothing is committed, and `reqro_dev` is never
 * referenced. The container is removed in `finally`, on success or failure.
 */
const IMAGE = 'postgres:17-alpine';
const REQUIRED_MAJOR = 17;

export interface ControlledCluster {
  readonly container: string;
  readonly port: number;
  readonly database: string;
  readonly schema: string;
  /** Cluster superuser, used only by the harness to provision roles. */
  readonly bootstrap: { user: string; password: string };
  /** Owns the database, schema, tables and functions; applies migrations. */
  readonly owner: { user: string; password: string };
  /** Constrained, owns nothing. The role under test. */
  readonly operator: { user: string; password: string };
  url(role: { user: string; password: string }): string;
  /**
   * Runs a local `.sql` file through `psql` **inside** the container, as the
   * schema owner, with `ON_ERROR_STOP`. Used to apply the real deployment
   * artifact rather than a test-local imitation of it, so what is proven is
   * the file that would be shipped.
   *
   * `psql` runs in the container, so the host needs no PostgreSQL client, and
   * the password is passed through the container environment rather than any
   * command line.
   */
  applySqlFile(
    file: string,
    variables: Readonly<Record<string, string>>,
  ): { status: number | null; stdout: string; stderr: string };
  destroy(): Promise<void>;
}

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

/** Ephemeral, in-memory only. Never persisted anywhere. */
function secret(): string {
  return randomBytes(24).toString('base64url');
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    // Bind to loopback only; the container publishes to 127.0.0.1 as well.
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

/**
 * Starts the cluster and provisions three genuinely separate identities. The
 * returned handle must be destroyed in a `finally`.
 */
export async function startControlledCluster(): Promise<ControlledCluster> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const container = `reqro-operator-pg17-${suffix}`;
  const database = `reqro_operator_${suffix}`;
  const schema = 'public';
  const bootstrap = { user: 'reqro_cluster_admin', password: secret() };
  const owner = { user: 'reqro_schema_owner', password: secret() };
  const operator = { user: 'reqro_operator', password: secret() };
  const port = await freePort();

  const url = (role: { user: string; password: string }) =>
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
    '--env',
    `POSTGRES_USER=${bootstrap.user}`,
    '--env',
    `POSTGRES_PASSWORD=${bootstrap.password}`,
    '--env',
    `POSTGRES_DB=${database}`,
    // A disposable cluster: no volume, so nothing survives removal.
    IMAGE,
  ]);
  if (started.status !== 0)
    throw new Error(
      `could not start the controlled cluster: ${started.stderr}`,
    );

  const destroy = async () => {
    docker(['rm', '--force', '--volumes', container], 90_000);
    await Promise.resolve();
  };

  try {
    // Readiness, bounded. pg_isready runs inside the container, so this does
    // not depend on the host having any PostgreSQL client.
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
            database,
          ],
          20_000,
        ).status === 0;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready)
      throw new Error('the controlled cluster did not become ready in time');

    // `pg_isready` is necessary but not sufficient. The official entrypoint
    // runs initialization against a temporary local-only server and then
    // restarts the real one, so there is a window in which `pg_isready`
    // succeeds while a published-port client connection is still refused or
    // dropped. Observed as an intermittent "Connection terminated
    // unexpectedly" on the first query. The real readiness condition is a
    // successful round trip over TCP, so that is what is waited for.
    let accepted = false;
    let lastRefusal = '';
    for (let attempt = 0; attempt < 60 && !accepted; attempt++) {
      const probe = new Pool({
        connectionString: url(bootstrap),
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
        `the controlled cluster never accepted a connection: ${lastRefusal}`,
      );

    const admin = new Pool({ connectionString: url(bootstrap), max: 2 });
    try {
      // The authoritative version gate: refuse to proceed on anything but 17.
      const version = await admin.query<{ setting: string; full: string }>(
        `select current_setting('server_version_num') as setting,
                current_setting('server_version') as full`,
      );
      const major = Math.floor(Number(version.rows[0]?.setting ?? 0) / 10_000);
      if (major !== REQUIRED_MAJOR)
        throw new Error(
          `controlled cluster must be PostgreSQL ${String(REQUIRED_MAJOR)}, got ${
            version.rows[0]?.full ?? 'unknown'
          }`,
        );

      // Three separate identities. The owner is deliberately not a superuser,
      // so "owner" means ownership rather than unlimited authority, and the
      // operator's non-ownership is a real constraint rather than a formality.
      await admin.query(
        `create role ${owner.user} login password '${owner.password}'
           nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
      );
      await admin.query(
        `create role ${operator.user} login password '${operator.password}'
           nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
      );
      await admin.query(`alter database ${database} owner to ${owner.user}`);
      await admin.query(`alter schema ${schema} owner to ${owner.user}`);
      // pgcrypto lives where the application expects it; gen_random_uuid is a
      // pg_catalog built-in from 13 onward, so this only mirrors the existing
      // environment rather than being load bearing.
      await admin.query(
        `create extension if not exists pgcrypto with schema ${schema}`,
      );
    } finally {
      await admin.end();
    }

    const applySqlFile = (
      file: string,
      variables: Readonly<Record<string, string>>,
    ) => {
      const inside = `/tmp/${basename(file)}`;
      const copied = docker(['cp', file, `${container}:${inside}`]);
      if (copied.status !== 0)
        throw new Error(
          `could not copy ${file} into the cluster: ${copied.stderr}`,
        );
      const assignments: string[] = [];
      for (const [key, value] of Object.entries(variables))
        assignments.push('--set', `${key}=${value}`);
      return docker([
        'exec',
        '--env',
        `PGPASSWORD=${owner.password}`,
        container,
        'psql',
        '--no-psqlrc',
        '--quiet',
        '--set',
        'ON_ERROR_STOP=1',
        '--username',
        owner.user,
        '--dbname',
        database,
        ...assignments,
        '--file',
        inside,
      ]);
    };

    return {
      container,
      port,
      database,
      schema,
      bootstrap,
      owner,
      operator,
      url,
      applySqlFile,
      destroy,
    };
  } catch (error) {
    await destroy();
    throw error;
  }
}

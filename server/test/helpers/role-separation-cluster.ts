import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { basename } from 'node:path';
import { Pool } from 'pg';

/**
 * ADR-027 F060.3C-2d. A disposable PostgreSQL 17 cluster carrying the full
 * five-identity topology, so owner/migration/runtime separation can be proven
 * rather than asserted.
 *
 * Deliberately a **separate** harness from `operator-role-cluster.ts` rather
 * than an extension of it. That harness gives its owner role `LOGIN` and
 * applies SQL files by connecting as the owner; this topology requires the
 * owner to be `NOLOGIN`, which would break it. The operator suite and the
 * Migration 49 suite both depend on that harness being exactly as proven, so
 * it is left untouched.
 *
 * **PostgreSQL 17 is authoritative** because `server/compose.yml` pins
 * `postgres:17-alpine`. The version gate refuses anything else, so a newer
 * local server cannot silently become the evidence.
 *
 * Credentials are generated in memory for the container's lifetime. Nothing is
 * written to any `.env`, nothing is committed, and `reqro_dev` is never
 * referenced. The container is removed in `finally`.
 */
const IMAGE = 'postgres:17-alpine';
const REQUIRED_MAJOR = 17;

export interface SeparatedRole {
  readonly user: string;
  readonly password: string;
}

export interface SeparatedCluster {
  readonly container: string;
  readonly port: number;
  readonly database: string;
  readonly schema: string;
  /** Cluster superuser. Exists only to bootstrap the topology. */
  readonly bootstrap: SeparatedRole;
  /** NOLOGIN. Owns the database, schema and every application object. */
  readonly owner: { user: string };
  /** LOGIN, member of the owner with NOINHERIT. Applies migrations. */
  readonly migrate: SeparatedRole;
  /** LOGIN, owns nothing. The application identity. */
  readonly runtime: SeparatedRole;
  /** LOGIN, owns nothing. Unchanged from F060.3C-2c-3. */
  readonly operator: SeparatedRole;
  url(role: SeparatedRole): string;
  /**
   * Runs a local `.sql` file through `psql` inside the container as `role`,
   * optionally having assumed another role first.
   *
   * `assumeRole` is delivered through `PGOPTIONS='-c role=...'`, which sets the
   * `role` GUC at connection start and is equivalent to an explicit
   * `SET ROLE`. That is how a file can be applied "as the owner" even though
   * the owner cannot log in.
   */
  applySqlFileAs(
    role: SeparatedRole,
    file: string,
    variables: Readonly<Record<string, string>>,
    assumeRole?: string,
  ): { status: number | null; stdout: string; stderr: string };
  destroy(): Promise<void>;
}

function docker(args: readonly string[], timeout = 120_000) {
  const result = spawnSync('docker', [...args], { encoding: 'utf8', timeout });
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

export async function startSeparatedCluster(): Promise<SeparatedCluster> {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16);
  const container = `reqro-roles-pg17-${suffix}`;
  const database = `reqro_roles_${suffix}`;
  const schema = 'public';
  const bootstrap = { user: 'reqro_cluster_admin', password: secret() };
  const owner = { user: 'reqro_owner' };
  const migrate = { user: 'reqro_migrate', password: secret() };
  const runtime = { user: 'reqro_runtime', password: secret() };
  const operator = { user: 'reqro_operator', password: secret() };
  const port = await freePort();

  const url = (role: SeparatedRole) =>
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
    // Disposable: no volume, so nothing survives removal.
    IMAGE,
  ]);
  if (started.status !== 0)
    throw new Error(`could not start the role cluster: ${started.stderr}`);

  const destroy = async () => {
    docker(['rm', '--force', '--volumes', container], 90_000);
    await Promise.resolve();
  };

  try {
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
      throw new Error('the role cluster did not become ready in time');

    // `pg_isready` can succeed against the entrypoint's temporary
    // initialization server, which is then restarted, so the real readiness
    // condition is a successful TCP round trip.
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
        `the role cluster never accepted a connection: ${lastRefusal}`,
      );

    const admin = new Pool({ connectionString: url(bootstrap), max: 2 });
    try {
      const version = await admin.query<{ setting: string; full: string }>(
        `select current_setting('server_version_num') as setting,
                current_setting('server_version') as full`,
      );
      const major = Math.floor(Number(version.rows[0]?.setting ?? 0) / 10_000);
      if (major !== REQUIRED_MAJOR)
        throw new Error(
          `the role cluster must be PostgreSQL ${String(REQUIRED_MAJOR)}, got ${
            version.rows[0]?.full ?? 'unknown'
          }`,
        );

      // Passwords are set here because a disposable container has no secret
      // manager; the shipped bootstrap artifact deliberately sets none.
      await admin.query(
        `create role ${owner.user} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
      );
      for (const role of [migrate, runtime, operator])
        await admin.query(
          `create role ${role.user} login password '${role.password}'
             nosuperuser nocreatedb nocreaterole noinherit nobypassrls`,
        );
      await admin.query(`grant ${owner.user} to ${migrate.user}`);
      await admin.query(`alter database ${database} owner to ${owner.user}`);
      await admin.query(`alter schema ${schema} owner to ${owner.user}`);
      // pgcrypto mirrors the existing environment. `gen_random_uuid` is a
      // pg_catalog built-in from PostgreSQL 13, so this is not load bearing.
      await admin.query(
        `create extension if not exists pgcrypto with schema ${schema}`,
      );
    } finally {
      await admin.end();
    }

    const applySqlFileAs = (
      role: SeparatedRole,
      file: string,
      variables: Readonly<Record<string, string>>,
      assumeRole?: string,
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
      const options = [`-c search_path=${schema}`];
      if (assumeRole !== undefined) options.unshift(`-c role=${assumeRole}`);
      return docker([
        'exec',
        '--env',
        `PGPASSWORD=${role.password}`,
        '--env',
        `PGOPTIONS=${options.join(' ')}`,
        container,
        'psql',
        '--no-psqlrc',
        '--quiet',
        '--set',
        'ON_ERROR_STOP=1',
        '--username',
        role.user,
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
      migrate,
      runtime,
      operator,
      url,
      applySqlFileAs,
      destroy,
    };
  } catch (error) {
    await destroy();
    throw error;
  }
}

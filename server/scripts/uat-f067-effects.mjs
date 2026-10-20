/**
 * F067 — the live effects for the UAT session orchestrator.
 *
 * This is the only file that runs Docker, connects to PostgreSQL or writes
 * files. The orchestrator takes these as an injected object, so its lifecycle
 * is exercised offline against mocks and nothing here is reached by a test.
 *
 * Compiled test helpers are imported from `dist-test`, exactly as
 * `test-db-disposable.mjs` does, so provisioning, image verification,
 * instance evidence and cleanup verification all remain the existing
 * implementations rather than second copies. `docker()` itself is private to
 * the cluster helper, so Docker is invoked here and normalised through the
 * exported `normalizeDockerResult`; `verifyCleanup` still decides absence.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SESSION_FILE,
  UAT_ENV_FILE,
  UAT_DATABASE,
} from './uat-f067-session.mjs';

const LOCK_FILE = resolve(dirname(SESSION_FILE), 'uat-f067-session.lock');

function dockerRun(args, timeout = 120_000) {
  return spawnSync('docker', args, { encoding: 'utf8', timeout });
}

export async function createLiveEffects({ serverRoot }) {
  const distTest = resolve(serverRoot, 'dist-test', 'test');
  const load = async (file) => {
    const path = resolve(distTest, 'helpers', file);
    if (!existsSync(path))
      throw new Error(
        `the compiled helper ${file} is missing; run the test build first`,
      );
    return import(pathToFileURL(path).href);
  };
  const clusterHelper = await load('f0592-disposable-cluster.js');
  const evidenceHelper = await load('disposable-cluster-evidence.js');
  const {
    startDisposableCluster,
    dockerAvailable,
    normalizeDockerResult,
    volumeTargetFromProbe,
    verifyCleanup,
    classifyResourceAbsence,
    TEST_ROLE,
    DENIED_VOLUMES,
  } = clusterHelper;
  const {
    collectDisposableEvidence,
    refuseUnlessDisposable,
    refuseUnlessOwnedCleanupTarget,
  } = evidenceHelper;

  const inspect = (id) =>
    normalizeDockerResult(dockerRun(['inspect', id], 60_000));

  return {
    testRole: TEST_ROLE,
    secretPath: UAT_ENV_FILE,
    // Writing a secret-bearing file is a separate authorization from running
    // the session at all, so it is never implied by --confirm.
    secretWriteAuthorized:
      process.env.REQRO_F067_UAT_SECRET_AUTHORIZED === 'true',
    now: () => new Date(),
    dockerAvailable,

    startCluster: () => startDisposableCluster(),

    collectEvidence: async (url, expectations) => {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: url, max: 2 });
      try {
        // Runs its own Docker inspection internally, so the out-of-band and
        // in-band channels stay exactly as the gate collects them.
        return await collectDisposableEvidence(pool, url, expectations);
      } finally {
        await pool.end();
      }
    },
    refuseUnlessDisposable,

    expectationsFromRecord: async (record) => ({
      database: UAT_DATABASE,
      role: record.role,
      nonce: record.nonce,
      containerId: record.containerId,
      imageReference: record.imageReference,
      imageId: record.imageId,
      imageRepositoryDigest: record.imageRepositoryDigest,
      harnessEpoch: new Date(record.epoch),
      deniedVolumeNames: DENIED_VOLUMES,
    }),

    listAppliedMigrations: async (url) => {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: url, max: 1 });
      try {
        const present = await pool.query(
          "select 1 from information_schema.tables where table_name = 'kysely_migration'",
        );
        if (present.rowCount === 0) return [];
        const rows = await pool.query(
          'select name from kysely_migration order by name',
        );
        return rows.rows.map((row) => String(row.name));
      } finally {
        await pool.end();
      }
    },

    applyMigrations: async (url) => {
      const { Pool } = await import('pg');
      const { Kysely, Migrator, PostgresDialect, FileMigrationProvider } =
        await import('kysely');
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const extensions = await load('database-extensions.js').catch(() => null);
      const pool = new Pool({ connectionString: url });
      try {
        if (extensions?.prepareDatabaseExtensions)
          await extensions.prepareDatabaseExtensions(pool);
        const db = new Kysely({ dialect: new PostgresDialect({ pool }) });
        const migrator = new Migrator({
          db,
          provider: new FileMigrationProvider({
            fs,
            path,
            migrationFolder: resolve(serverRoot, 'migrations'),
          }),
        });
        const result = await migrator.migrateToLatest();
        return {
          applied: (result.results ?? [])
            .filter((entry) => entry.status === 'Success')
            .map((entry) => String(entry.migrationName)),
          error: result.error ? String(result.error) : null,
        };
      } finally {
        await pool.end();
      }
    },

    /**
     * Synthetic fixtures, disposable-only.
     *
     * `seed:development` is reused unchanged: it reads DATABASE_URL rather
     * than pinning a target, so pointing it at the disposable URL needs no
     * change to it and no weakening of `assertDevelopmentDatabaseUrl`. It
     * provisions the Organization, catalog and a staff identity.
     *
     * It creates no service_request or request_communication rows and grants
     * no `service_request.tracking.manage`, so the census below is honest
     * about what is missing and `evaluateFixtureReadiness` refuses rather
     * than reporting a session ready for tracking UAT. Supplying those rows
     * is a separately authorized bounded addition; fabricating their SQL here
     * without a live schema to verify it against is exactly what this
     * harness should not do.
     */
    applyFixtures: async (url) => {
      const seeded = spawnSync(
        process.execPath,
        [
          resolve(serverRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
          'src/database/seed-development.ts',
        ],
        {
          cwd: serverRoot,
          encoding: 'utf8',
          timeout: 300_000,
          env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
        },
      );
      if (seeded.status !== 0)
        throw new Error(
          `seed:development failed with status ${String(seeded.status)}`,
        );
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: url, max: 2 });
      try {
        const count = async (sql) =>
          Number((await pool.query(sql)).rows[0]?.n ?? 0);
        return {
          organizations: await count(
            'select count(*)::int n from organization',
          ),
          serviceDefinitions: await count(
            'select count(*)::int n from service_definition',
          ),
          staffIdentities: await count(
            'select count(*)::int n from staff_identity',
          ),
          residentVisibleUpdates: await count(
            "select count(*)::int n from request_communication where direction='outbound' and channel='portal' and delivery_state='recorded'",
          ),
          publicRequestsWithUpdates: await count(
            "select count(*)::int n from service_request r where r.audience='public' and exists(select 1 from request_communication m where m.service_request_id=r.id and m.direction='outbound' and m.channel='portal' and m.delivery_state='recorded')",
          ),
          publicRequestsWithoutUpdates: await count(
            "select count(*)::int n from service_request r where r.audience='public' and not exists(select 1 from request_communication m where m.service_request_id=r.id and m.direction='outbound' and m.channel='portal' and m.delivery_state='recorded')",
          ),
        };
      } finally {
        await pool.end();
      }
    },

    censusFixtures: async (url) => {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: url, max: 2 });
      try {
        const count = async (sql) =>
          Number((await pool.query(sql)).rows[0]?.n ?? 0);
        return {
          organizations: await count(
            'select count(*)::int n from organization',
          ),
          serviceDefinitions: await count(
            'select count(*)::int n from service_definition',
          ),
          staffIdentities: await count(
            'select count(*)::int n from staff_identity',
          ),
          residentVisibleUpdates: await count(
            "select count(*)::int n from request_communication where direction='outbound' and channel='portal' and delivery_state='recorded'",
          ),
          publicRequestsWithUpdates: await count(
            "select count(*)::int n from service_request r where r.audience='public' and exists(select 1 from request_communication m where m.service_request_id=r.id and m.direction='outbound' and m.channel='portal' and m.delivery_state='recorded')",
          ),
          publicRequestsWithoutUpdates: await count(
            "select count(*)::int n from service_request r where r.audience='public' and not exists(select 1 from request_communication m where m.service_request_id=r.id and m.direction='outbound' and m.channel='portal' and m.delivery_state='recorded')",
          ),
        };
      } finally {
        await pool.end();
      }
    },

    inspectContainer: (containerId) => {
      const probe = inspect(containerId);
      const absence = classifyResourceAbsence('container', containerId, probe);
      if (absence.outcome === 'absent')
        return { outcome: 'absent', detail: absence.detail };
      if (absence.outcome === 'unknown')
        return { outcome: 'unknown', detail: absence.detail };
      let records;
      try {
        records = JSON.parse(probe.stdout);
      } catch {
        return {
          outcome: 'unknown',
          detail: 'the container inspection was not valid JSON',
        };
      }
      const record = Array.isArray(records) ? records[0] : undefined;
      if (record === undefined)
        return {
          outcome: 'unknown',
          detail: 'the container inspection returned no records',
        };
      return {
        outcome: 'present',
        containerId: String(record.Id ?? ''),
        label: String(record.Config?.Labels?.['com.reqro.disposable'] ?? ''),
        candidates: [String(record.Id ?? '')],
        detail: 'inspected',
      };
    },

    removeContainerAndVolume: async (containerId) => {
      const probe = inspect(containerId);
      const volume = volumeTargetFromProbe(containerId, probe);
      const refusal = refuseUnlessOwnedCleanupTarget(
        {
          containerId,
          volumeNames:
            volume.kind === 'known' && volume.name ? [volume.name] : [],
        },
        { containerId, deniedVolumeNames: DENIED_VOLUMES },
      );
      if (refusal !== null)
        return verifyCleanup({
          containerId,
          refusal,
          removal: null,
          containerAbsence: null,
          volume,
          volumeAbsence: null,
        });
      // Exactly this container, and only the anonymous volume it owns.
      const removal = normalizeDockerResult(
        dockerRun(['rm', '--force', '--volumes', containerId], 120_000),
      );
      return verifyCleanup({
        containerId,
        refusal: null,
        removal,
        containerAbsence: inspect(containerId),
        volume,
        volumeAbsence:
          volume.kind === 'known' && volume.name
            ? normalizeDockerResult(
                dockerRun(['volume', 'inspect', volume.name], 60_000),
              )
            : null,
      });
    },

    readSession: async () => {
      if (!existsSync(SESSION_FILE)) return null;
      try {
        return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
      } catch {
        return { corrupt: true };
      }
    },
    writeSession: async (record) => {
      mkdirSync(dirname(SESSION_FILE), { recursive: true });
      const handle = openSync(SESSION_FILE, 'w', 0o600);
      try {
        writeSync(handle, `${JSON.stringify(record, null, 2)}\n`);
      } finally {
        closeSync(handle);
      }
    },
    removeSession: async () => {
      rmSync(SESSION_FILE, { force: true });
      return !existsSync(SESSION_FILE);
    },

    readLock: async () => {
      if (!existsSync(LOCK_FILE)) return null;
      try {
        return JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
      } catch {
        return { unreadable: true };
      }
    },
    lockOwnerAlive: async () => {
      if (!existsSync(LOCK_FILE)) return false;
      let lock;
      try {
        lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
      } catch {
        return null;
      }
      if (!Number.isInteger(lock?.pid)) return null;
      try {
        // Signal 0 tests for existence without delivering a signal, so no
        // unrelated process is ever disturbed.
        process.kill(lock.pid, 0);
        return true;
      } catch (error) {
        return error?.code === 'ESRCH' ? false : null;
      }
    },
    acquireLock: async () => {
      mkdirSync(dirname(LOCK_FILE), { recursive: true });
      try {
        // Exclusive creation: the filesystem decides the race, so two
        // invocations cannot both believe they hold the session.
        const handle = openSync(LOCK_FILE, 'wx', 0o600);
        try {
          writeSync(
            handle,
            `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2)}\n`,
          );
        } finally {
          closeSync(handle);
        }
        return true;
      } catch {
        return false;
      }
    },
    releaseLock: async () => {
      try {
        unlinkSync(LOCK_FILE);
      } catch {
        /* an already-absent lock is not an error */
      }
    },

    secretPathGitignored: async () => {
      const result = spawnSync('git', ['check-ignore', '-q', UAT_ENV_FILE], {
        cwd: serverRoot,
        encoding: 'utf8',
        timeout: 30_000,
      });
      return result.status === 0;
    },
    secretExists: async () => existsSync(UAT_ENV_FILE),
    writeSecret: async ({ url, mode }) => {
      // Exclusive, so an existing file is never overwritten. On Windows the
      // mode does not remove inherited ACL entries; the gitignored path,
      // exclusive creation and verified deletion carry confidentiality.
      const handle = openSync(UAT_ENV_FILE, 'wx', mode);
      try {
        writeSync(
          handle,
          [
            '# F067 UAT session. Generated, gitignored, deleted at session end.',
            `DATABASE_URL=${url}`,
            'PORT=3001',
            'CORS_ORIGINS=http://localhost:5174',
            'NODE_ENV=development',
            'CITYVUE_DEPLOYMENT_PROFILE=development',
            `DEVELOPMENT_ORGANIZATION_ID=10000000-0000-4000-8000-000000000001`,
            '',
          ].join('\n'),
        );
      } finally {
        closeSync(handle);
      }
    },
    readSecretUrl: async () => {
      const text = readFileSync(UAT_ENV_FILE, 'utf8');
      const match = /^DATABASE_URL=(.+)$/m.exec(text);
      if (match === null)
        throw new Error('the session secret file carries no DATABASE_URL');
      return match[1].trim();
    },
    removeSecret: async () => {
      rmSync(UAT_ENV_FILE, { force: true });
      return !existsSync(UAT_ENV_FILE);
    },
  };
}

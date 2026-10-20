/**
 * F067 disposable migration CLI — run through `tsx`, disposable targets only.
 *
 * This is the TypeScript-aware entry point the orchestrator spawns in place of
 * driving Kysely's `Migrator` from an `.mjs` file, which could not import a
 * `.ts` migration under Node 20 and therefore never worked. Running it under
 * `tsx` over the `migrations/` source directory is how the application's own
 * `migration:up` script discovers migrations, so all sixty are reachable here,
 * including the four that are never compiled into `dist-test`.
 *
 * The connection string comes from `REQRO_F067_UAT_DATABASE_URL` and nowhere
 * else. `DATABASE_URL` is deliberately not read and no dotenv loader is
 * imported, so a populated `server/.env` cannot silently redirect a migration
 * at a persistent database.
 *
 * Nothing here prints a connection string, a password or a credential. The
 * JSON written to stdout carries migration identities and refusal reasons
 * only.
 */
import 'reflect-metadata';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
} from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from './database.types.js';
import { commandFailure } from '../common/logging/log-sanitization.js';
import {
  DISPOSABLE_MIGRATION_NONCE_VARIABLE,
  DISPOSABLE_MIGRATION_ROLE_VARIABLE,
  DISPOSABLE_MIGRATION_URL_VARIABLE,
  runDisposableMigration,
} from './uat-f067-disposable-migration.js';
import { readTargetFacts } from './uat-f067-tracking-fixture.js';

function required(name: string): string {
  const value = process.env[name];
  if (typeof value !== 'string' || value.trim() === '')
    throw new Error(`Explicit ${name} is required`);
  return value;
}

async function run(): Promise<void> {
  const url = required(DISPOSABLE_MIGRATION_URL_VARIABLE);
  const expectedNonce = required(DISPOSABLE_MIGRATION_NONCE_VARIABLE);
  const expectedRole = required(DISPOSABLE_MIGRATION_ROLE_VARIABLE);
  const migrationFolder = path.resolve(process.cwd(), 'migrations');
  const pool = new Pool({ connectionString: url, max: 1 });
  const database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  });
  try {
    const result = await runDisposableMigration({
      readTargetFacts: () =>
        database
          .transaction()
          .execute((trx) =>
            readTargetFacts(trx, url, expectedNonce, expectedRole),
          ),
      readDeclaredMigrations: async () =>
        (await fs.readdir(migrationFolder))
          .filter((name) => name.endsWith('.ts') && !name.endsWith('.d.ts'))
          .map((name) => name.replace(/\.ts$/, ''))
          .sort(),
      // The same preparation the disposable test infrastructure performs:
      // one database-scoped advisory lock, pgcrypto in the shared public
      // schema, and a positive check that it landed there. Restated rather
      // than imported because `src` must not depend on `test`, and a unit
      // test asserts the two stay in agreement.
      prepareExtensions: async () => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query('select pg_advisory_xact_lock(20260902, 1)');
          await client.query(
            'create extension if not exists pgcrypto with schema public',
          );
          const installed = await client.query<{ schema: string }>(
            `select n.nspname as schema from pg_extension e
             join pg_namespace n on n.oid = e.extnamespace
             where e.extname = 'pgcrypto'`,
          );
          if (installed.rows[0]?.schema !== 'public')
            throw new Error(
              'Test pgcrypto must be installed in the shared public schema',
            );
          await client.query('commit');
        } catch (error) {
          await client.query('rollback');
          throw error;
        } finally {
          client.release();
        }
      },
      migrate: async () => {
        const migrator = new Migrator({
          db: database,
          provider: new FileMigrationProvider({ fs, path, migrationFolder }),
        });
        const outcome = await migrator.migrateToLatest();
        return {
          applied: (outcome.results ?? [])
            .filter((entry) => entry.status === 'Success')
            .map((entry) => entry.migrationName),
          error:
            outcome.error === undefined || outcome.error === null
              ? null
              : outcome.error instanceof Error
                ? outcome.error.message
                : 'the migration framework returned a non-error failure',
        };
      },
    });
    process.stdout.write(
      `${JSON.stringify({
        ok: result.ok,
        appliedCount: result.applied.length,
        declaredCount: result.declared.length,
        applied: result.applied,
        reasons: result.reasons,
      })}\n`,
    );
    if (!result.ok) process.exitCode = 1;
  } finally {
    await database.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    commandFailure('F067 disposable migration failed', error),
  );
  process.exitCode = 1;
});

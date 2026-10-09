import 'reflect-metadata';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  FileMigrationProvider,
  Kysely,
  Migrator,
  PostgresDialect,
  sql,
} from 'kysely';
import { Pool } from 'pg';
import { validateEnvironment } from '../config/environment.js';
import { databaseConnectionOptions } from '../config/database-tls.js';
import {
  assertMigrationLoginSeparate,
  assertMigrationRoleAssumed,
  resolveMigrationConnection,
  type MigrationConnection,
} from '../config/database-roles.js';
import type { DatabaseSchema } from './database.types.js';
import { commandFailure } from '../common/logging/log-sanitization.js';

const migrationsDirectory = path.resolve(process.cwd(), 'migrations');

/**
 * ADR-027 F060.3C-2d. Migrations connect with the dedicated migration
 * credential, not the runtime one, and pin the deployment-owned schema.
 *
 * `max: 1` is deliberate: the owner role is assumed per connection with
 * `SET ROLE`, so a pool that could hand out a second, un-assumed connection
 * would be able to run DDL as the migration login instead of the owner.
 */
function createDatabase(
  environment: ReturnType<typeof validateEnvironment>,
  migration: MigrationConnection,
): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        ...databaseConnectionOptions({
          environment: environment.NODE_ENV,
          url: migration.url,
          sslMode: environment.DATABASE_SSL_MODE,
          caFile: environment.DATABASE_SSL_CA_FILE,
        }),
        options: migration.connectionOptions,
        max: 1,
        connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
        statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
        application_name: environment.APP_NAME,
      }),
    }),
  });
}

/**
 * Assumes the owner role, then proves it.
 *
 * Objects created after `SET ROLE` belong to the owner rather than to whichever
 * credential ran the migration, which is what gives every deployment identical
 * ownership. `session_user` is unchanged by the assumption, so the migration
 * login remains in the audit trail. Both facts are asserted rather than
 * assumed, and the whole check runs before any migration is applied.
 */
async function assumeOwnerRole(
  database: Kysely<DatabaseSchema>,
  migration: MigrationConnection,
): Promise<void> {
  const before = await sql<{
    current_user: string;
    session_user: string;
  }>`select current_user, session_user`.execute(database);
  const login = before.rows[0]?.session_user ?? '';
  assertMigrationLoginSeparate(login, migration.ownerRole);

  // A plain identifier, validated on resolution, so this cannot carry a second
  // statement.
  await sql.raw(`set role ${migration.ownerRole}`).execute(database);

  const after = await sql<{
    current_user: string;
    session_user: string;
  }>`select current_user, session_user`.execute(database);
  assertMigrationRoleAssumed(
    {
      currentUser: after.rows[0]?.current_user ?? '',
      sessionUser: after.rows[0]?.session_user ?? '',
    },
    { ownerRole: migration.ownerRole, loginRole: login },
  );
}

function createMigrator(database: Kysely<DatabaseSchema>): Migrator {
  return new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: migrationsDirectory,
    }),
  });
}

function asMigrationError(value: unknown): Error {
  return value instanceof Error
    ? value
    : new Error('Migration framework returned a non-error failure result');
}

async function createMigration(description: string | undefined): Promise<void> {
  if (!description || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(description)) {
    throw new Error(
      'Migration description must use lowercase kebab-case, for example add-platform-setting',
    );
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  const filename = `${timestamp}-${description}.ts`;
  const content = `import type { Kysely } from 'kysely';\n\nexport async function up(db: Kysely<unknown>): Promise<void> {\n  void db;\n}\n\nexport async function down(db: Kysely<unknown>): Promise<void> {\n  void db;\n}\n`;
  await fs.writeFile(path.join(migrationsDirectory, filename), content, {
    flag: 'wx',
  });
  process.stdout.write(`Created migrations/${filename}\n`);
}

async function run(): Promise<void> {
  const command = process.argv[2];
  if (command === 'create') {
    await createMigration(process.argv[3]);
    return;
  }

  const environment = validateEnvironment(process.env);
  const migration = resolveMigrationConnection(process.env);
  const database = createDatabase(environment, migration);
  const migrator = createMigrator(database);
  try {
    await assumeOwnerRole(database, migration);
    if (!migration.dedicatedCredential)
      process.stdout.write(
        'warning: MIGRATION_DATABASE_URL is unset; using the development fallback credential\n',
      );
    if (command === 'up') {
      const result = await migrator.migrateToLatest();
      result.results?.forEach((migration) =>
        process.stdout.write(
          `${migration.status}: ${migration.migrationName}\n`,
        ),
      );
      if (result.error) {
        throw asMigrationError(result.error);
      }
      return;
    }

    if (command === 'down') {
      const result = await migrator.migrateDown();
      result.results?.forEach((migration) =>
        process.stdout.write(
          `${migration.status}: ${migration.migrationName}\n`,
        ),
      );
      if (result.error) {
        throw asMigrationError(result.error);
      }
      return;
    }

    if (command === 'status') {
      const migrations = await migrator.getMigrations();
      if (migrations.length === 0) {
        process.stdout.write('No migrations defined.\n');
      } else {
        migrations.forEach((migration) =>
          process.stdout.write(
            `${migration.executedAt ? 'executed' : 'pending'}: ${migration.name}\n`,
          ),
        );
      }
      return;
    }

    throw new Error('Expected command: create, up, down, or status');
  } finally {
    await database.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(commandFailure('Migration command failed', error));
  process.exitCode = 1;
});

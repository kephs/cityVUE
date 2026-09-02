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
import { validateEnvironment } from '../config/environment.js';
import type { DatabaseSchema } from './database.types.js';

const migrationsDirectory = path.resolve(process.cwd(), 'migrations');

function createDatabase(): Kysely<DatabaseSchema> {
  const environment = validateEnvironment(process.env);
  return new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: environment.DATABASE_URL,
        max: environment.DATABASE_POOL_MAX,
        connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
        statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
        application_name: environment.APP_NAME,
        ...(environment.DATABASE_SSL_MODE === 'disable'
          ? {}
          : {
              ssl: {
                rejectUnauthorized:
                  environment.DATABASE_SSL_MODE === 'verify-full',
              },
            }),
      }),
    }),
  });
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

  const database = createDatabase();
  const migrator = createMigrator(database);
  try {
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
  const message =
    error instanceof Error ? error.message : 'Unknown migration error';
  process.stderr.write(`Migration command failed: ${message}\n`);
  process.exitCode = 1;
});

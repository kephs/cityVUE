import 'reflect-metadata';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { commandFailure } from '../common/logging/log-sanitization.js';
import { databaseConnectionOptions } from '../config/database-tls.js';
import { validateEnvironment } from '../config/environment.js';
import type { DatabaseSchema } from './database.types.js';
import {
  developmentGeospatialGrantInput,
  provisionDevelopmentGeospatialGrant,
} from './development-geospatial-grant.js';

async function run(): Promise<void> {
  const environment = validateEnvironment(process.env);
  const input = developmentGeospatialGrantInput(environment, process.env);
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        ...databaseConnectionOptions({
          environment: environment.NODE_ENV,
          url: environment.DATABASE_URL,
          sslMode: environment.DATABASE_SSL_MODE,
          caFile: environment.DATABASE_SSL_CA_FILE,
        }),
        max: environment.DATABASE_POOL_MAX,
        connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
        statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
        application_name: environment.APP_NAME,
      }),
    }),
  });
  try {
    await provisionDevelopmentGeospatialGrant(db, input);
    process.stdout.write('Development geospatial identity provisioned.\n');
  } finally {
    await db.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    commandFailure('Development provisioning failed', error),
  );
  process.exitCode = 1;
});

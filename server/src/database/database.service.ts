import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool, type PoolConfig } from 'pg';
import type { AppConfiguration } from '../config/configuration.js';
import { PinoLoggerService } from '../common/logging/pino-logger.service.js';
import type { DatabaseSchema, DatabaseStatus } from './database.types.js';

function databaseErrorContext(error: unknown): {
  errorName: string;
  errorCode: string;
} {
  if (error instanceof Error) {
    const code = 'code' in error ? error.code : undefined;
    return {
      errorName: error.name,
      errorCode: typeof code === 'string' ? code : 'unknown',
    };
  }

  return { errorName: 'UnknownDatabaseError', errorCode: 'unknown' };
}

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly client: Kysely<DatabaseSchema>;
  private readonly pool: Pool;

  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly logger: PinoLoggerService,
  ) {
    const sslMode = config.get('database.sslMode', { infer: true });
    const poolConfig: PoolConfig = {
      connectionString: config.get('database.url', { infer: true }),
      max: config.get('database.poolMax', { infer: true }),
      connectionTimeoutMillis: config.get('database.connectionTimeoutMs', {
        infer: true,
      }),
      statement_timeout: config.get('database.statementTimeoutMs', {
        infer: true,
      }),
      application_name: config.get('app.name', { infer: true }),
      ...(sslMode === 'disable'
        ? {}
        : {
            ssl: {
              rejectUnauthorized: sslMode === 'verify-full',
            },
          }),
    };

    this.pool = new Pool(poolConfig);
    this.pool.on('error', (error) => {
      this.logger.logger.error(
        databaseErrorContext(error),
        'Idle PostgreSQL client error',
      );
    });
    this.client = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({ pool: this.pool }),
    });
  }

  async status(): Promise<DatabaseStatus> {
    try {
      await sql`select 1`.execute(this.client);
      return 'up';
    } catch (error) {
      this.logger.logger.warn(
        databaseErrorContext(error),
        'PostgreSQL readiness check failed',
      );
      return 'down';
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.destroy();
  }
}

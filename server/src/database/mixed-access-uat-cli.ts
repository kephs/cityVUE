import 'reflect-metadata';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import type { DatabaseSchema } from './database.types.js';
import { mixedAccessEnvironment, mixedAccessUat } from './mixed-access-uat.js';

async function run() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(
      'Jordan-only mixed-source fixture: add|cleanup --dry-run|--confirm. Requires F057_MIXED_SOURCE_UAT=true, F057_FIXTURE_STAFF_ID, F057_FIXTURE_PERMISSION=service_request.create, F057_EXPECTED_REVISION and existing approved personal development configuration. Organization is derived. Add requires the prior manual managed grant. Cleanup requires separate approval. No F057 audit event is fabricated.\n',
    );
    return;
  }
  const [operation, mode] = args;
  if (
    args.length !== 2 ||
    !['add', 'cleanup'].includes(operation ?? '') ||
    !['--dry-run', '--confirm'].includes(mode ?? '')
  )
    throw new Error('Explicit operation and mode required');
  const url = mixedAccessEnvironment(process.env);
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        host: 'localhost',
        port: 5432,
        database: 'reqro_dev',
        user: 'reqro_dev_user',
        password: decodeURIComponent(url.password),
        max: 1,
        connectionTimeoutMillis: 5000,
        statement_timeout: 30000,
        options:
          mode === '--dry-run'
            ? '-c search_path=public -c default_transaction_read_only=on'
            : '-c search_path=public',
        application_name: 'reqro-mixed-access-uat',
      }),
    }),
  });
  try {
    const actual = (
      await sql<{
        database: string;
        role: string;
        port: number;
        address: string;
      }>`select current_database() as database,current_user as role,inet_server_port() as port,host(inet_server_addr()) as address`.execute(
        db,
      )
    ).rows[0];
    if (
      actual?.database !== 'reqro_dev' ||
      actual.role !== 'reqro_dev_user' ||
      actual.port !== 5432 ||
      !['127.0.0.1', '::1'].includes(actual.address)
    )
      throw new Error('Unexpected actual database identity');
    const result = await mixedAccessUat(db, process.env, {
      operation: operation as 'add' | 'cleanup',
      staffId: process.env.F057_FIXTURE_STAFF_ID ?? '',
      permission: process.env.F057_FIXTURE_PERMISSION ?? '',
      expectedRevision: process.env.F057_EXPECTED_REVISION ?? '',
      dryRun: mode === '--dry-run',
    });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    await db.destroy();
  }
}
run().catch(() => {
  process.stderr.write(
    'Mixed-source fixture failed. Verify explicit development selection, revision, manual prerequisite and fixture ownership. No automatic retry.\n',
  );
  process.exitCode = 1;
});

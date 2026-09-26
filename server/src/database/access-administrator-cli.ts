import 'reflect-metadata';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  provisionAccessAdministrator,
  provisionAccessReader,
  type ProvisionOperation,
} from '../access/access-foundation.js';
import type { DatabaseSchema } from './database.types.js';

async function run() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Controlled local access provisioning: bootstrap|add-manager|remove-manager|grant-reader|remove-reader --dry-run|--confirm. Requires NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development; F057_ORGANIZATION_ID, F057_STAFF_ID, F057_EXPECTED_REVISION, F057_EXPECTED_BOOTSTRAP=true|false. Managers require F057_SYNTHETIC_ONLY=true. Readers require that flag OR F057_PERSONAL_READER_UAT=true plus existing personal Entra configuration and a mapped target in that tenant. Load private configuration into the process; never pass credentials in arguments.\n',
    );
    return;
  }
  const [operation, mode] = args;
  if (
    args.length !== 2 ||
    ![
      'bootstrap',
      'add-manager',
      'remove-manager',
      'grant-reader',
      'remove-reader',
    ].includes(operation ?? '') ||
    !['--dry-run', '--confirm'].includes(mode ?? '')
  )
    throw new Error('Explicit operation and mode required');
  const reader = operation === 'grant-reader' || operation === 'remove-reader';
  const personalReader =
    reader && process.env.F057_PERSONAL_READER_UAT === 'true';
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    (!personalReader && process.env.F057_SYNTHETIC_ONLY !== 'true')
  )
    throw new Error('Synthetic development profile required');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    url.hostname !== 'localhost' ||
    (url.port && url.port !== '5432') ||
    url.pathname !== '/reqro_dev' ||
    url.username !== 'reqro_dev_user' ||
    url.search ||
    url.hash
  )
    throw new Error('Approved local database required');
  if (!['true', 'false'].includes(process.env.F057_EXPECTED_BOOTSTRAP ?? ''))
    throw new Error('Expected bootstrap state required');
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url.toString(), max: 1 }),
    }),
  });
  try {
    if (personalReader) {
      if (
        process.env.CITYVUE_ENABLE_EXTERNAL_IDENTITY !== 'true' ||
        !process.env.ENTRA_TENANT_ID ||
        process.env.F036_PERSONAL_ENTRA_TENANT_ID !==
          process.env.ENTRA_TENANT_ID
      )
        throw new Error('Explicit personal tenant selection required');
      const mapped = await db
        .selectFrom('staff_identity')
        .select('id')
        .where('id', '=', process.env.F057_STAFF_ID ?? '')
        .where('organization_id', '=', process.env.F057_ORGANIZATION_ID ?? '')
        .where('entra_tenant_id', '=', process.env.ENTRA_TENANT_ID)
        .where('entra_object_id', 'is not', null)
        .where('active', '=', true)
        .executeTakeFirst();
      if (!mapped) throw new Error('Existing personal identity required');
    }
    const selection = {
      organizationId: process.env.F057_ORGANIZATION_ID ?? '',
      staffId: process.env.F057_STAFF_ID ?? '',
      expectedRevision: process.env.F057_EXPECTED_REVISION ?? '',
      expectedBootstrap: process.env.F057_EXPECTED_BOOTSTRAP === 'true',
      dryRun: mode === '--dry-run',
    };
    const result = reader
      ? await provisionAccessReader(db, {
          ...selection,
          operation,
        })
      : await provisionAccessAdministrator(db, {
          ...selection,
          operation: operation as ProvisionOperation,
        });
    process.stdout.write(JSON.stringify(result) + '\n');
  } finally {
    await db.destroy();
  }
}
run().catch(() => {
  process.stderr.write(
    'Access provisioning failed; verify explicit selection, current revision and retained manager requirements.\n',
  );
  process.exitCode = 1;
});

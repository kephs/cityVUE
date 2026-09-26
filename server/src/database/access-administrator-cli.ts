import {
  personalAccessUatMode,
  assertPersonalAccessTarget,
} from './personal-access-uat.js';
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
      'Controlled local access provisioning: bootstrap|add-manager|remove-manager|grant-reader|remove-reader --dry-run|--confirm. Requires NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development; F057_ORGANIZATION_ID, F057_STAFF_ID, F057_EXPECTED_REVISION, F057_EXPECTED_BOOTSTRAP=true|false. Managers require F057_SYNTHETIC_ONLY=true OR F057_PERSONAL_MANAGER_UAT=true with matching F036 internal target/Organization and personal tenant opt-in. Personal manager bootstrap requires separately reviewed approval; dry-run does not provision. Readers require that flag OR F057_PERSONAL_READER_UAT=true plus existing personal Entra configuration and a mapped target in that tenant. Load private configuration into the process; never pass credentials in arguments.\n',
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
  const personal = personalAccessUatMode(process.env, reader);
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    (!personal && process.env.F057_SYNTHETIC_ONLY !== 'true')
  )
    throw new Error('Synthetic development profile required');
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
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
    if (personal) await assertPersonalAccessTarget(db, process.env);
    const selection = {
      organizationId: process.env.F057_ORGANIZATION_ID ?? '',
      staffId: process.env.F057_STAFF_ID ?? '',
      expectedRevision: process.env.F057_EXPECTED_REVISION ?? '',
      expectedBootstrap: process.env.F057_EXPECTED_BOOTSTRAP === 'true',
      dryRun: mode === '--dry-run',
      ...(personal
        ? { personalTenantId: process.env.ENTRA_TENANT_ID ?? '' }
        : {}),
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

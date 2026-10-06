import 'reflect-metadata';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  deactivateTenantDomain,
  listTenantDomains,
  registerTenantDomain,
} from '../tenancy/tenant-domain.operations.js';
import { isTenantDomainRole } from '../tenancy/tenant-domain.js';
import type { DatabaseSchema } from './database.types.js';

/** ADR-025 Slice 1a tenant-domain operator CLI.
 *
 * Registration, verification, activation, canonical promotion and revocation
 * are platform-operator capabilities, not tenant-administrator ones, and the
 * hostname namespace is global across customers. This command is therefore
 * the only write path, and it is deliberately not reachable over HTTP.
 *
 * `register` always produces an unverified, inactive binding, which cannot
 * resolve. There is no verify or activate operation in this slice: ownership
 * verification is unimplemented, and a hostname must never become servable
 * because an operator typed it.
 */
const USAGE =
  'Controlled local tenant-domain registry: list|register|deactivate --dry-run|--confirm. ' +
  'Requires NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development, ' +
  'TENANT_DOMAIN_OPERATOR_CONFIRM=true and the approved local database. ' +
  'Reads TENANT_DOMAIN_ORGANIZATION_ID, TENANT_DOMAIN_ACTOR, TENANT_DOMAIN_HOSTNAME, ' +
  'TENANT_DOMAIN_ROLE (public_canonical|public_alias|platform_fallback) and ' +
  'TENANT_DOMAIN_EXPECTED_REVISION for deactivate. Registration is always unverified ' +
  'and inactive; no operation in this slice can verify or activate a hostname. ' +
  'Load private configuration into the process; never pass credentials in arguments.\n';

/** The same approved local development database the other operator commands
 * require. A client profile, a production NODE_ENV or any other database is
 * refused, so no production hostname can be created here. */
function approvedLocalDatabase(): URL {
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
  return url;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  const [operation, mode] = args;
  if (!['list', 'register', 'deactivate'].includes(operation ?? ''))
    throw new Error('Explicit operation required');
  if (operation !== 'list' && !['--dry-run', '--confirm'].includes(mode ?? ''))
    throw new Error('Explicit mode required');
  if (
    process.env.NODE_ENV !== 'development' ||
    process.env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    process.env.TENANT_DOMAIN_OPERATOR_CONFIRM !== 'true'
  )
    throw new Error('Explicit development operator profile required');

  const url = approvedLocalDatabase();
  const organizationId = process.env.TENANT_DOMAIN_ORGANIZATION_ID ?? '';
  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({ connectionString: url.toString(), max: 1 }),
    }),
  });
  try {
    if (operation === 'list') {
      process.stdout.write(
        JSON.stringify(await listTenantDomains(db, organizationId)) + '\n',
      );
      return;
    }
    const selection = {
      organizationId,
      actor: process.env.TENANT_DOMAIN_ACTOR ?? '',
      hostname: process.env.TENANT_DOMAIN_HOSTNAME ?? '',
      dryRun: mode === '--dry-run',
    };
    if (operation === 'register') {
      const role = process.env.TENANT_DOMAIN_ROLE;
      if (!isTenantDomainRole(role))
        throw new Error('Explicit domain role required');
      process.stdout.write(
        JSON.stringify(await registerTenantDomain(db, { ...selection, role })) +
          '\n',
      );
      return;
    }
    const expectedRevision = Number(
      process.env.TENANT_DOMAIN_EXPECTED_REVISION,
    );
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1)
      throw new Error('Expected revision required');
    process.stdout.write(
      JSON.stringify(
        await deactivateTenantDomain(db, { ...selection, expectedRevision }),
      ) + '\n',
    );
  } finally {
    await db.destroy();
  }
}

run().catch(() => {
  // Registry state is not echoed on failure: the hostname namespace is global,
  // so a refusal must not reveal another Organization's bindings.
  process.stderr.write(
    'Tenant domain operation failed; verify the development operator gates, the approved local database, the explicit selection and the current revision.\n',
  );
  process.exitCode = 1;
});

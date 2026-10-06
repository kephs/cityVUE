import 'reflect-metadata';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import {
  activateTenantDomain,
  deactivateTenantDomain,
  issueTenantDomainChallenge,
  listTenantDomains,
  registerTenantDomain,
  revokeTenantDomainVerification,
  verifyTenantDomain,
} from '../tenancy/tenant-domain.operations.js';
import { isTenantDomainRole } from '../tenancy/tenant-domain.js';
import {
  DEFAULT_CHALLENGE_LIFETIME_DAYS,
  MAXIMUM_CHALLENGE_LIFETIME_DAYS,
} from '../tenancy/tenant-domain-challenge.js';
import { nodeDnsPort } from '../tenancy/tenant-domain-verifier.js';
import type { DatabaseSchema } from './database.types.js';

/** ADR-025 tenant-domain operator CLI.
 *
 * Registration, verification, activation, canonical promotion and revocation
 * are platform-operator capabilities, not tenant-administrator ones, and the
 * hostname namespace is global across customers. This command is therefore
 * the only write path, and it is deliberately not reachable over HTTP.
 *
 * Verification and activation stay separate: a successful DNS check never
 * activates a hostname, and `activate` refuses anything not already verified.
 */
const OPERATIONS = [
  'list',
  'register',
  'issue-challenge',
  'verify',
  'activate',
  'deactivate',
  'revoke',
] as const;

const USAGE =
  'Controlled local tenant-domain registry: ' +
  OPERATIONS.join('|') +
  ' --dry-run|--confirm. ' +
  'Requires NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development, ' +
  'TENANT_DOMAIN_OPERATOR_CONFIRM=true and the approved local database. ' +
  'Reads TENANT_DOMAIN_ORGANIZATION_ID, TENANT_DOMAIN_ACTOR, TENANT_DOMAIN_HOSTNAME, ' +
  'TENANT_DOMAIN_ROLE (public_canonical|public_alias|platform_fallback) for register, ' +
  'TENANT_DOMAIN_EXPECTED_REVISION for every change, ' +
  `TENANT_DOMAIN_CHALLENGE_LIFETIME_DAYS (1-${String(MAXIMUM_CHALLENGE_LIFETIME_DAYS)}, default ${String(DEFAULT_CHALLENGE_LIFETIME_DAYS)}) for issue-challenge, and ` +
  'TENANT_DOMAIN_CORRELATION_ID plus optional TENANT_DOMAIN_DNS_TIMEOUT_MS/TENANT_DOMAIN_DNS_TRIES for verify. ' +
  'Registration is always unverified and inactive; verification never activates; ' +
  'activate requires a verified binding; revoke requires prior deactivation. ' +
  'Load private configuration into the process; never pass credentials in arguments.\n';

/** The same approved local development database the other operator commands
 * require. A client profile, a production NODE_ENV or any other database is
 * refused, so no production hostname can be created or verified here. */
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

function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new Error(
      `${label} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  return value;
}

function requiredRevision(): number {
  const value = Number(process.env.TENANT_DOMAIN_EXPECTED_REVISION);
  if (!Number.isInteger(value) || value < 1)
    throw new Error('Expected revision required');
  return value;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  const [operation, mode] = args;
  if (!(OPERATIONS as readonly string[]).includes(operation ?? ''))
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
  const write = (value: unknown) =>
    process.stdout.write(JSON.stringify(value) + '\n');
  try {
    if (operation === 'list') {
      write(await listTenantDomains(db, organizationId));
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
      write(await registerTenantDomain(db, { ...selection, role }));
      return;
    }
    const transition = { ...selection, expectedRevision: requiredRevision() };
    if (operation === 'issue-challenge') {
      write(
        await issueTenantDomainChallenge(db, {
          ...transition,
          lifetimeDays: boundedInteger(
            process.env.TENANT_DOMAIN_CHALLENGE_LIFETIME_DAYS,
            DEFAULT_CHALLENGE_LIFETIME_DAYS,
            1,
            MAXIMUM_CHALLENGE_LIFETIME_DAYS,
            'Challenge lifetime',
          ),
        }),
      );
      return;
    }
    if (operation === 'verify') {
      const dns = nodeDnsPort({
        timeoutMs: boundedInteger(
          process.env.TENANT_DOMAIN_DNS_TIMEOUT_MS,
          3000,
          100,
          30000,
          'DNS timeout',
        ),
        tries: boundedInteger(
          process.env.TENANT_DOMAIN_DNS_TRIES,
          2,
          1,
          5,
          'DNS tries',
        ),
      });
      write(
        await verifyTenantDomain(db, dns, {
          ...transition,
          correlationId: process.env.TENANT_DOMAIN_CORRELATION_ID ?? '',
        }),
      );
      return;
    }
    if (operation === 'activate') {
      write(await activateTenantDomain(db, transition));
      return;
    }
    if (operation === 'deactivate') {
      write(await deactivateTenantDomain(db, transition));
      return;
    }
    write(await revokeTenantDomainVerification(db, transition));
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

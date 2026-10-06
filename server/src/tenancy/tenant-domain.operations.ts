import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  isTenantDomainRole,
  type TenantDomainRole,
  type TenantDomainVerificationState,
} from './tenant-domain.js';
import { normalizeHostname } from './tenant-hostname.js';

/** ADR-025 Slice 1a operator registry operations.
 *
 * These are the only application paths that write the tenant-domain registry,
 * and they are reachable solely from the guarded operator CLI — never from an
 * HTTP or Admin API, because the hostname namespace is global across
 * customers and is not a tenant-administrator capability.
 *
 * Deliberately absent: any operation that verifies or activates a binding.
 * Registration always produces an unverified, inactive binding, which cannot
 * resolve. Ownership verification is not implemented in this slice, so there
 * is no code path — gated, flagged or otherwise — by which an operator makes
 * a hostname servable by typing it.
 */
export interface TenantDomainSelection {
  readonly organizationId: string;
  readonly actor: string;
  readonly dryRun: boolean;
}

export interface TenantDomainRegistration extends TenantDomainSelection {
  readonly hostname: string;
  readonly role: TenantDomainRole;
}

export interface TenantDomainDeactivation extends TenantDomainSelection {
  readonly hostname: string;
  readonly expectedRevision: number;
}

export interface TenantDomainRecord {
  readonly id: string;
  readonly hostname: string;
  readonly role: TenantDomainRole;
  readonly verificationState: TenantDomainVerificationState;
  readonly active: boolean;
  readonly revision: number;
  readonly resolvable: boolean;
}

export interface TenantDomainOutcome {
  readonly operation: 'register' | 'deactivate';
  readonly applied: boolean;
  readonly organizationId: string;
  readonly domain: TenantDomainRecord;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A deliberately plain error: operator tooling reports the reason, the
 * resident request path never reaches this module. */
export class TenantDomainOperationError extends Error {}

/** Carries a validated outcome out of a transaction that is then rolled back,
 * so a dry run exercises every check — including the deferred audit-evidence
 * constraint — without leaving a row behind. */
class DryRunRollback extends Error {
  constructor(readonly outcome: TenantDomainOutcome) {
    super('dry run');
  }
}

function fail(message: string): never {
  throw new TenantDomainOperationError(message);
}

/** Validates the whole transaction now rather than at commit, then discards
 * it, so `--dry-run` proves the write would have been accepted. */
async function settle(
  trx: Kysely<DatabaseSchema>,
  outcome: TenantDomainOutcome,
  dryRun: boolean,
): Promise<TenantDomainOutcome> {
  await sql`set constraints all immediate`.execute(trx);
  if (dryRun) throw new DryRunRollback({ ...outcome, applied: false });
  return outcome;
}

async function run(
  attempt: () => Promise<TenantDomainOutcome>,
): Promise<TenantDomainOutcome> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof DryRunRollback) return error.outcome;
    throw error;
  }
}

function requireOrganizationId(value: string): string {
  if (!UUID_PATTERN.test(value))
    fail('An explicit Organization UUID is required');
  return value.toLowerCase();
}

function requireActor(value: string): string {
  const actor = value.trim();
  if (actor.length === 0 || actor.length > 200)
    fail('An explicit operator actor reference is required');
  return actor;
}

function requireCanonicalHostname(value: string): string {
  const normalized = normalizeHostname(value);
  if (!normalized.ok)
    fail(`Hostname rejected by normalization: ${normalized.reason}`);
  return normalized.hostname;
}

function project(row: {
  id: string;
  hostname: string;
  role: TenantDomainRole;
  verification_state: TenantDomainVerificationState;
  active: boolean;
  revision: number;
}): TenantDomainRecord {
  return {
    id: row.id,
    hostname: row.hostname,
    role: row.role,
    verificationState: row.verification_state,
    active: row.active,
    revision: row.revision,
    // Mirrors the resolver's own precondition, so operator output never
    // suggests a binding is servable when it is not.
    resolvable: row.active && row.verification_state === 'verified',
  };
}

/** Read-only registry inspection for one Organization. */
export async function listTenantDomains(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
): Promise<TenantDomainRecord[]> {
  const rows = await db
    .selectFrom('tenant_domain')
    .select([
      'id',
      'hostname',
      'role',
      'verification_state',
      'active',
      'revision',
    ])
    .where('organization_id', '=', requireOrganizationId(organizationId))
    .orderBy('hostname')
    .execute();
  return rows.map(project);
}

/**
 * Registers an unverified, inactive binding.
 *
 * The hostname is canonicalized before anything else, so the registry stores
 * exactly what the resolver will look up. A dry run performs every check and
 * then rolls back, so an operator can see the refusal without writing.
 */
export async function registerTenantDomain(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainRegistration,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const actor = requireActor(input.actor);
  const hostname = requireCanonicalHostname(input.hostname);
  if (!isTenantDomainRole(input.role))
    fail('An explicit domain role is required');
  const role = input.role;

  return run(() =>
    db.transaction().execute(async (trx) => {
      const organization = await trx
        .selectFrom('organization')
        .select(['id', 'status'])
        .where('id', '=', organizationId)
        .forShare()
        .executeTakeFirst();
      if (!organization) fail('Organization not found');
      if (organization.status !== 'active') fail('Organization is not active');

      // The hostname namespace is global, so a clash with another Organization
      // is reported as a clash without naming the holder.
      const existing = await trx
        .selectFrom('tenant_domain')
        .select('id')
        .where('hostname', '=', hostname)
        .executeTakeFirst();
      if (existing) fail('Hostname is already registered');

      if (role === 'public_canonical') {
        const canonical = await trx
          .selectFrom('tenant_domain')
          .select('id')
          .where('organization_id', '=', organizationId)
          .where('role', '=', 'public_canonical')
          .executeTakeFirst();
        if (canonical)
          fail('Organization already holds a public canonical hostname');
      }

      const created = await trx
        .insertInto('tenant_domain')
        .values({ organization_id: organizationId, hostname, role })
        .returning([
          'id',
          'hostname',
          'role',
          'verification_state',
          'active',
          'revision',
        ])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tenant_domain_audit')
        .values({
          organization_id: organizationId,
          tenant_domain_id: created.id,
          hostname: created.hostname,
          action: 'registered',
          actor,
          prior_revision: null,
          revision: created.revision,
          prior_role: null,
          role: created.role,
          prior_verification_state: null,
          verification_state: created.verification_state,
          prior_active: null,
          active: created.active,
          evidence: null,
        })
        .execute();

      return settle(
        trx,
        {
          operation: 'register',
          applied: true,
          organizationId,
          domain: project(created),
        },
        input.dryRun,
      );
    }),
  );
}

/**
 * Deactivates a binding. Always available and never widening: it can only
 * remove a hostname from resolution, so it is the operator's safe reaction to
 * a domain a customer no longer controls.
 */
export async function deactivateTenantDomain(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainDeactivation,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const actor = requireActor(input.actor);
  const hostname = requireCanonicalHostname(input.hostname);

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await trx
        .selectFrom('tenant_domain')
        .select([
          'id',
          'hostname',
          'role',
          'verification_state',
          'active',
          'revision',
        ])
        .where('organization_id', '=', organizationId)
        .where('hostname', '=', hostname)
        .forUpdate()
        .executeTakeFirst();
      if (!binding) fail('Tenant domain not found for this Organization');
      if (binding.revision !== input.expectedRevision)
        fail('Tenant domain revision has moved; re-read before deactivating');
      if (!binding.active) fail('Tenant domain is already inactive');

      const updated = await trx
        .updateTable('tenant_domain')
        .set({ active: false, revision: binding.revision + 1 })
        .where('organization_id', '=', organizationId)
        .where('id', '=', binding.id)
        .where('revision', '=', binding.revision)
        .returning([
          'id',
          'hostname',
          'role',
          'verification_state',
          'active',
          'revision',
        ])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tenant_domain_audit')
        .values({
          organization_id: organizationId,
          tenant_domain_id: updated.id,
          hostname: updated.hostname,
          action: 'deactivated',
          actor,
          prior_revision: binding.revision,
          revision: updated.revision,
          prior_role: binding.role,
          role: updated.role,
          prior_verification_state: binding.verification_state,
          verification_state: updated.verification_state,
          prior_active: binding.active,
          active: updated.active,
          evidence: null,
        })
        .execute();

      return settle(
        trx,
        {
          operation: 'deactivate',
          applied: true,
          organizationId,
          domain: project(updated),
        },
        input.dryRun,
      );
    }),
  );
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  isTenantDomainRole,
  type TenantDomainRole,
  type TenantDomainVerificationState,
} from './tenant-domain.js';
import { normalizeHostname } from './tenant-hostname.js';
import {
  challengeExpiry,
  challengeHash,
  issueChallenge,
  verificationRecordName,
} from './tenant-domain-challenge.js';
import {
  observeVerification,
  type DnsPort,
  type VerificationResult,
} from './tenant-domain-verifier.js';

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

/** Shared by every operation that acts on an existing binding. The expected
 * revision is mandatory: an operator always states the state they believe
 * they are acting on, so a concurrent change fails rather than silently
 * applying to a binding that has moved. */
export interface TenantDomainTransition extends TenantDomainSelection {
  readonly hostname: string;
  readonly expectedRevision: number;
}

export interface TenantDomainChallengeIssue extends TenantDomainTransition {
  readonly lifetimeDays: number;
}

export interface TenantDomainVerification extends TenantDomainTransition {
  readonly correlationId: string;
}

/** Returned by `issue-challenge` so the operator can give the customer the
 * exact record to publish. The value is public by design. */
export interface IssuedChallengeInstruction {
  readonly recordName: string;
  readonly recordType: 'TXT';
  readonly value: string;
  readonly expiresAt: string;
}

/** Returned by `verify`, whether or not the attempt succeeded. A failed
 * attempt is a recorded fact, not an exception. */
export interface VerificationOutcome extends TenantDomainOutcome {
  readonly operation: 'verify';
  readonly verified: boolean;
  readonly result: VerificationResult;
  readonly recordName: string;
  readonly agreementCount: number;
  readonly degradedSingleNs: boolean;
  readonly nameServers: readonly string[];
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
  readonly operation:
    | 'register'
    | 'deactivate'
    | 'issue-challenge'
    | 'verify'
    | 'activate'
    | 'revoke';
  readonly applied: boolean;
  readonly organizationId: string;
  readonly domain: TenantDomainRecord;
  readonly challenge?: IssuedChallengeInstruction;
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

const BINDING_COLUMNS = [
  'id',
  'hostname',
  'role',
  'verification_state',
  'active',
  'revision',
] as const;

/** Re-reads a binding under a row lock and confirms the operator acted on the
 * state they claimed. Every transition below goes through this. */
async function lockBinding(
  trx: Kysely<DatabaseSchema>,
  organizationId: string,
  hostname: string,
  expectedRevision: number,
) {
  const binding = await trx
    .selectFrom('tenant_domain')
    .select([
      ...BINDING_COLUMNS,
      'verification_token_id',
      'verification_challenge',
      'verification_expires_at',
    ])
    .where('organization_id', '=', organizationId)
    .where('hostname', '=', hostname)
    .forUpdate()
    .executeTakeFirst();
  if (!binding) fail('Tenant domain not found for this Organization');
  if (binding.revision !== expectedRevision)
    fail('Tenant domain revision has moved; re-read before acting');
  return binding;
}

function requireCorrelationId(value: string): string {
  if (!UUID_PATTERN.test(value))
    fail('An explicit correlation UUID is required');
  return value.toLowerCase();
}

/**
 * Issues a DNS ownership challenge, moving the binding to `pending`.
 *
 * Issuing again before verification replaces the token, so the previous
 * challenge stops working the moment this commits. The database re-anchors
 * the request instant to its own clock and independently bounds the window,
 * so an operator cannot backdate or widen it.
 */
export async function issueTenantDomainChallenge(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainChallengeIssue,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const actor = requireActor(input.actor);
  const hostname = requireCanonicalHostname(input.hostname);
  const recordName = verificationRecordName(hostname);
  if (!recordName) fail('Hostname is too long to carry a verification record');

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await lockBinding(
        trx,
        organizationId,
        hostname,
        input.expectedRevision,
      );
      if (binding.verification_state === 'verified')
        fail('Tenant domain is already verified; revoke before re-challenging');

      const issued = issueChallenge();
      const expiresAt = challengeExpiry(new Date(), input.lifetimeDays);
      const updated = await trx
        .updateTable('tenant_domain')
        .set({
          verification_state: 'pending',
          verification_method: 'dns_txt',
          verification_challenge: issued.value,
          verification_token_id: issued.tokenId,
          verification_expires_at: expiresAt,
          verification_evidence: null,
          revision: binding.revision + 1,
        })
        .where('organization_id', '=', organizationId)
        .where('id', '=', binding.id)
        .where('revision', '=', binding.revision)
        .returning([...BINDING_COLUMNS])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tenant_domain_audit')
        .values({
          organization_id: organizationId,
          tenant_domain_id: updated.id,
          hostname: updated.hostname,
          action: 'verification_requested',
          actor,
          prior_revision: binding.revision,
          revision: updated.revision,
          prior_role: binding.role,
          role: updated.role,
          prior_verification_state: binding.verification_state,
          verification_state: updated.verification_state,
          prior_active: binding.active,
          active: updated.active,
          // The challenge value is public DNS content; the hash is what ties
          // later attempt evidence back to this issuance.
          evidence: {
            tokenId: issued.tokenId,
            recordName,
            challengeHash: challengeHash(issued.value),
            policyVersion: 1,
          },
        })
        .execute();

      return settle(
        trx,
        {
          operation: 'issue-challenge',
          applied: true,
          organizationId,
          domain: project(updated),
          challenge: {
            recordName,
            recordType: 'TXT',
            value: issued.value,
            expiresAt: expiresAt.toISOString(),
          },
        },
        input.dryRun,
      );
    }),
  );
}

/**
 * Performs the DNS lookup and records the attempt.
 *
 * The network call happens **outside** the transaction, so a slow or hostile
 * name server cannot hold a row lock. The binding is then re-read under lock
 * and its token re-checked, so an observation made against a challenge that
 * was replaced mid-flight can never be applied.
 *
 * A failed attempt is still recorded and changes no registry state: no
 * revision bump, no audit row, and nothing becomes resolvable.
 */
export async function verifyTenantDomain(
  db: Kysely<DatabaseSchema>,
  dns: DnsPort,
  input: TenantDomainVerification,
): Promise<VerificationOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const actor = requireActor(input.actor);
  const hostname = requireCanonicalHostname(input.hostname);
  const correlationId = requireCorrelationId(input.correlationId);
  const recordName = verificationRecordName(hostname);
  if (!recordName) fail('Hostname is too long to carry a verification record');

  const prepared = await db
    .selectFrom('tenant_domain')
    .select([
      ...BINDING_COLUMNS,
      'verification_challenge',
      'verification_token_id',
    ])
    .where('organization_id', '=', organizationId)
    .where('hostname', '=', hostname)
    .executeTakeFirst();
  if (!prepared) fail('Tenant domain not found for this Organization');
  if (prepared.revision !== input.expectedRevision)
    fail('Tenant domain revision has moved; re-read before acting');
  if (prepared.verification_state !== 'pending')
    fail('Tenant domain has no live challenge to verify');
  const expectedValue = prepared.verification_challenge;
  const tokenId = prepared.verification_token_id;
  if (!expectedValue || !tokenId) fail('Tenant domain challenge is incomplete');

  const observation = await observeVerification(dns, {
    recordName,
    expectedValue,
  });

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await lockBinding(
        trx,
        organizationId,
        hostname,
        input.expectedRevision,
      );
      if (binding.verification_token_id !== tokenId)
        fail('Challenge was replaced while verifying; re-read and retry');

      // The database independently refuses an expired challenge; this only
      // turns that into an honest recorded result instead of an exception.
      const expiry = binding.verification_expires_at;
      const expired = expiry !== null && new Date(expiry) <= new Date();
      const result: VerificationResult =
        expired && observation.result === 'verified'
          ? 'challenge_expired'
          : observation.result;
      const succeeded = result === 'verified';

      await trx
        .insertInto('tenant_domain_verification_attempt')
        .values({
          organization_id: organizationId,
          tenant_domain_id: binding.id,
          hostname: binding.hostname,
          record_name: observation.recordName,
          token_id: tokenId,
          // The revision the observation was actually made against, which is
          // the pending revision in both outcomes: a success transitions away
          // from it afterwards, and the attempt is recorded first.
          binding_revision: binding.revision,
          expected_challenge_hash: observation.expectedChallengeHash,
          observed_value_hash: succeeded ? observation.observedValueHash : null,
          observed_value_count: observation.observedValueCount,
          result,
          resolver_mode: 'authoritative',
          name_servers: [...observation.nameServers],
          agreement_count: observation.agreementCount,
          degraded_single_ns: observation.degradedSingleNs,
          ttl_seconds: observation.ttlSeconds,
          dnssec: observation.dnssec,
          actor,
          correlation_id: correlationId,
          policy_version: 1,
        })
        .execute();

      let domain = project(binding);
      if (succeeded) {
        const updated = await trx
          .updateTable('tenant_domain')
          .set({
            verification_state: 'verified',
            verification_evidence: {
              tokenId,
              recordName: observation.recordName,
              challengeHash: observation.expectedChallengeHash,
              observedValueHash: observation.observedValueHash,
              observedValueCount: observation.observedValueCount,
              resolverMode: 'authoritative',
              nameServers: observation.nameServers,
              agreementCount: observation.agreementCount,
              degradedSingleNs: observation.degradedSingleNs,
              ttlSeconds: observation.ttlSeconds,
              dnssec: observation.dnssec,
              correlationId,
              policyVersion: 1,
            },
            revision: binding.revision + 1,
          })
          .where('organization_id', '=', organizationId)
          .where('id', '=', binding.id)
          .where('revision', '=', binding.revision)
          .returning([...BINDING_COLUMNS])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto('tenant_domain_audit')
          .values({
            organization_id: organizationId,
            tenant_domain_id: updated.id,
            hostname: updated.hostname,
            action: 'verified',
            actor,
            prior_revision: binding.revision,
            revision: updated.revision,
            prior_role: binding.role,
            role: updated.role,
            prior_verification_state: binding.verification_state,
            verification_state: updated.verification_state,
            prior_active: binding.active,
            active: updated.active,
            evidence: { correlationId, tokenId, policyVersion: 1 },
          })
          .execute();
        domain = project(updated);
      }

      // Verification never activates. A verified binding stays inactive until
      // a separate, separately attributed operator decision.
      const outcome: VerificationOutcome = {
        operation: 'verify',
        applied: succeeded,
        organizationId,
        domain,
        verified: succeeded,
        result,
        recordName: observation.recordName,
        agreementCount: observation.agreementCount,
        degradedSingleNs: observation.degradedSingleNs,
        nameServers: observation.nameServers,
      };
      await settle(trx, outcome, input.dryRun);
      return outcome;
    }),
  ) as Promise<VerificationOutcome>;
}

/**
 * Activates a verified binding. This is the step that makes a hostname
 * resolvable, so it is deliberately separate from verification and carries
 * its own actor and audit action.
 */
export async function activateTenantDomain(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainTransition,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const actor = requireActor(input.actor);
  const hostname = requireCanonicalHostname(input.hostname);

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await lockBinding(
        trx,
        organizationId,
        hostname,
        input.expectedRevision,
      );
      if (binding.verification_state !== 'verified')
        fail('Only a verified tenant domain can be activated');
      if (binding.active) fail('Tenant domain is already active');

      const updated = await trx
        .updateTable('tenant_domain')
        .set({ active: true, revision: binding.revision + 1 })
        .where('organization_id', '=', organizationId)
        .where('id', '=', binding.id)
        .where('revision', '=', binding.revision)
        .returning([...BINDING_COLUMNS])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tenant_domain_audit')
        .values({
          organization_id: organizationId,
          tenant_domain_id: updated.id,
          hostname: updated.hostname,
          action: 'activated',
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
          operation: 'activate',
          applied: true,
          organizationId,
          domain: project(updated),
        },
        input.dryRun,
      );
    }),
  );
}

/**
 * Revokes verification, returning the binding to `unverified` and clearing
 * the challenge.
 *
 * An active hostname must be deactivated first. Combining the two would let
 * one command take a resident surface offline as a side effect of an
 * ownership decision; keeping them apart forces the availability choice to be
 * made and attributed on its own.
 */
export async function revokeTenantDomainVerification(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainTransition,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const actor = requireActor(input.actor);
  const hostname = requireCanonicalHostname(input.hostname);

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await lockBinding(
        trx,
        organizationId,
        hostname,
        input.expectedRevision,
      );
      if (binding.active)
        fail('Deactivate the tenant domain before revoking verification');
      if (binding.verification_state === 'unverified')
        fail('Tenant domain has no verification to revoke');

      const updated = await trx
        .updateTable('tenant_domain')
        .set({
          verification_state: 'unverified',
          verification_method: null,
          verification_challenge: null,
          verification_token_id: null,
          verification_requested_at: null,
          verification_expires_at: null,
          verified_at: null,
          verification_evidence: null,
          revision: binding.revision + 1,
        })
        .where('organization_id', '=', organizationId)
        .where('id', '=', binding.id)
        .where('revision', '=', binding.revision)
        .returning([...BINDING_COLUMNS])
        .executeTakeFirstOrThrow();

      await trx
        .insertInto('tenant_domain_audit')
        .values({
          organization_id: organizationId,
          tenant_domain_id: updated.id,
          hostname: updated.hostname,
          action: 'verification_revoked',
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
          operation: 'revoke',
          applied: true,
          organizationId,
          domain: project(updated),
        },
        input.dryRun,
      );
    }),
  );
}

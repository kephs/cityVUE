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

/** ADR-025 / ADR-027 operator registry operations.
 *
 * These are the only application paths that write the tenant-domain registry,
 * and they are reachable solely from the guarded operator CLI — never from an
 * HTTP or Admin API, because the hostname namespace is global across
 * customers and is not a tenant-administrator capability.
 *
 * Every mutation carries version-2 structured attribution, and the two
 * operations that change what the public can reach — activation and
 * revocation — additionally require an independent approval. Registration
 * always produces an unverified, inactive binding; verification never
 * activates; activation refuses anything not already verified. There is no
 * code path, gated or flagged, by which one operator makes a hostname
 * servable by typing it.
 *
 * Deliberately absent: Organization status transitions, any production
 * operator entry point, and any access to resident, service-request,
 * attachment or tracking data. This module reads Organization identity and
 * status, the registry, verification evidence and operator attribution, and
 * nothing else.
 */
/** ADR-027 F060.3C-2a structured operator attribution.
 *
 * This is attribution, not authentication. Platform authority stays
 * infrastructure-rooted: these values record which infrastructure-issued
 * human performed a mutation, why, and under which correlation. Nothing here
 * grants anything, and an operator identity is never a tenant staff identity.
 */
export interface OperatorAttribution {
  readonly operatorIdentity: string;
  readonly reason: string;
  readonly correlationId: string;
}

export interface TenantDomainSelection {
  readonly organizationId: string;
  readonly attribution: OperatorAttribution;
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

/** The two operations that change what the public can reach additionally
 * require an independent approval recorded earlier by a different operator.
 * The identifier is mandatory on this input and absent from every other input
 * type, so an approval can neither be omitted here nor attached to a lesser
 * operation. */
export interface TenantDomainApprovedTransition extends TenantDomainTransition {
  readonly approvalId: string;
}

export type TenantDomainApprovableOperation =
  'activated' | 'verification_revoked';

export const tenantDomainApprovableOperations: readonly TenantDomainApprovableOperation[] =
  ['activated', 'verification_revoked'];

/** Records an independent approval. The approver states only the revision
 * they reviewed; the rest of the context is copied from the committed binding
 * and re-checked by the database, so an approval can never describe a state
 * the binding was not actually in. */
export interface TenantDomainApprovalRequest {
  readonly organizationId: string;
  readonly hostname: string;
  readonly expectedRevision: number;
  readonly operation: TenantDomainApprovableOperation;
  readonly requestedBy: string;
  readonly approvedBy: string;
  readonly reason: string;
  readonly correlationId: string;
}

export interface TenantDomainApproval {
  readonly id: string;
  readonly organizationId: string;
  readonly hostname: string;
  readonly operation: TenantDomainApprovableOperation;
  readonly expectedRevision: number;
  readonly expiresAt: string;
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

/** Mirrors the database grammar. The scheme prefix is mandatory, so an
 * operator identity can never be a bare UUID and is never mistakable for a
 * `staff_identity`; `dev:` marks synthetic development evidence as such. */
const OPERATOR_IDENTITY_PATTERN =
  /^(?:iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$/;

/** A long unbroken alphanumeric run is what a secret looks like. Refused in
 * application code as well as in the database, so operator tooling never
 * carries a pasted token as far as an audit row. */
const SECRET_SHAPED_VALUE = /[A-Za-z0-9]{32,}/;

function requireOperatorIdentity(value: string): string {
  const identity = value.trim();
  if (!OPERATOR_IDENTITY_PATTERN.test(identity))
    fail(
      'An infrastructure operator identity of the form iam:, oidc: or dev: is required',
    );
  if (SECRET_SHAPED_VALUE.test(identity))
    fail('Operator identity must not contain a secret-shaped value');
  return identity;
}

function requireReason(value: string): string {
  const reason = value.trim();
  if (reason.length < 12 || reason.length > 500)
    fail('An operator reason of 12 to 500 characters is required');
  if (/\p{Cc}/u.test(reason))
    fail('Operator reason must not contain control characters');
  return reason;
}

/** The version-2 attribution every new audit row must carry. There is no
 * code path that writes a legacy version-1 row. */
function requireAttribution(input: OperatorAttribution): {
  readonly attribution_version: number;
  readonly operator_identity: string;
  readonly reason: string;
  readonly correlation_id: string;
  readonly outcome: 'applied';
} {
  return {
    attribution_version: 2,
    operator_identity: requireOperatorIdentity(input.operatorIdentity),
    reason: requireReason(input.reason),
    correlation_id: requireCorrelationId(input.correlationId),
    outcome: 'applied',
  };
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
 * Reads exactly one binding the caller has already named.
 *
 * This exists for the pre-approval plan an operator produces so a second
 * operator can review the exact context before approving. It is deliberately
 * not a listing: the Organization and the hostname must both be supplied, so
 * it cannot discover a hostname the caller did not already hold, and it
 * returns only that binding's registry state.
 */
export async function inspectTenantDomain(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  hostname: string,
): Promise<TenantDomainRecord> {
  const row = await db
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
    .where('hostname', '=', requireCanonicalHostname(hostname))
    .executeTakeFirst();
  if (!row) fail('Tenant domain not found for this Organization');
  return project(row);
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
  const attribution = requireAttribution(input.attribution);
  const hostname = requireCanonicalHostname(input.hostname);
  if (!isTenantDomainRole(input.role))
    fail('An explicit domain role is required');
  const role = input.role;

  return run(() =>
    db.transaction().execute(async (trx) => {
      // Organization first, then the registry. Registration requires an
      // active Organization, as it always has; the direct read it replaces
      // needed UPDATE privilege on the table because of the row lock, which
      // the operator role must never hold.
      await lockOrganization(trx, organizationId, 'active');

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
          actor: attribution.operator_identity,
          ...attribution,
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
  const attribution = requireAttribution(input.attribution);
  const hostname = requireCanonicalHostname(input.hostname);

  return run(() =>
    db.transaction().execute(async (trx) => {
      // Organization first, for lock order only. Deactivation is the safe
      // direction and must stay available when an Organization is no longer
      // active — that is exactly when an operator is most likely to need it.
      await lockOrganization(trx, organizationId, 'lock_only');
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
          actor: attribution.operator_identity,
          ...attribution,
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

/**
 * ADR-027 F060.3C-2c-2. Whether a non-active Organization is fatal depends on
 * the direction of the operation.
 *
 * `active` is required by anything that can make a hostname publicly
 * reachable. `lock_only` takes the same row lock but tolerates a non-active
 * Organization, so a safe-direction operation — deactivating a hostname,
 * revoking ownership evidence — does not become impossible precisely when it
 * is most likely to be needed.
 */
type OrganizationRequirement = 'active' | 'lock_only';

/**
 * Takes the Organization row lock through the hardened Migration 48 helper.
 *
 * The operator path holds **no privilege on `organization`**: the lock and the
 * status read happen inside a `SECURITY DEFINER` function owned by the schema
 * owner, which returns only a boolean. Row locks are transaction scoped, so
 * the lock acquired inside that function is held by this transaction until
 * commit — the concurrency guarantee is preserved, not relocated.
 */
async function lockOrganization(
  trx: Kysely<DatabaseSchema>,
  organizationId: string,
  requirement: OrganizationRequirement,
): Promise<void> {
  // The call is intentionally unqualified, while the helper's own body and
  // every hardened guard are fully schema qualified. PostgreSQL never searches
  // `pg_temp` for function or operator names, so a temporary object cannot
  // hijack this call; the shadowing risk is for relations and composite types,
  // which is exactly what the qualified function bodies close. Hard-coding a
  // schema here would instead bind the application to one deployment layout.
  // The residual risk — a same-named function in an earlier writable schema —
  // is closed by the operator role holding no CREATE on any searchable schema,
  // which F060.3C-2c-3 must provision.
  const locked = await sql<{ servable: boolean }>`
    select tenant_domain_lock_organization(${organizationId}::uuid) as servable`.execute(
    trx,
  );
  if (requirement === 'active' && locked.rows[0]?.servable !== true)
    fail('Organization is not an active servable target');
}

/** Re-reads a binding under a row lock and confirms the operator acted on the
 * state they claimed. Every transition below goes through this.
 *
 * The Organization lock is taken **first**, so every supported operator path
 * acquires locks in the order Organization then tenant_domain. The previous
 * order was inconsistent — registration locked the Organization first while
 * every transition locked the binding first and reached the Organization only
 * inside the trigger — which would become a genuine deadlock window as soon
 * as anything takes the Organization row `FOR UPDATE`, as a future
 * Organization lifecycle writer would. */
async function lockBinding(
  trx: Kysely<DatabaseSchema>,
  organizationId: string,
  hostname: string,
  expectedRevision: number,
  requirement: OrganizationRequirement,
) {
  await lockOrganization(trx, organizationId, requirement);
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

function requireApprovalId(value: string): string {
  if (!UUID_PATTERN.test(value))
    fail('An explicit independent approval UUID is required');
  return value.toLowerCase();
}

/**
 * Records an independent approval for activation or revocation.
 *
 * The approver names only the revision they reviewed. Everything else is
 * copied from the committed binding under a row lock and re-checked by the
 * database, so an approval cannot describe a state the binding was never in.
 * The approval's lifetime is assigned by the database from its own clock, so
 * no caller can backdate or extend it, and it is immutable once written.
 *
 * This records a decision; it grants nothing. Separation of duties is
 * enforced twice — here, because an approval naming one identity for both
 * roles is refused, and again at consumption, because the operator applying
 * the change must be the named requester and must not be the approver.
 */
export async function recordTenantDomainApproval(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainApprovalRequest,
): Promise<TenantDomainApproval> {
  const organizationId = requireOrganizationId(input.organizationId);
  const hostname = requireCanonicalHostname(input.hostname);
  const requestedBy = requireOperatorIdentity(input.requestedBy);
  const approvedBy = requireOperatorIdentity(input.approvedBy);
  const reason = requireReason(input.reason);
  const correlationId = requireCorrelationId(input.correlationId);
  if (
    !(tenantDomainApprovableOperations as readonly string[]).includes(
      input.operation,
    )
  )
    fail('Only activation and revocation take an independent approval');
  if (requestedBy === approvedBy)
    fail('An approval requires a different approver than the operator');

  return db.transaction().execute(async (trx) => {
    const binding = await lockBinding(
      trx,
      organizationId,
      hostname,
      input.expectedRevision,
      'active',
    );
    // Reported here so the approver sees why their decision is meaningless
    // rather than reading a database refusal; the database checks the same
    // preconditions independently.
    if (binding.active)
      fail('Deactivate the tenant domain before approving this operation');
    if (input.operation === 'activated') {
      if (binding.verification_state !== 'verified')
        fail('Only a verified tenant domain can be approved for activation');
    } else if (binding.verification_state === 'unverified')
      fail('Tenant domain has no verification to approve revoking');

    const created = await trx
      .insertInto('tenant_domain_operator_approval')
      .values({
        organization_id: organizationId,
        tenant_domain_id: binding.id,
        operation: input.operation,
        expected_revision: binding.revision,
        expected_hostname: binding.hostname,
        expected_role: binding.role,
        expected_verification_state: binding.verification_state,
        expected_active: binding.active,
        requested_by: requestedBy,
        approved_by: approvedBy,
        reason,
        correlation_id: correlationId,
        policy_version: 1,
      })
      .returning(['id', 'expires_at'])
      .executeTakeFirstOrThrow();

    return {
      id: created.id,
      organizationId,
      hostname: binding.hostname,
      operation: input.operation,
      expectedRevision: binding.revision,
      expiresAt: created.expires_at.toISOString(),
    };
  });
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
  const attribution = requireAttribution(input.attribution);
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
        'lock_only',
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
          actor: attribution.operator_identity,
          ...attribution,
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
  input: TenantDomainTransition,
): Promise<VerificationOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const attribution = requireAttribution(input.attribution);
  const hostname = requireCanonicalHostname(input.hostname);
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
        'lock_only',
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
          actor: attribution.operator_identity,
          correlation_id: attribution.correlation_id,
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
              correlationId: attribution.correlation_id,
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
            actor: attribution.operator_identity,
            ...attribution,
            prior_revision: binding.revision,
            revision: updated.revision,
            prior_role: binding.role,
            role: updated.role,
            prior_verification_state: binding.verification_state,
            verification_state: updated.verification_state,
            prior_active: binding.active,
            active: updated.active,
            evidence: {
              correlationId: attribution.correlation_id,
              tokenId,
              policyVersion: 1,
            },
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
 * resolvable, so it is deliberately separate from verification, carries its
 * own attribution and audit action, and requires an independent approval
 * recorded earlier by a different operator.
 *
 * The approval is validated by the database against the exact reviewed
 * pre-state, so a stale, expired, self-approved, already-spent or
 * wrong-context approval is refused there rather than here.
 */
export async function activateTenantDomain(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainApprovedTransition,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const attribution = requireAttribution(input.attribution);
  const approvalId = requireApprovalId(input.approvalId);
  const hostname = requireCanonicalHostname(input.hostname);

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await lockBinding(
        trx,
        organizationId,
        hostname,
        input.expectedRevision,
        'active',
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
          actor: attribution.operator_identity,
          ...attribution,
          approval_id: approvalId,
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
 * made and attributed on its own. Because deactivation stays immediate and
 * unapproved, incident response is never gated on a second operator, while
 * the destructive step that follows always is.
 */
export async function revokeTenantDomainVerification(
  db: Kysely<DatabaseSchema>,
  input: TenantDomainApprovedTransition,
): Promise<TenantDomainOutcome> {
  const organizationId = requireOrganizationId(input.organizationId);
  const attribution = requireAttribution(input.attribution);
  const approvalId = requireApprovalId(input.approvalId);
  const hostname = requireCanonicalHostname(input.hostname);

  return run(() =>
    db.transaction().execute(async (trx) => {
      const binding = await lockBinding(
        trx,
        organizationId,
        hostname,
        input.expectedRevision,
        'lock_only',
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
          actor: attribution.operator_identity,
          ...attribution,
          approval_id: approvalId,
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

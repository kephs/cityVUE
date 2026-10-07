import 'reflect-metadata';
import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';
import { databaseConnectionOptions } from '../config/database-tls.js';
import { validateEnvironment } from '../config/environment.js';
import {
  assertConnectionIdentity,
  assertOperatorIdentityScheme,
  assertRuntimeMatchesTarget,
  operatorFailure,
  OperatorRefusal,
  resolveOperatorTarget,
  type OperatorFailureCode,
  type OperatorTarget,
} from '../config/operator-environment.js';
import {
  activateTenantDomain,
  deactivateTenantDomain,
  inspectTenantDomain,
  issueTenantDomainChallenge,
  recordTenantDomainApproval,
  registerTenantDomain,
  revokeTenantDomainVerification,
  verifyTenantDomain,
  type OperatorAttribution,
  type TenantDomainApprovableOperation,
} from '../tenancy/tenant-domain.operations.js';
import { isTenantDomainRole } from '../tenancy/tenant-domain.js';
import {
  DEFAULT_CHALLENGE_LIFETIME_DAYS,
  MAXIMUM_CHALLENGE_LIFETIME_DAYS,
} from '../tenancy/tenant-domain-challenge.js';
import { nodeDnsPort } from '../tenancy/tenant-domain-verifier.js';
import type { DatabaseSchema } from './database.types.js';

/**
 * ADR-027 F060.3C-2b production-capable tenant-domain operator command.
 *
 * **Production use is not authorized by this file existing.** It remains
 * blocked on F060.3C-2c and on the infrastructure controls recorded in the
 * feature document: distinct per-human IAM identities, just-in-time
 * elevation, a deployment job runner, secret-manager injection,
 * invocation and session audit, off-host immutable log retention, and a
 * least-privilege operator database role.
 *
 * The intended execution model is a one-shot job inside the target
 * deployment, started through infrastructure IAM, with the database
 * credential injected by the deployment secret manager. It is explicitly not
 * intended to run from an administrator workstation holding production
 * credentials.
 *
 * Infrastructure IAM is the authentication trust root. This command records
 * *attribution*, never authentication: `REQRO_OPERATOR_IDENTITY` must be
 * injected by trusted infrastructure from the current per-human IAM
 * principal and must not be an operator-editable field in a production job
 * definition. The command validates its shape and refuses a development
 * scheme in a serving environment; it does not and cannot verify who
 * supplied it.
 *
 * The separate development command keeps its own local-database pin and is
 * untouched. No verb here reaches resident, service-request, attachment,
 * tracking, Resident Experience, access or notification data; there is no
 * raw-SQL path, no discovery or listing verb, no aggregate onboarding verb,
 * no Organization lifecycle mutation, and no break-glass of any kind.
 */
const OPERATIONS = [
  'register',
  'issue-challenge',
  'verify',
  'activate',
  'deactivate',
  'revoke',
  'approve',
] as const;

type Operation = (typeof OPERATIONS)[number];

/** Activation and revocation are the only operations that consume an
 * independent approval, and the only ones an approval may be created for. */
const APPROVAL_REQUIRED: Partial<
  Record<Operation, TenantDomainApprovableOperation>
> = {
  activate: 'activated',
  revoke: 'verification_revoked',
};

const USAGE =
  'Production-capable tenant-domain operator command: ' +
  OPERATIONS.join('|') +
  ' --dry-run|--confirm (approve takes the approved operation first, for example "approve activate --confirm"). ' +
  'Targeting requires REQRO_OPERATOR_ENVIRONMENT (test|staging|production) to equal the infrastructure-owned ' +
  'REQRO_DEPLOYMENT_ENVIRONMENT, plus REQRO_OPERATOR_DATABASE and REQRO_OPERATOR_DATABASE_USER, which are ' +
  'verified against the live connection before any mutation. ' +
  'Attribution requires REQRO_OPERATOR_IDENTITY (iam: or oidc: in a serving environment), REQRO_OPERATOR_REASON, ' +
  'REQRO_OPERATOR_CORRELATION_ID, REQRO_OPERATOR_ORGANIZATION_ID and REQRO_OPERATOR_HOSTNAME, with ' +
  'REQRO_OPERATOR_EXPECTED_REVISION for every change, REQRO_OPERATOR_APPROVAL_ID for activate and revoke ' +
  '(optional in a dry run, mandatory to confirm), ' +
  'REQRO_OPERATOR_REQUESTER_IDENTITY for approve, and optional ' +
  `REQRO_OPERATOR_CHALLENGE_LIFETIME_DAYS (1-${String(MAXIMUM_CHALLENGE_LIFETIME_DAYS)}, default ${String(DEFAULT_CHALLENGE_LIFETIME_DAYS)}) ` +
  'for issue-challenge and REQRO_OPERATOR_DNS_TIMEOUT_MS/REQRO_OPERATOR_DNS_TRIES for verify. ' +
  'Registration is always unverified and inactive; verification never activates; activate requires a verified ' +
  'binding and an independent approval; revoke requires prior deactivation and an independent approval. ' +
  'An approval-required dry run without an approval reports commitEligibility=pending_approval and is a plan for ' +
  'independent review, not evidence the mutation would commit; with the approval it reports ' +
  'commitEligibility=validated, having run every constraint and rolled back without consuming the approval. ' +
  'The database credential comes only from the deployment secret manager through DATABASE_URL; credentials are ' +
  'never accepted in arguments and there is no --database-url option.\n';

function refuse(code: OperatorFailureCode, message: string): never {
  throw new OperatorRefusal(code, message);
}

/**
 * Maps a refusal from the operations layer or the database onto a closed
 * code. The message is read only to classify it and is never emitted.
 */
function classify(error: unknown): OperatorFailureCode {
  const message = error instanceof Error ? error.message : '';
  // Environment validation and the TLS policy both raise this prefix. A
  // misconfigured runtime is an environment refusal, never a database fault.
  if (message.startsWith('Invalid server configuration:'))
    return 'environment_mismatch';
  // Both the refusal to record an approval naming one identity for both roles
  // and the refusal to consume one as its approver are self-approval.
  if (
    message.includes('cannot be self-approved') ||
    message.includes('requires a different approver')
  )
    return 'self_approval';
  if (message.includes('approval has expired')) return 'approval_expired';
  if (message.includes('requires an independent approval'))
    return 'approval_missing';
  if (
    /does not match the mutation context|authorizes a different operation|names a different operator|must be independently committed|foreign key/.test(
      message,
    )
  )
    return 'approval_context_mismatch';
  if (message.includes('revision has moved')) return 'revision_stale';
  if (
    /operator identity|operator reason|correlation UUID|approval UUID/.test(
      message,
    )
  )
    return 'attribution_invalid';
  if (/Hostname rejected|Organization UUID|domain role/.test(message))
    return 'operation_invalid';
  // An unclassified refusal reached us from the database tier, so it is
  // reported as such rather than as an invalid operation.
  return 'database_unavailable';
}

function requiredValue(key: string, code: OperatorFailureCode): string {
  const value = (process.env[key] ?? '').trim();
  if (!value) refuse(code, `${key} is required`);
  return value;
}

function refusedValue(key: string, reason: string): void {
  if ((process.env[key] ?? '').trim())
    refuse('operation_invalid', `${key} ${reason}`);
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
    refuse(
      'operation_invalid',
      `${label} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  return value;
}

function requiredRevision(): number {
  const value = Number(
    requiredValue('REQRO_OPERATOR_EXPECTED_REVISION', 'revision_stale'),
  );
  if (!Number.isInteger(value) || value < 1)
    refuse(
      'revision_stale',
      'REQRO_OPERATOR_EXPECTED_REVISION must be a positive integer',
    );
  return value;
}

/** Reads the version-2 attribution fields Migration 47 requires. Each is an
 * individually named and individually validated input; there is no JSON or
 * free-form payload that could carry an unvalidated key through. */
function readAttribution(target: OperatorTarget): OperatorAttribution {
  const operatorIdentity = requiredValue(
    'REQRO_OPERATOR_IDENTITY',
    'attribution_invalid',
  );
  assertOperatorIdentityScheme(target, operatorIdentity);
  return {
    operatorIdentity,
    reason: requiredValue('REQRO_OPERATOR_REASON', 'attribution_invalid'),
    correlationId: requiredValue(
      'REQRO_OPERATOR_CORRELATION_ID',
      'attribution_invalid',
    ),
  };
}

/** Re-reads the connection's own identity from the server, so a substituted
 * or mismatched DATABASE_URL is refused before the first BEGIN. */
async function assertDatabaseTarget(
  database: Kysely<DatabaseSchema>,
  target: OperatorTarget,
): Promise<void> {
  let rows;
  try {
    rows = (
      await sql<{
        database: string;
        user: string;
        address: string | null;
      }>`select current_database() as database, current_user as user, inet_server_addr()::text as address`.execute(
        database,
      )
    ).rows;
  } catch {
    refuse(
      'database_unavailable',
      'the operator database could not be reached',
    );
  }
  const identity = rows[0];
  if (!identity)
    refuse(
      'database_unavailable',
      'the operator database returned no identity',
    );
  assertConnectionIdentity(target, {
    database: identity.database,
    user: identity.user,
    serverAddress: identity.address,
  });
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  const operation = args[0] ?? '';
  if (!(OPERATIONS as readonly string[]).includes(operation))
    refuse('operation_invalid', 'an explicit approved operation is required');
  const verb = operation as Operation;

  // `approve` names the operation it authorizes before its mode.
  const approvedVerb = verb === 'approve' ? (args[1] ?? '') : '';
  const mode = verb === 'approve' ? (args[2] ?? '') : (args[1] ?? '');
  if (verb === 'approve') {
    if (!Object.hasOwn(APPROVAL_REQUIRED, approvedVerb))
      refuse(
        'operation_invalid',
        'approve requires the approved operation, which is activate or revoke',
      );
    // Creating an approval has no registry state to validate and discard, so
    // a dry run would silently write it.
    if (mode !== '--confirm')
      refuse('operation_invalid', 'recording an approval requires --confirm');
  } else if (!['--dry-run', '--confirm'].includes(mode))
    refuse('operation_invalid', 'an explicit mode is required');

  const dryRun = mode === '--dry-run';
  const approvalRequired = verb === 'activate' || verb === 'revoke';

  const target = resolveOperatorTarget(process.env);
  const environment = validateEnvironment(process.env);
  assertRuntimeMatchesTarget(target, {
    nodeEnvironment: environment.NODE_ENV,
    deploymentProfile: environment.CITYVUE_DEPLOYMENT_PROFILE,
    tenantResolutionStrategy: environment.TENANT_RESOLUTION_STRATEGY,
  });

  const attribution = readAttribution(target);
  const organizationId = requiredValue(
    'REQRO_OPERATOR_ORGANIZATION_ID',
    'operation_invalid',
  );
  const hostname = requiredValue(
    'REQRO_OPERATOR_HOSTNAME',
    'operation_invalid',
  );

  // The approval identifier belongs to exactly the two consuming operations,
  // and the requester identity to exactly the approve command, so neither can
  // be attached where it has no meaning.
  if (verb !== 'activate' && verb !== 'revoke')
    refusedValue(
      'REQRO_OPERATOR_APPROVAL_ID',
      'is accepted only when activating or revoking',
    );
  if (verb !== 'approve')
    refusedValue(
      'REQRO_OPERATOR_REQUESTER_IDENTITY',
      'is accepted only when recording an approval',
    );

  // Every verb-specific input is resolved and validated here, before a pool
  // exists, so a malformed request is refused with its own code instead of
  // surfacing later as a database failure.
  const role =
    verb === 'register' ? process.env.REQRO_OPERATOR_ROLE : undefined;
  if (verb === 'register' && !isTenantDomainRole(role))
    refuse('operation_invalid', 'REQRO_OPERATOR_ROLE is required for register');
  const expectedRevision = verb === 'register' ? 0 : requiredRevision();
  // An approval-required operation supports two distinct dry-run states, so
  // the identifier is optional when planning and mandatory when committing.
  // A pre-approval plan is how the requester produces the exact context a
  // second operator reviews; it is never evidence that the mutation would
  // commit, and the emitted `commitEligibility` says so.
  const approvalId = approvalRequired
    ? dryRun
      ? (process.env.REQRO_OPERATOR_APPROVAL_ID ?? '').trim()
      : requiredValue('REQRO_OPERATOR_APPROVAL_ID', 'approval_missing')
    : '';
  const requesterIdentity =
    verb === 'approve'
      ? requiredValue(
          'REQRO_OPERATOR_REQUESTER_IDENTITY',
          'attribution_invalid',
        )
      : '';
  const lifetimeDays =
    verb === 'issue-challenge'
      ? boundedInteger(
          process.env.REQRO_OPERATOR_CHALLENGE_LIFETIME_DAYS,
          DEFAULT_CHALLENGE_LIFETIME_DAYS,
          1,
          MAXIMUM_CHALLENGE_LIFETIME_DAYS,
          'REQRO_OPERATOR_CHALLENGE_LIFETIME_DAYS',
        )
      : DEFAULT_CHALLENGE_LIFETIME_DAYS;
  const dnsTimeoutMs = boundedInteger(
    process.env.REQRO_OPERATOR_DNS_TIMEOUT_MS,
    3000,
    100,
    30000,
    'REQRO_OPERATOR_DNS_TIMEOUT_MS',
  );
  const dnsTries = boundedInteger(
    process.env.REQRO_OPERATOR_DNS_TRIES,
    2,
    1,
    5,
    'REQRO_OPERATOR_DNS_TRIES',
  );

  const database = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({
      pool: new Pool({
        ...databaseConnectionOptions({
          environment: environment.NODE_ENV,
          url: environment.DATABASE_URL,
          sslMode: environment.DATABASE_SSL_MODE,
          caFile: environment.DATABASE_SSL_CA_FILE,
        }),
        max: 1,
        connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
        statement_timeout: environment.DATABASE_STATEMENT_TIMEOUT_MS,
        application_name: 'cityvue-tenant-domain-operator',
      }),
    }),
  });

  const emit = (value: unknown) =>
    process.stdout.write(JSON.stringify(value) + '\n');
  /**
   * Machine-readable commit eligibility, so a plan can never be mistaken for
   * proof that the mutation would commit:
   *
   * - `pending_approval` — a plan only. Everything checkable without an
   *   approval passed, and the independent approval is required and absent.
   * - `validated` — the real transaction ran every constraint, including the
   *   approval and context checks, and was then rolled back.
   * - `committed` — applied.
   */
  const commitEligibility = !dryRun
    ? ('committed' as const)
    : approvalRequired && !approvalId
      ? ('pending_approval' as const)
      : ('validated' as const);

  /** Only what the operator already supplied, plus the registry state of the
   * one binding they named. No Organization name, slug or other binding. */
  const plan = {
    environment: target.environment,
    database: target.database,
    databaseUser: target.databaseUser,
    organizationId,
    hostname,
    operation: verb,
    approvalRequired,
    approvalPresent: approvalId !== '',
    mutation: dryRun ? ('not_executed' as const) : ('executed' as const),
    commitEligibility,
  };

  try {
    await assertDatabaseTarget(database, target);

    // Pre-approval plan. Validates the Organization, the named binding, its
    // current state, the expected revision and the attribution, writes
    // nothing, and reports explicitly that it is not commit validated.
    if (commitEligibility === 'pending_approval') {
      const domain = await inspectTenantDomain(
        database,
        organizationId,
        hostname,
      );
      if (domain.revision !== expectedRevision)
        refuse(
          'revision_stale',
          'the tenant domain revision has moved; re-read before planning',
        );
      if (verb === 'activate') {
        if (domain.verificationState !== 'verified')
          refuse(
            'operation_invalid',
            'only a verified tenant domain can be activated',
          );
        if (domain.active)
          refuse('operation_invalid', 'the tenant domain is already active');
      } else {
        if (domain.active)
          refuse(
            'operation_invalid',
            'deactivate the tenant domain before revoking verification',
          );
        if (domain.verificationState === 'unverified')
          refuse(
            'operation_invalid',
            'the tenant domain has no verification to revoke',
          );
      }
      emit({
        ...plan,
        domain,
        advisory:
          'independent approval is required and absent; this plan is not commit validated',
      });
      return;
    }

    if (verb === 'approve') {
      const approved = APPROVAL_REQUIRED[approvedVerb as Operation];
      if (!approved)
        refuse('operation_invalid', 'the approved operation is not approvable');
      // approved_by is the injected identity of the operator running this
      // command; it is never a separate input. The requester is named
      // explicitly, and Migration 47 refuses the two being equal.
      const approval = await recordTenantDomainApproval(database, {
        organizationId,
        hostname,
        expectedRevision,
        operation: approved,
        requestedBy: requesterIdentity,
        approvedBy: attribution.operatorIdentity,
        reason: attribution.reason,
        correlationId: attribution.correlationId,
      });
      emit({ ...plan, operation: 'approve', approves: approvedVerb, approval });
      return;
    }

    const selection = { organizationId, hostname, attribution, dryRun };
    if (verb === 'register') {
      if (!isTenantDomainRole(role))
        refuse(
          'operation_invalid',
          'REQRO_OPERATOR_ROLE is required for register',
        );
      emit({
        ...plan,
        outcome: await registerTenantDomain(database, { ...selection, role }),
      });
      return;
    }

    const transition = { ...selection, expectedRevision };
    if (verb === 'issue-challenge') {
      emit({
        ...plan,
        outcome: await issueTenantDomainChallenge(database, {
          ...transition,
          lifetimeDays,
        }),
      });
      return;
    }
    if (verb === 'verify') {
      emit({
        ...plan,
        outcome: await verifyTenantDomain(
          database,
          nodeDnsPort({ timeoutMs: dnsTimeoutMs, tries: dnsTries }),
          transition,
        ),
      });
      return;
    }
    if (verb === 'deactivate') {
      emit({
        ...plan,
        outcome: await deactivateTenantDomain(database, transition),
      });
      return;
    }

    const approved = { ...transition, approvalId };
    emit({
      ...plan,
      outcome:
        verb === 'activate'
          ? await activateTenantDomain(database, approved)
          : await revokeTenantDomainVerification(database, approved),
    });
  } finally {
    await database.destroy();
  }
}

run().catch((error: unknown) => {
  // One sanitized failure path. The closed code is for infrastructure job
  // logs; no message, SQL, connection string, credential or registry
  // discovery data is emitted, and a failure never falls back to another
  // operation.
  process.stderr.write(
    operatorFailure(
      error,
      error instanceof OperatorRefusal ? error.code : classify(error),
    ),
  );
  process.exitCode = 1;
});

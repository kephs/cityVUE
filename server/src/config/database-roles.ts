import {
  resolveDeploymentSchema,
  withoutConnectionOptions,
} from './operator-environment.js';

/**
 * ADR-027 F060.3C-2d. Keeps the migration credential separate from the
 * runtime credential, and pins the trusted application schema on both.
 *
 * Why this exists. Until this slice the reproducible environment collapsed the
 * database owner, the migration role and the runtime application role into one
 * superuser, so `DATABASE_URL` was simultaneously the DDL credential and the
 * request-path credential. Separating them in the database is only half the
 * work: the application must also be unable to confuse the two.
 *
 * Three rules, all fail-closed in a serving environment:
 *
 * 1. The migration CLI reads `MIGRATION_DATABASE_URL` and **never** falls back
 *    to `DATABASE_URL` in any serving posture. A documented development/test
 *    fallback exists because local workflows and the disposable test database
 *    predate this split.
 *
 *    "Serving" is judged from three independent signals, any one of which
 *    closes the fallback, because keying on `NODE_ENV` alone would leave a
 *    client-profile or staging deployment able to migrate with the runtime
 *    credential: `NODE_ENV=production`, a `client` deployment profile, or a
 *    `REQRO_DEPLOYMENT_ENVIRONMENT` of `staging` or `production`.
 * 2. The runtime **never** reads `MIGRATION_DATABASE_URL`. That is asserted
 *    structurally by a boundary test over the built runtime graph, not merely
 *    by convention, which is why the runtime's own resolver lives in
 *    `runtime-connection.ts` and this module stays out of the runtime graph
 *    entirely.
 * 3. Both connections pin the deployment-owned schema and strip a
 *    `search_path`-bearing `options` parameter from their URL, because
 *    F060.3C-2c-3 measured that a connection-string `options` value
 *    **overrides** an explicit `options` key in a pool configuration.
 *
 * Secrets never appear here. This module validates shapes and identities; it
 * resolves no password and emits none.
 */

/** Closed failure categories, so an infrastructure job log can alert on a code
 * without the message ever carrying detail. Mirrors the operator module's
 * approach deliberately. */
export type DatabaseRoleFailureCode =
  | 'migration_url_missing'
  | 'migration_url_invalid'
  | 'owner_role_invalid'
  | 'identity_mismatch'
  | 'role_assumption_failed';

export const databaseRoleFailureCodes: readonly DatabaseRoleFailureCode[] = [
  'migration_url_missing',
  'migration_url_invalid',
  'owner_role_invalid',
  'identity_mismatch',
  'role_assumption_failed',
];

/** Carries a closed code alongside a message that is never emitted as-is. */
export class DatabaseRoleRefusal extends Error {
  constructor(
    readonly code: DatabaseRoleFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'DatabaseRoleRefusal';
  }
}

function refuse(code: DatabaseRoleFailureCode, message: string): never {
  throw new DatabaseRoleRefusal(code, message);
}

/** The owner role a migration assumes. Deliberately narrow: no quoting, no
 * whitespace, no separators, so it cannot carry a second statement into the
 * `SET ROLE` that uses it. */
const ROLE_IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;

/** The default owner role name, matching the provisioning artifacts. */
const DEFAULT_OWNER_ROLE = 'reqro_owner';

export interface MigrationConnection {
  /** The migration credential, stripped of any `search_path` override. */
  readonly url: string;
  /** The role migrations run as, after an explicit `SET ROLE`. */
  readonly ownerRole: string;
  /** The deployment-owned application schema. */
  readonly schema: string;
  /** `options` string pinning that schema on the connection. */
  readonly connectionOptions: string;
  /** True when the migration credential was supplied explicitly. False only
   * under the documented development/test fallback. */
  readonly dedicatedCredential: boolean;
}

/**
 * Resolves the migration connection.
 *
 * `MIGRATION_DATABASE_URL` is infrastructure owned and mandatory outside
 * development and test. The fallback to `DATABASE_URL` exists solely so the
 * existing local and disposable-test workflows keep working while the
 * separated topology is adopted; it is reported through
 * `dedicatedCredential: false` so a caller can log the degraded posture rather
 * than have it pass silently.
 */
export function resolveMigrationConnection(
  environment: NodeJS.ProcessEnv,
): MigrationConnection {
  // Any one of these closes the fallback. Deliberately a union rather than a
  // single check: a client or staging deployment must never be able to run a
  // migration with the runtime credential, whatever NODE_ENV happens to say.
  const nodeEnvironment = (environment.NODE_ENV ?? '').trim();
  const deploymentProfile = (
    environment.CITYVUE_DEPLOYMENT_PROFILE ?? ''
  ).trim();
  const deploymentEnvironment = (
    environment.REQRO_DEPLOYMENT_ENVIRONMENT ?? ''
  ).trim();
  const serving =
    nodeEnvironment === 'production' ||
    deploymentProfile === 'client' ||
    deploymentEnvironment === 'staging' ||
    deploymentEnvironment === 'production';
  const migrationUrl = (environment.MIGRATION_DATABASE_URL ?? '').trim();
  const runtimeUrl = (environment.DATABASE_URL ?? '').trim();

  if (!migrationUrl && serving)
    refuse(
      'migration_url_missing',
      'MIGRATION_DATABASE_URL is required in a serving deployment; the migration command never falls back to the runtime credential',
    );

  const chosen = migrationUrl || runtimeUrl;
  if (!chosen)
    refuse('migration_url_missing', 'no migration database URL is configured');

  let parsed: URL;
  try {
    parsed = new URL(chosen);
  } catch {
    refuse('migration_url_invalid', 'the migration database URL is not a URL');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol))
    refuse(
      'migration_url_invalid',
      'the migration database URL must identify a PostgreSQL host',
    );

  const ownerRole =
    (environment.REQRO_DATABASE_OWNER_ROLE ?? '').trim() || DEFAULT_OWNER_ROLE;
  if (!ROLE_IDENTIFIER.test(ownerRole))
    refuse(
      'owner_role_invalid',
      'REQRO_DATABASE_OWNER_ROLE is not a plain PostgreSQL identifier',
    );

  const deployment = resolveDeploymentSchema(environment);
  return {
    url: withoutConnectionOptions(chosen),
    ownerRole,
    schema: deployment.schema,
    connectionOptions: deployment.connectionOptions,
    dedicatedCredential: migrationUrl !== '',
  };
}

/** The identity a connection reports, used for the pre-DDL assertions. */
export interface ConnectionIdentity {
  readonly currentUser: string;
  readonly sessionUser: string;
}

/**
 * Asserts that a migration connection has assumed the owner role while
 * retaining the migration login as `session_user`.
 *
 * Both halves matter. `current_user` is what PostgreSQL uses for ownership and
 * privilege decisions, so it must be the owner or the migration would create
 * objects owned by the login. `session_user` is what stays in the audit trail,
 * so it must remain the migration login rather than being lost to the role
 * assumption.
 */
export function assertMigrationRoleAssumed(
  identity: ConnectionIdentity,
  expected: { readonly ownerRole: string; readonly loginRole: string },
): void {
  if (identity.currentUser !== expected.ownerRole)
    refuse(
      'role_assumption_failed',
      'the migration connection did not assume the configured owner role',
    );
  if (identity.sessionUser !== expected.loginRole)
    refuse(
      'identity_mismatch',
      'the migration session identity changed unexpectedly',
    );
  if (identity.sessionUser === identity.currentUser)
    refuse(
      'identity_mismatch',
      'the migration login and the owner role must be distinct identities',
    );
}

/**
 * Refuses a migration connection whose login is already the owner role.
 *
 * A login that *is* the owner would make the `SET ROLE` meaningless and would
 * reintroduce standing DDL authority on a credential. Reported before any DDL
 * runs.
 */
export function assertMigrationLoginSeparate(
  sessionUser: string,
  ownerRole: string,
): void {
  if (sessionUser === ownerRole)
    refuse(
      'identity_mismatch',
      'the migration credential must not be the owner role itself',
    );
}

import {
  safeErrorContext,
  safeLogMessage,
} from '../common/logging/log-sanitization.js';

/**
 * ADR-027 F060.3C-2b production operator targeting.
 *
 * The application does **not** authenticate the operator. Infrastructure IAM
 * is the authentication trust root: the ability to run a one-shot job inside
 * the target deployment *is* the authority, and `REQRO_OPERATOR_IDENTITY` must
 * be injected by trusted infrastructure from the current per-human IAM
 * principal. It must not be an operator-editable free field in a production
 * job definition. This module validates the *shape* of that identity and
 * records it for attribution; it never claims to have verified who supplied
 * it.
 *
 * What this module does enforce is that an operator cannot silently act on
 * whichever database happens to be configured: the requested target, the
 * infrastructure-owned deployment marker and the live connection identity
 * must all agree before the first mutation transaction opens.
 */
export type OperatorEnvironment = 'test' | 'staging' | 'production';

/** The production entry point never targets development; the existing
 * development CLI owns that environment and keeps its own local-database
 * pin. */
export const operatorEnvironments: readonly OperatorEnvironment[] = [
  'test',
  'staging',
  'production',
];

/** A deployment that serves real residents. These require the production
 * runtime, a client profile and registry tenant resolution. */
export const servingEnvironments: readonly OperatorEnvironment[] = [
  'staging',
  'production',
];

/** Closed failure categories for infrastructure job logs and incident
 * review. Human messages stay sanitized; this is the part a log alert can
 * match on without the message ever carrying detail. */
export type OperatorFailureCode =
  | 'environment_mismatch'
  | 'database_mismatch'
  | 'attribution_invalid'
  | 'approval_missing'
  | 'approval_expired'
  | 'approval_context_mismatch'
  | 'self_approval'
  | 'revision_stale'
  | 'verification_unavailable'
  | 'database_unavailable'
  | 'operation_invalid';

export const operatorFailureCodes: readonly OperatorFailureCode[] = [
  'environment_mismatch',
  'database_mismatch',
  'attribution_invalid',
  'approval_missing',
  'approval_expired',
  'approval_context_mismatch',
  'self_approval',
  'revision_stale',
  'verification_unavailable',
  'database_unavailable',
  'operation_invalid',
];

/** Carries a closed code alongside a message that is never emitted as-is. */
export class OperatorRefusal extends Error {
  constructor(
    readonly code: OperatorFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperatorRefusal';
  }
}

function refuse(code: OperatorFailureCode, message: string): never {
  throw new OperatorRefusal(code, message);
}

export interface OperatorTarget {
  readonly environment: OperatorEnvironment;
  readonly database: string;
  readonly databaseUser: string;
  readonly serving: boolean;
}

/** PostgreSQL identifiers the operator may name. Deliberately narrow: no
 * quoting, no whitespace, no wildcards. */
const IDENTIFIER = /^[a-z][a-z0-9_]{2,62}$/;

/** Development and test identities that must never appear behind a serving
 * target. Pattern based, so no customer database name enters source. */
const DEVELOPMENT_DATABASE = /(^|_)dev($|_)|^reqro_dev$/;
const TEST_DATABASE = /(^|_)test($|_)|_test$/;
const DEVELOPMENT_ROLE = /(^|_)dev($|_)|^reqro_dev_user$/;
const TEST_ROLE = /(^|_)test($|_)|_test_user$/;

function required(
  environment: NodeJS.ProcessEnv,
  key: string,
  code: OperatorFailureCode,
): string {
  const value = (environment[key] ?? '').trim();
  if (!value) refuse(code, `${key} is required`);
  return value;
}

/**
 * Resolves and cross-checks the requested target.
 *
 * `REQRO_DEPLOYMENT_ENVIRONMENT` is the infrastructure-owned marker of what
 * this deployment actually is; `REQRO_OPERATOR_ENVIRONMENT` is what the
 * operator says they intend. Requiring exact equality is what makes a staging
 * command unable to run against production, which `NODE_ENV` alone cannot
 * express because both serving environments are `production`.
 */
export function resolveOperatorTarget(
  environment: NodeJS.ProcessEnv,
): OperatorTarget {
  const requested = required(
    environment,
    'REQRO_OPERATOR_ENVIRONMENT',
    'environment_mismatch',
  );
  if (requested === 'development')
    refuse(
      'environment_mismatch',
      'the production operator command never targets development; use the development command',
    );
  if (!(operatorEnvironments as readonly string[]).includes(requested))
    refuse(
      'environment_mismatch',
      'REQRO_OPERATOR_ENVIRONMENT is not a known operator target',
    );
  const target = requested as OperatorEnvironment;

  const deployment = required(
    environment,
    'REQRO_DEPLOYMENT_ENVIRONMENT',
    'environment_mismatch',
  );
  if (deployment !== target)
    refuse(
      'environment_mismatch',
      'the requested operator environment does not match the deployment marker',
    );

  const database = required(
    environment,
    'REQRO_OPERATOR_DATABASE',
    'database_mismatch',
  );
  const databaseUser = required(
    environment,
    'REQRO_OPERATOR_DATABASE_USER',
    'database_mismatch',
  );
  for (const [label, value] of [
    ['REQRO_OPERATOR_DATABASE', database],
    ['REQRO_OPERATOR_DATABASE_USER', databaseUser],
  ] as const)
    if (!IDENTIFIER.test(value))
      refuse(
        'database_mismatch',
        `${label} is not a plain PostgreSQL identifier`,
      );

  const serving = (servingEnvironments as readonly string[]).includes(target);
  if (serving) {
    if (DEVELOPMENT_DATABASE.test(database) || TEST_DATABASE.test(database))
      refuse(
        'database_mismatch',
        'a serving environment cannot target a development or test database',
      );
    if (DEVELOPMENT_ROLE.test(databaseUser) || TEST_ROLE.test(databaseUser))
      refuse(
        'database_mismatch',
        'a serving environment cannot use a development or test database role',
      );
  } else if (!TEST_DATABASE.test(database) || !TEST_ROLE.test(databaseUser))
    // The gated test target exists only to exercise these paths against the
    // authorized disposable database, so it may not reach anything else.
    refuse(
      'database_mismatch',
      'the test operator target requires a test database and test role',
    );

  return { environment: target, database, databaseUser, serving };
}

/** The deployment-owned application schema, and the `options` string that
 * pins it on a connection. */
export interface DeploymentSchema {
  readonly schema: string;
  readonly connectionOptions: string;
}

/** Namespaces PostgreSQL reserves or resolves specially. None of these may be
 * named as the application schema: `pg_catalog` and `pg_temp` are searched by
 * their own rules, and `pg_` is reserved. */
const RESERVED_SCHEMA = /^(pg_|information_schema$)/;

/** The default. A deployment that has not said otherwise runs in `public`,
 * which is what every migration in this repository creates into. */
const DEFAULT_SCHEMA = 'public';

/**
 * Resolves the schema the operator connection pins at startup.
 *
 * Why this exists. A PostgreSQL role may always change its own stored
 * `search_path` with `ALTER ROLE ... SET search_path`, including to a value
 * that omits the application schema. Measured under the constrained role on
 * PostgreSQL 17: doing so breaks the operator path's unqualified reference to
 * `tenant_domain_lock_organization(uuid)`, because resolution then finds no
 * such function. Object resolution for the production operator path therefore
 * must not depend on a value the operator can edit.
 *
 * `REQRO_DEPLOYMENT_SCHEMA` is **infrastructure owned**, exactly like
 * `REQRO_DEPLOYMENT_ENVIRONMENT`. It is deliberately not a CLI argument and
 * there is no `--schema` flag: a schema override in operator hands would move
 * object resolution back under operator control, which is the thing this
 * closes. Tests supply their own isolated schema through the same variable.
 *
 * The value is a plain lower-case identifier and nothing else — no quoting, no
 * whitespace, no separators — so it cannot carry a second `-c` setting into
 * the connection options, and no credential or host content can be smuggled
 * through it.
 */
export function resolveDeploymentSchema(
  environment: NodeJS.ProcessEnv,
): DeploymentSchema {
  const supplied = (environment.REQRO_DEPLOYMENT_SCHEMA ?? '').trim();
  const schema = supplied === '' ? DEFAULT_SCHEMA : supplied;
  if (!IDENTIFIER.test(schema))
    refuse(
      'database_mismatch',
      'REQRO_DEPLOYMENT_SCHEMA is not a plain PostgreSQL identifier',
    );
  if (RESERVED_SCHEMA.test(schema))
    refuse(
      'database_mismatch',
      'REQRO_DEPLOYMENT_SCHEMA must not name a reserved PostgreSQL namespace',
    );
  // Pinned as the whole search_path, so the effective path equals the
  // deployment-owned schema and the role's own default is overridden for the
  // life of the connection.
  return { schema, connectionOptions: `-c search_path=${schema}` };
}

/**
 * Removes a `options` parameter from a database URL.
 *
 * `pg` lets a connection-string `options` parameter **override** the explicit
 * `options` key in a pool configuration, which would let the URL decide
 * `search_path` and defeat the deployment-owned pin. Measured on PostgreSQL
 * 17: with both present, the connection string won.
 *
 * `DATABASE_URL` is infrastructure owned, so this is not an operator-
 * controlled vector, but a pin that something else can override is not a pin.
 * This mirrors the existing precedence guard in the shared TLS module, which
 * rejects URL-supplied TLS and host parameters for the same reason, and is
 * applied here rather than there so shared database configuration is left
 * untouched.
 *
 * An unparseable value is returned unchanged; validating the URL belongs to
 * `databaseConnectionOptions`, which refuses it with its own message.
 */
export function withoutConnectionOptions(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.searchParams.has('options')) return url;
  parsed.searchParams.delete('options');
  return parsed.href;
}

export interface RuntimeConfiguration {
  readonly nodeEnvironment: string;
  readonly deploymentProfile: string;
  readonly tenantResolutionStrategy: string;
}

/**
 * Confirms the validated runtime matches the declared target.
 *
 * A serving target additionally requires registry tenant resolution: an
 * operator must not be able to register or activate a hostname in a
 * deployment that resolves tenants by configured development Organization
 * instead of by the registry those rows feed.
 */
export function assertRuntimeMatchesTarget(
  target: OperatorTarget,
  runtime: RuntimeConfiguration,
): void {
  if (target.serving) {
    if (runtime.nodeEnvironment !== 'production')
      refuse(
        'environment_mismatch',
        'a serving target requires the production runtime',
      );
    if (runtime.deploymentProfile !== 'client')
      refuse(
        'environment_mismatch',
        'a serving target requires the client deployment profile',
      );
    if (runtime.tenantResolutionStrategy !== 'registry')
      refuse(
        'environment_mismatch',
        'a serving target requires registry tenant resolution',
      );
    return;
  }
  if (runtime.nodeEnvironment !== 'test')
    refuse('environment_mismatch', 'the test target requires the test runtime');
  if (runtime.deploymentProfile !== 'development')
    refuse(
      'environment_mismatch',
      'the test target requires the development deployment profile',
    );
}

export interface ConnectionIdentity {
  readonly database: string;
  readonly user: string;
  /** `inet_server_addr()`, which is null for a local socket connection. */
  readonly serverAddress: string | null;
}

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/**
 * Asserts the live connection is the database the operator named.
 *
 * This is the check that makes explicit targeting real rather than
 * declarative: the names are re-read from the server, not from the connection
 * string, so a mismatched or substituted `DATABASE_URL` is refused before the
 * first `BEGIN`.
 */
export function assertConnectionIdentity(
  target: OperatorTarget,
  identity: ConnectionIdentity,
): void {
  if (identity.database !== target.database)
    refuse(
      'database_mismatch',
      'the connected database is not the declared target',
    );
  if (identity.user !== target.databaseUser)
    refuse(
      'database_mismatch',
      'the connected role is not the declared target',
    );
  if (!target.serving) return;
  if (
    DEVELOPMENT_DATABASE.test(identity.database) ||
    TEST_DATABASE.test(identity.database) ||
    DEVELOPMENT_ROLE.test(identity.user) ||
    TEST_ROLE.test(identity.user)
  )
    refuse(
      'database_mismatch',
      'a serving environment is connected to a development or test database',
    );
  // A null address means a local socket and is not safely distinguishable, so
  // it is not treated as evidence either way; an explicit loopback address is.
  if (identity.serverAddress !== null && LOOPBACK.has(identity.serverAddress))
    refuse(
      'database_mismatch',
      'a serving environment cannot target a loopback database address',
    );
}

/** The scheme of an operator identity, without duplicating the full grammar
 * that `tenant-domain.operations.ts` and Migration 47 both own. */
export function operatorIdentityScheme(value: string): string | null {
  const separator = value.indexOf(':');
  return separator > 0 ? value.slice(0, separator) : null;
}

/**
 * Refuses synthetic development attribution behind a serving target.
 *
 * This is the one attribution rule the database deliberately leaves to the
 * application: Migration 47 accepts `dev:` so local evidence is self-labelling
 * rather than indistinguishable from production, which only helps if the
 * production entry point refuses it.
 */
export function assertOperatorIdentityScheme(
  target: OperatorTarget,
  identity: string,
): void {
  const scheme = operatorIdentityScheme(identity);
  if (scheme === null)
    refuse('attribution_invalid', 'the operator identity carries no scheme');
  if (!['iam', 'oidc', 'dev'].includes(scheme))
    refuse(
      'attribution_invalid',
      'the operator identity scheme is not recognized',
    );
  if (target.serving && scheme === 'dev')
    refuse(
      'attribution_invalid',
      'a serving environment requires an infrastructure-issued iam or oidc identity',
    );
}

/**
 * The single sanitized failure path.
 *
 * Built from the same allowlist primitives as `commandFailure`, so no error
 * message, SQL fragment, connection string or credential can reach the
 * output, with the closed code added for job logs. An unclassified error
 * takes the caller's fallback rather than a misleading default, so a database
 * refusal is never reported as an invalid operation.
 */
export function operatorFailure(
  error: unknown,
  fallback: OperatorFailureCode,
): string {
  const code = error instanceof OperatorRefusal ? error.code : fallback;
  return (
    JSON.stringify({
      level: 50,
      time: Date.now(),
      service: 'cityvue-api',
      msg: safeLogMessage('Tenant domain operator command failed'),
      code,
      ...safeErrorContext(error),
    }) + '\n'
  );
}

export { refuse as refuseOperator };

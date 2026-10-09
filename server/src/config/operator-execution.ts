import {
  normalizeTrustedIdentity,
  OperatorIdentityRefusal,
  trustedIdentityAdapters,
  type NormalizedOperatorIdentity,
  type TrustedIdentityAdapter,
} from './operator-identity.js';
import {
  refuseOperator as refuse,
  type OperatorTarget,
} from './operator-environment.js';

/**
 * ADR-028 F060.3C-2e-1. The trusted production operator execution contract.
 *
 * **The one rule this module exists to enforce: humans choose the action,
 * never the actor.** Every field below is split into exactly one of two
 * disjoint channels:
 *
 * - **Trusted execution metadata** — who is running, under what elevation, on
 *   what runner, from what code. Injected by infrastructure. Thirteen fields,
 *   eleven of them independently required in a serving environment. A human
 *   cannot set, override or influence any of them through a CLI argument or an
 *   ordinary operator environment field.
 * - **Human-selectable operation inputs** — which binding, which verb, which
 *   mode, which revision. Chosen freely by the operator and validated as
 *   before.
 *
 * The two channels never overlap, and `assertChannelsDisjoint` is exported so
 * a test can prove that structurally rather than by reading the code.
 *
 * **What this module does not claim.** It does not authenticate anybody. The
 * trust root is infrastructure IAM: the ability to start a job inside the
 * target deployment *is* the authority. Everything here is a check that the
 * claims infrastructure injected are internally consistent, fresh, and
 * complete — which catches misconfiguration, a stale elevation, an untrusted
 * or unexpected runner, and unprovenanced code. It does **not** defend against
 * an attacker who already controls the runner's environment, because at that
 * point the attacker controls both sides of every comparison. That limit is
 * recorded rather than papered over; closing it belongs to the IAM and runner
 * configuration, not to this file.
 *
 * There is deliberately **no workstation path**. A serving invocation that
 * cannot produce complete trusted context fails closed. No flag, no
 * environment value and no development shortcut relaxes that.
 */

/** The elevation window ceiling. A grant wider than this is refused outright
 * rather than trimmed, because a wide window is a configuration error in the
 * IAM policy and silently narrowing it would hide that. */
export const MAXIMUM_ELEVATION_MINUTES = 60;

/** The recommended infrastructure job timeout. Not enforced here — a process
 * cannot reliably bound its own wall clock — it is asserted by the runner and
 * documented in the runbook, and it is deliberately far below the elevation
 * ceiling so a job cannot outlive the elevation that authorized it. */
export const RECOMMENDED_JOB_TIMEOUT_MINUTES = 15;

/**
 * The five approved conceptual platform-operator permissions, and the verbs
 * each authorizes.
 *
 * **Authority is split along two independent axes, and a permission belongs to
 * exactly one of them.**
 *
 * *Verb authority* — which operation may be performed:
 * - `tenant-domain.request` covers the six non-approve verbs.
 * - `tenant-domain.approve` covers `approve` and nothing else.
 *
 * *Execution authority* — whether a change may be **committed** rather than
 * only planned:
 * - `tenant-domain.execute` authorizes no verb of its own. It is the
 *   additional authority `--confirm` requires, so planning and committing are
 *   separately grantable. See {@link assertExecutionPermitted}.
 *
 * **`tenant-domain.request` must never authorize `approve`.** A permission
 * that let the requester also approve would collapse the two-person control
 * into one, defeating the independent-approval design of F060.3C-2b.
 *
 * Holding both still is not self-approval: Migration 47's
 * `requested_by <> approved_by` check refuses an approval naming one identity
 * for both roles, and the activate/revoke paths refuse to consume an approval
 * whose approver is the acting operator. **That database enforcement remains
 * the authoritative control**; the permission split is independent defence in
 * depth over the same property, and neither is load-bearing alone.
 *
 * Two permissions exist in the model but authorize nothing in this path, which
 * is the point of naming them:
 * - `deployment.migrate` is **distinct** migration authority. It belongs to
 *   the F060.3C-2d migration role and confers no tenant-domain verb and no
 *   execution authority, so migration authority can never be reused as
 *   control-plane change authority.
 * - `emergency.breakglass` is **unimplemented**. No break-glass capability
 *   exists anywhere in Reqro, so presenting it is refused outright rather
 *   than silently conferring nothing — see {@link parsePermissions}. An
 *   operator who believes they hold break-glass must be told it does not
 *   exist, not handed a confusing per-verb denial.
 */
export const OPERATOR_PERMISSIONS = {
  'tenant-domain.request': [
    'register',
    'issue-challenge',
    'verify',
    'activate',
    'deactivate',
    'revoke',
  ],
  'tenant-domain.approve': ['approve'],
  'tenant-domain.execute': [],
  'deployment.migrate': [],
  'emergency.breakglass': [],
} as const satisfies Record<string, readonly string[]>;

export type OperatorPermission = keyof typeof OPERATOR_PERMISSIONS;

export const operatorPermissions = Object.keys(
  OPERATOR_PERMISSIONS,
) as readonly OperatorPermission[];

/** The verb `tenant-domain.approve` uniquely authorizes. Named so the
 * invariant can be asserted by identity rather than by restating a list. */
export const APPROVE_VERB = 'approve';

/** The additional authority required to commit rather than plan. */
export const EXECUTE_PERMISSION = 'tenant-domain.execute';

/** Named so the unimplemented state is asserted by identity, not by a string
 * repeated across modules and tests. */
export const BREAKGLASS_PERMISSION = 'emergency.breakglass';

/** Distinct migration authority, which must never authorize a tenant-domain
 * change or a commit. */
export const MIGRATE_PERMISSION = 'deployment.migrate';

function isPermission(value: string): value is OperatorPermission {
  return Object.hasOwn(OPERATOR_PERMISSIONS, value);
}

/**
 * The thirteen trusted execution fields.
 *
 * Eleven are read from independently named infrastructure variables;
 * `identityIssuer` and `identitySubject` are derived from the normalized
 * identity rather than read separately, so there is no second channel that
 * could disagree with it. `invocationId` is generated locally, because a value
 * whose only job is to correlate this process's own audit records has nothing
 * to gain from being injected.
 */
export interface TrustedExecutionContext {
  /** Canonical recorded identity, `iam:<issuer>/<subject>`. */
  readonly identity: string;
  readonly identityIssuer: string;
  readonly identitySubject: string;
  /** Secondary, non-authoritative context for the audit record. */
  readonly identityDisplayName: string | null;
  readonly identityEmail: string | null;
  /** The IAM permissions this elevation granted. */
  readonly permissions: readonly OperatorPermission[];
  /** The just-in-time elevation that authorized this invocation. */
  readonly elevationRequestId: string;
  readonly elevationGrantedAt: Date;
  readonly elevationExpiresAt: Date;
  /** The runner asserting its own identity, and the platform label. */
  readonly runnerIdentity: string;
  readonly runnerPlatform: string;
  /** The infrastructure job execution this process belongs to. */
  readonly jobRunId: string;
  /** Code provenance: both immutable, neither a branch nor a tag. */
  readonly commitSha: string;
  readonly imageDigest: string;
  /** Locally generated; correlates this invocation's audit records. */
  readonly invocationId: string;
}

/**
 * The eleven infrastructure-owned variables a serving invocation requires.
 *
 * Listed as data, not prose, so the serving completeness check iterates the
 * same list a test asserts against and the two cannot drift.
 */
export const TRUSTED_EXECUTION_VARIABLES = [
  'REQRO_OPERATOR_IAM_TENANT_ID',
  'REQRO_OPERATOR_IAM_SUBJECT',
  'REQRO_OPERATOR_IAM_PERMISSIONS',
  'REQRO_OPERATOR_ELEVATION_REQUEST_ID',
  'REQRO_OPERATOR_ELEVATION_GRANTED_AT',
  'REQRO_OPERATOR_ELEVATION_EXPIRES_AT',
  'REQRO_OPERATOR_RUNNER_IDENTITY',
  'REQRO_OPERATOR_RUNNER_PLATFORM',
  'REQRO_OPERATOR_JOB_RUN_ID',
  'REQRO_OPERATOR_COMMIT_SHA',
  'REQRO_OPERATOR_IMAGE_DIGEST',
] as const;

/**
 * The human-selectable operation inputs.
 *
 * An operator chooses all of these. None of them is read anywhere in the
 * trusted path, which `assertChannelsDisjoint` proves. `REQRO_OPERATOR_REASON`,
 * `REQRO_OPERATOR_CORRELATION_ID`, `REQRO_OPERATOR_REQUESTER_IDENTITY` and the
 * challenge and DNS tuning values are also human-supplied and keep their
 * existing validation; they are not listed here because they describe the
 * request rather than selecting the operation.
 */
export const OPERATION_INPUTS = [
  'operation',
  'mode',
  'approvedOperation',
  'REQRO_OPERATOR_ORGANIZATION_ID',
  'REQRO_OPERATOR_HOSTNAME',
  'REQRO_OPERATOR_ROLE',
  'REQRO_OPERATOR_EXPECTED_REVISION',
  'REQRO_OPERATOR_APPROVAL_ID',
] as const;

/** Proves the two channels share no name. Exported so the disjointness is a
 * test assertion rather than a claim in a comment. */
export function assertChannelsDisjoint(): void {
  const trusted = new Set<string>(TRUSTED_EXECUTION_VARIABLES);
  for (const input of OPERATION_INPUTS)
    if (trusted.has(input))
      refuse(
        'execution_context_missing',
        'a trusted execution field is also a human-selectable operation input',
      );
}

/** A conservative opaque-identifier shape for runner, job and elevation
 * identifiers: printable, bounded, no whitespace and no separators that could
 * confuse a downstream log parser. */
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,190}$/;
/** A full commit SHA. A short SHA is refused: it is ambiguous, and a branch
 * name or a mutable tag is not provenance at all. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** An immutable image digest. A tag such as `:latest` cannot match. */
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/;
/** A platform label, for the audit record only. */
const PLATFORM_LABEL = /^[a-z][a-z0-9-]{1,40}$/;

function trusted(
  environment: NodeJS.ProcessEnv,
  key: (typeof TRUSTED_EXECUTION_VARIABLES)[number],
): string {
  const value = (environment[key] ?? '').trim();
  if (!value)
    refuse(
      'execution_context_missing',
      `${key} is required; a serving operator invocation requires complete trusted execution context`,
    );
  return value;
}

function instant(raw: string, key: string): Date {
  const value = new Date(raw);
  if (Number.isNaN(value.getTime()))
    refuse('elevation_invalid', `${key} is not a valid ISO-8601 instant`);
  return value;
}

/**
 * Validates the just-in-time elevation window.
 *
 * Three independent conditions, each refused with the same code because each
 * means the same thing operationally — this invocation is not covered by a
 * live elevation:
 *
 * - the window has expired, or expires before it was granted;
 * - the grant is in the future, allowing for a minute of clock skew between
 *   the IAM service and the runner;
 * - the window is wider than {@link MAXIMUM_ELEVATION_MINUTES}.
 */
function assertElevationWindow(grantedAt: Date, expiresAt: Date, now: Date) {
  const SKEW_MS = 60_000;
  if (expiresAt.getTime() <= grantedAt.getTime())
    refuse('elevation_invalid', 'the elevation window ends before it begins');
  if (grantedAt.getTime() > now.getTime() + SKEW_MS)
    refuse('elevation_invalid', 'the elevation grant is in the future');
  if (expiresAt.getTime() <= now.getTime())
    refuse(
      'elevation_invalid',
      'the elevation has expired; request a new just-in-time activation',
    );
  if (
    expiresAt.getTime() - grantedAt.getTime() >
    MAXIMUM_ELEVATION_MINUTES * 60_000
  )
    refuse(
      'elevation_invalid',
      `the elevation window exceeds the ${String(MAXIMUM_ELEVATION_MINUTES)}-minute maximum`,
    );
}

/**
 * The provider-neutral trusted-runner assertion adapter.
 *
 * The runner states its own identity in `REQRO_OPERATOR_RUNNER_IDENTITY`;
 * infrastructure states which identity is trusted in
 * `REQRO_OPERATOR_TRUSTED_RUNNER`. This asserts they agree.
 *
 * **Honest statement of strength.** Both values arrive through the same
 * environment, so this is a *consistency* check, not an authentication of the
 * runner. What it reliably catches: the artifact executed outside the intended
 * job definition, a job copied between deployments, and a misconfigured
 * runner. What it cannot catch: a runner whose environment an attacker already
 * controls. Making the runner's identity independently verifiable requires a
 * signed workload assertion from the platform, which is a provider-specific
 * capability and is deliberately out of scope here — the adapter shape is what
 * lets that be added later without touching the operator path.
 */
export type TrustedRunnerAssertion = (
  environment: NodeJS.ProcessEnv,
  asserted: string,
) => void;

export const assertDeclaredRunner: TrustedRunnerAssertion = (
  environment,
  asserted,
) => {
  const expected = (environment.REQRO_OPERATOR_TRUSTED_RUNNER ?? '').trim();
  if (!expected)
    refuse(
      'execution_context_missing',
      'REQRO_OPERATOR_TRUSTED_RUNNER is required; a serving invocation must declare which runner is trusted',
    );
  if (!OPAQUE_ID.test(expected))
    refuse(
      'runner_untrusted',
      'REQRO_OPERATOR_TRUSTED_RUNNER is not a plain opaque identifier',
    );
  if (asserted !== expected)
    refuse(
      'runner_untrusted',
      'the asserting runner is not the declared trusted runner for this deployment',
    );
};

export interface ExecutionResolution {
  readonly environment: NodeJS.ProcessEnv;
  readonly target: OperatorTarget;
  /** Injected for testing; defaults to the real clock. */
  readonly now?: Date | undefined;
  /** Injected so a second IdP is a parameter, not an edit. */
  readonly identityAdapter?: TrustedIdentityAdapter | undefined;
  readonly runnerAssertion?: TrustedRunnerAssertion | undefined;
  /** Injected so the invocation identifier is deterministic under test. */
  readonly newInvocationId?: (() => string) | undefined;
}

/**
 * Resolves the complete trusted execution context, or refuses.
 *
 * **Serving is all-or-nothing.** Every one of the eleven infrastructure
 * variables, plus the trusted-runner declaration, must be present and valid.
 * There is no partial mode, no warning-and-continue, and no development
 * fallback: a serving invocation missing any trusted field is refused with
 * `execution_context_missing` before a database pool is built.
 *
 * **Non-serving keeps the existing behaviour.** The gated `test` target has no
 * IAM, no elevation and no runner, so it returns `null` and the caller falls
 * back to the F060.3C-2b attribution path. That asymmetry is the whole point
 * of the serving/non-serving split and is why the test target may never name a
 * non-test database.
 */
export function resolveTrustedExecution(
  resolution: ExecutionResolution,
): TrustedExecutionContext | null {
  const { environment, target } = resolution;
  if (!target.serving) return null;

  assertChannelsDisjoint();

  const now = resolution.now ?? new Date();
  const adapter = resolution.identityAdapter ?? trustedIdentityAdapters.entra;
  const assertRunner = resolution.runnerAssertion ?? assertDeclaredRunner;

  // Presence of all eleven is established first, as a set, so an incomplete
  // context is reported as incomplete rather than as whichever specific field
  // happened to be validated first.
  for (const key of TRUSTED_EXECUTION_VARIABLES) trusted(environment, key);

  // The identity adapter owns both the provider's claim names and the
  // normalization. A refusal from it is remapped onto the operator code set so
  // the CLI keeps exactly one sanitized failure path.
  let identity: NormalizedOperatorIdentity;
  try {
    identity = normalizeTrustedIdentity(adapter(environment));
  } catch (error) {
    if (error instanceof OperatorIdentityRefusal)
      refuse(
        'attribution_invalid',
        'the trusted identity claims are absent, malformed or unsupported',
      );
    throw error;
  }

  // A human-supplied identity is refused outright in a serving environment
  // rather than quietly ignored. Ignoring it would leave an operator believing
  // they had set the actor; refusing says plainly that they cannot.
  if ((environment.REQRO_OPERATOR_IDENTITY ?? '').trim())
    refuse(
      'identity_override_rejected',
      'REQRO_OPERATOR_IDENTITY is not accepted in a serving environment; the actor comes from the trusted identity claims',
    );

  const permissions = parsePermissions(
    trusted(environment, 'REQRO_OPERATOR_IAM_PERMISSIONS'),
  );

  const elevationRequestId = trusted(
    environment,
    'REQRO_OPERATOR_ELEVATION_REQUEST_ID',
  );
  if (!OPAQUE_ID.test(elevationRequestId))
    refuse(
      'elevation_invalid',
      'REQRO_OPERATOR_ELEVATION_REQUEST_ID is not a plain opaque identifier',
    );
  const grantedAt = instant(
    trusted(environment, 'REQRO_OPERATOR_ELEVATION_GRANTED_AT'),
    'REQRO_OPERATOR_ELEVATION_GRANTED_AT',
  );
  const expiresAt = instant(
    trusted(environment, 'REQRO_OPERATOR_ELEVATION_EXPIRES_AT'),
    'REQRO_OPERATOR_ELEVATION_EXPIRES_AT',
  );
  assertElevationWindow(grantedAt, expiresAt, now);

  const runnerIdentity = trusted(environment, 'REQRO_OPERATOR_RUNNER_IDENTITY');
  if (!OPAQUE_ID.test(runnerIdentity))
    refuse(
      'runner_untrusted',
      'REQRO_OPERATOR_RUNNER_IDENTITY is not a plain opaque identifier',
    );
  assertRunner(environment, runnerIdentity);

  const runnerPlatform = trusted(environment, 'REQRO_OPERATOR_RUNNER_PLATFORM');
  if (!PLATFORM_LABEL.test(runnerPlatform))
    refuse(
      'runner_untrusted',
      'REQRO_OPERATOR_RUNNER_PLATFORM is not a plain lower-case label',
    );

  const jobRunId = trusted(environment, 'REQRO_OPERATOR_JOB_RUN_ID');
  if (!OPAQUE_ID.test(jobRunId))
    refuse(
      'execution_context_missing',
      'REQRO_OPERATOR_JOB_RUN_ID is not a plain opaque identifier',
    );

  // Both provenance values are required together. A commit SHA alone does not
  // say what actually ran, and a digest alone does not say what it was built
  // from; the pair is what makes an audit record reproducible.
  const commitSha = trusted(environment, 'REQRO_OPERATOR_COMMIT_SHA');
  if (!COMMIT_SHA.test(commitSha))
    refuse(
      'provenance_invalid',
      'REQRO_OPERATOR_COMMIT_SHA must be a full 40-character commit SHA; a branch name, tag or short SHA is not provenance',
    );
  const imageDigest = trusted(environment, 'REQRO_OPERATOR_IMAGE_DIGEST');
  if (!IMAGE_DIGEST.test(imageDigest))
    refuse(
      'provenance_invalid',
      'REQRO_OPERATOR_IMAGE_DIGEST must be an immutable sha256 digest; a mutable image tag is not provenance',
    );

  return {
    identity: identity.identity,
    identityIssuer: identity.issuer,
    identitySubject: identity.subject,
    identityDisplayName: identity.displayName,
    identityEmail: identity.email,
    permissions,
    elevationRequestId,
    elevationGrantedAt: grantedAt,
    elevationExpiresAt: expiresAt,
    runnerIdentity,
    runnerPlatform,
    jobRunId,
    commitSha,
    imageDigest,
    invocationId: (resolution.newInvocationId ?? defaultInvocationId)(),
  };
}

function defaultInvocationId(): string {
  // Imported lazily so this module stays usable in any context that does not
  // resolve a serving execution.
  return globalThis.crypto.randomUUID();
}

/** Parses the granted permission list. An unknown permission is refused
 * rather than ignored: silently dropping one would let a policy change that
 * renamed a permission read as "no authority" instead of as a misconfiguration,
 * and the operator would see a denial they could not explain. */
function parsePermissions(raw: string): readonly OperatorPermission[] {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length === 0)
    refuse(
      'execution_context_missing',
      'REQRO_OPERATOR_IAM_PERMISSIONS granted no permissions',
    );
  const granted: OperatorPermission[] = [];
  for (const part of parts) {
    if (!isPermission(part))
      refuse(
        'permission_denied',
        'REQRO_OPERATOR_IAM_PERMISSIONS names an unknown operator permission',
      );
    // Break-glass is unimplemented. Refusing is deliberately stronger than
    // conferring nothing: no capability anywhere in Reqro can honour this
    // grant, so an invocation that claims it is acting on a belief that is
    // false, and the fail-closed answer is to say so rather than to proceed
    // with whatever other authority happens to be present.
    if (part === BREAKGLASS_PERMISSION)
      refuse(
        'permission_denied',
        'emergency.breakglass is unimplemented; no break-glass capability exists and an invocation presenting it is refused',
      );
    if (!granted.includes(part)) granted.push(part);
  }
  return granted;
}

/**
 * Authorizes the chosen verb against the granted permissions.
 *
 * For `approve`, the verb checked is `approve` itself — not the operation the
 * approval authorizes. That distinction is the correction this slice carries:
 * recording an approval for `activate` requires `tenant-domain.approve`, and
 * holding `tenant-domain.request` grants it no part of that, however many
 * activate-shaped permissions the requester holds.
 */
export function assertPermitted(
  context: TrustedExecutionContext,
  verb: string,
): void {
  for (const permission of context.permissions) {
    const verbs: readonly string[] = OPERATOR_PERMISSIONS[permission];
    if (verbs.includes(verb)) return;
  }
  refuse(
    'permission_denied',
    'the granted operator permissions do not authorize this operation',
  );
}

/**
 * Authorizes **committing** rather than planning.
 *
 * Verb authority and execution authority are deliberately separate grants. A
 * `--dry-run` needs only the verb, which is what lets a requester produce the
 * pre-approval plan a second operator reviews; `--confirm` additionally
 * requires `tenant-domain.execute`.
 *
 * The practical effect is that the authority to decide *what* should change,
 * the authority to approve it, and the authority to actually apply it to a
 * serving deployment can be held by three different people — and none of the
 * three is implied by either of the others.
 *
 * `deployment.migrate` deliberately does not satisfy this. Migration authority
 * must never double as control-plane change authority.
 */
export function assertExecutionPermitted(
  context: TrustedExecutionContext,
  dryRun: boolean,
): void {
  if (dryRun) return;
  if (context.permissions.includes(EXECUTE_PERMISSION)) return;
  refuse(
    'permission_denied',
    'committing requires tenant-domain.execute; the granted permissions authorize planning only',
  );
}

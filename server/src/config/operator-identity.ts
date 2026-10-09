/**
 * ADR-028 F060.3C-2e. Turns trusted OIDC claims into the single normalized
 * operator identity the database records.
 *
 * **Provider neutral core, Entra as the first adapter.** Nothing below knows
 * what Microsoft Entra ID is; it consumes an issuer and an immutable subject.
 * `entraExecutionClaims` is one adapter over that boundary, and a second
 * provider needs another adapter rather than a change here.
 *
 * **Why the immutable subject and not the UPN.** A display name, a UPN and an
 * email are all reassignable: a person renames, a domain migrates, a leaver's
 * address is reused. An audit row written years earlier must still resolve to
 * one human, so the canonical identifier is the IdP's immutable subject — for
 * Entra the `oid` claim, generically `sub`. Display name and email are
 * recorded only as secondary context and are never a join key.
 *
 * **The database grammar is the real constraint, and it is narrower than OIDC.**
 * Migration 47 enforces, on `operator_identity`, `requested_by` and
 * `approved_by`:
 *
 * ```
 * ~ '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$'
 * !~ '[A-Za-z0-9]{32,}'
 * ```
 *
 * That second rule rejects any run of 32 or more alphanumerics, which is
 * exactly what an unhyphenated GUID or a base64url `sub` looks like. So a
 * bare Entra `oid` of `0a1b2c3d4e5f...` would be **refused by the database**.
 * This module therefore composes `iam:<issuer>/<subject>` from *hyphenated*
 * GUID forms and then validates the composed string against both rules
 * before returning it.
 *
 * Arbitrary OIDC `sub` values are deliberately **not** claimed to be
 * supported. A subject that cannot satisfy the constraints is refused with
 * `identity_unsupported` rather than silently mangled, so a future provider's
 * compatibility is proven at the boundary instead of assumed.
 */

/** Closed failure categories, so an infrastructure job log can alert on a code
 * without the message carrying identity or claim detail. */
export type OperatorIdentityFailureCode =
  | 'identity_absent'
  | 'identity_malformed'
  | 'identity_unsupported'
  /** ADR-029 F060.3C-2e-2A. The resolved principal is not backed by the
   * expected Entra directory, so it is not an identity this deployment can
   * attribute a production change to. */
  | 'identity_origin_untrusted';

export const operatorIdentityFailureCodes: readonly OperatorIdentityFailureCode[] =
  [
    'identity_absent',
    'identity_malformed',
    'identity_unsupported',
    'identity_origin_untrusted',
  ];

export class OperatorIdentityRefusal extends Error {
  constructor(
    readonly code: OperatorIdentityFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'OperatorIdentityRefusal';
  }
}

function refuse(code: OperatorIdentityFailureCode, message: string): never {
  throw new OperatorIdentityRefusal(code, message);
}

/** The provider-neutral claim shape an adapter must produce. */
export interface TrustedIdentityClaims {
  /** The IdP tenant or issuer identifier. Entra: the tenant id. */
  readonly issuer: string;
  /** The immutable subject. Entra: `oid`. Generic OIDC: `sub`. */
  readonly subject: string;
  /** Secondary audit context only. Never authoritative. */
  readonly displayName?: string | undefined;
  /** Secondary audit context only. Never authoritative. */
  readonly email?: string | undefined;
}

export interface NormalizedOperatorIdentity {
  /** The value written to the database: `iam:<issuer>/<subject>`. */
  readonly identity: string;
  readonly issuer: string;
  readonly subject: string;
  /** Secondary context, or null. Never used as a key. */
  readonly displayName: string | null;
  readonly email: string | null;
}

/** The database grammar, mirrored here so the refusal happens before a
 * transaction opens rather than as a constraint violation. */
const DATABASE_GRAMMAR = /^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$/;
/** Migration 47's second rule: no run of 32 or more alphanumerics. */
const LONG_ALPHANUMERIC_RUN = /[A-Za-z0-9]{32,}/;

/** A hyphenated GUID, which is the form both Entra identifiers must take for
 * the composed identity to satisfy the run-length rule: the longest
 * alphanumeric run is 12. */
const HYPHENATED_GUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Characters the composed identity may contain, beyond the grammar: a
 * conservative subset so an issuer or subject cannot smuggle a separator. */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{1,80}$/;

function segment(value: string | undefined, label: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed) refuse('identity_absent', `${label} is absent`);
  if (!SAFE_SEGMENT.test(trimmed))
    refuse('identity_malformed', `${label} is not a safe identifier segment`);
  return trimmed;
}

/** Secondary context: recorded, length-bounded, control characters refused,
 * and never used for any decision. Absent is acceptable. */
function secondary(value: string | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) return trimmed.slice(0, 200);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Composes and validates the canonical identity.
 *
 * Both halves are validated independently, then the composed string is checked
 * against the two database rules. That double check is deliberate: it is the
 * composition, not either part, that has to satisfy the run-length constraint.
 */
export function normalizeTrustedIdentity(
  claims: TrustedIdentityClaims,
): NormalizedOperatorIdentity {
  const issuer = segment(claims.issuer, 'the identity issuer');
  const subject = segment(claims.subject, 'the identity subject');
  const identity = `iam:${issuer}/${subject}`;

  if (!DATABASE_GRAMMAR.test(identity))
    refuse(
      'identity_unsupported',
      'the composed operator identity does not satisfy the recorded identity grammar',
    );
  if (LONG_ALPHANUMERIC_RUN.test(identity))
    refuse(
      'identity_unsupported',
      'the composed operator identity contains a long alphanumeric run the audit schema refuses; supply a hyphenated subject',
    );

  return {
    identity,
    issuer,
    subject,
    displayName: secondary(claims.displayName),
    email: secondary(claims.email),
  };
}

/**
 * The first provider adapter: Microsoft Entra ID.
 *
 * Reads the claims a trusted runner is expected to inject. The `oid` claim is
 * required and must be a hyphenated GUID — Entra emits GUIDs, and the
 * hyphenated form is what the audit schema accepts. `upn`, `mail` and
 * `name` are read only as secondary context.
 *
 * This function performs **no token validation**. Verifying an OIDC assertion
 * is the runner's and the identity provider's responsibility; by the time
 * these variables exist, the claims are already trusted infrastructure input.
 * The application's job is to refuse anything that does not look like a
 * trusted claim, never to pretend it authenticated the human.
 */
export function entraExecutionClaims(
  environment: NodeJS.ProcessEnv,
): TrustedIdentityClaims {
  const tenant = (environment.REQRO_OPERATOR_IAM_TENANT_ID ?? '').trim();
  const oid = (environment.REQRO_OPERATOR_IAM_SUBJECT ?? '').trim();
  const origin = (environment.REQRO_OPERATOR_IAM_ORIGIN ?? '').trim();
  const originTenant = (
    environment.REQRO_OPERATOR_IAM_ORIGIN_TENANT_ID ?? ''
  ).trim();
  if (!tenant || !oid || !origin || !originTenant)
    refuse(
      'identity_absent',
      'the trusted identity claims are absent; a serving invocation requires an infrastructure-injected subject and its directory origin',
    );

  // The resolved principal must come from a directory, not from the control
  // plane's own user namespace. An Azure DevOps organization can contain
  // principals whose origin is `vsts` (service accounts, build identities) or
  // `msa` (personal Microsoft accounts); neither is an Entra directory object
  // and neither can be attributed to a named human in the client's tenant.
  if (origin !== ENTRA_DIRECTORY_ORIGIN)
    refuse(
      'identity_origin_untrusted',
      'the resolved principal is not backed by an Entra directory; a serving invocation requires a directory-backed human',
    );

  for (const [value, label] of [
    [tenant, 'the expected Entra tenant identifier'],
    [originTenant, 'the resolved directory tenant identifier'],
    [oid, 'the Entra object identifier'],
  ] as const)
    if (!HYPHENATED_GUID.test(value))
      refuse(
        'identity_malformed',
        `${label} must be a hyphenated GUID; an unhyphenated GUID is refused by the audit schema`,
      );

  // Two independently injected values: the directory this deployment accepts,
  // and the directory the principal was actually resolved from. Requiring
  // equality is what makes a guest, a cross-tenant principal or a
  // mis-targeted control plane fail closed rather than be recorded as a local
  // operator. Compared case-insensitively because GUID casing is not
  // meaningful, then recorded in the resolved casing.
  if (tenant.toLowerCase() !== originTenant.toLowerCase())
    refuse(
      'identity_origin_untrusted',
      'the resolved principal belongs to a different Entra tenant than this deployment expects',
    );

  return {
    issuer: tenant,
    subject: oid,
    displayName: environment.REQRO_OPERATOR_IAM_DISPLAY_NAME,
    email: environment.REQRO_OPERATOR_IAM_EMAIL,
  };
}

/**
 * The Azure DevOps resolution chain, recorded here because the container can
 * only validate the *result* and a reader needs to know what produced it.
 *
 * ADR-029 selects Azure DevOps as the first control plane. An Azure DevOps
 * requesting identity is **not** an Entra object ID, and must never be treated
 * as one. The pipeline resolves it:
 *
 * ```text
 * Azure DevOps requesting identity
 *   -> Azure DevOps Graph user
 *   -> assert subjectKind = user and origin = aad
 *   -> assert originTenantId = the configured Entra tenant
 *   -> originId                      (the Entra object ID)
 *   -> iam:<tenant>/<hyphenated-oid>
 * ```
 *
 * Only the last two values, plus the origin evidence, are injected into the
 * container. `displayName`, `principalName`, `mailAddress` and the Azure
 * DevOps `descriptor` are **not** authoritative and are never the subject:
 * the first three are reassignable, and the descriptor is a control-plane
 * identifier rather than a directory one.
 *
 * {@link entraExecutionClaims} validates that result and fails closed on a
 * non-directory origin or an unexpected tenant. It cannot verify the Graph
 * call happened — that is the pipeline's responsibility, asserted by the
 * pipeline contract test.
 */
export const ENTRA_DIRECTORY_ORIGIN = 'aad';

/** Azure DevOps principal origins that are *not* Entra directory objects and
 * must never reach the identity path. Named so the refusal can be tested
 * against real values rather than an invented one. */
export const NON_DIRECTORY_ORIGINS: readonly string[] = ['vsts', 'msa', 'ghb'];

/** The adapter seam. A second provider adds a function of this shape; nothing
 * else in the operator path changes. */
export type TrustedIdentityAdapter = (
  environment: NodeJS.ProcessEnv,
) => TrustedIdentityClaims;

export const trustedIdentityAdapters: Readonly<
  Record<'entra', TrustedIdentityAdapter>
> = { entra: entraExecutionClaims };

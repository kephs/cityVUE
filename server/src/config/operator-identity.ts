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
  'identity_absent' | 'identity_malformed' | 'identity_unsupported';

export const operatorIdentityFailureCodes: readonly OperatorIdentityFailureCode[] =
  ['identity_absent', 'identity_malformed', 'identity_unsupported'];

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
  if (!tenant || !oid)
    refuse(
      'identity_absent',
      'the trusted identity claims are absent; a serving invocation requires an infrastructure-injected subject',
    );
  for (const [value, label] of [
    [tenant, 'the Entra tenant identifier'],
    [oid, 'the Entra object identifier'],
  ] as const)
    if (!HYPHENATED_GUID.test(value))
      refuse(
        'identity_malformed',
        `${label} must be a hyphenated GUID; an unhyphenated GUID is refused by the audit schema`,
      );
  return {
    issuer: tenant,
    subject: oid,
    displayName: environment.REQRO_OPERATOR_IAM_DISPLAY_NAME,
    email: environment.REQRO_OPERATOR_IAM_EMAIL,
  };
}

/** The adapter seam. A second provider adds a function of this shape; nothing
 * else in the operator path changes. */
export type TrustedIdentityAdapter = (
  environment: NodeJS.ProcessEnv,
) => TrustedIdentityClaims;

export const trustedIdentityAdapters: Readonly<
  Record<'entra', TrustedIdentityAdapter>
> = { entra: entraExecutionClaims };

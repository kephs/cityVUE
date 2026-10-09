import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { refuseOperator as refuse } from './operator-environment.js';

/**
 * ADR-029 F060.3C-2e-2A. The trusted request artifact.
 *
 * **The defect this closes.** Until now `REQRO_OPERATOR_REQUESTER_IDENTITY`
 * was an ordinary environment value, so the operator recording an approval
 * chose who the requester was. The database enforces
 * `requested_by <> approved_by` and the permission model keeps request and
 * approve mutually exclusive, so two humans were still structurally required —
 * but the *recorded requester* was whatever the approver typed. An approval
 * could name a requester who never requested, and the audit trail would show a
 * two-person flow that never happened. That is an attribution-integrity
 * defect, and this module removes the free field entirely.
 *
 * **How it works.** The request (dry-run) invocation emits an artifact that
 * binds the requester's resolved identity to the exact operation context. The
 * approval invocation is handed that artifact and derives the requester and
 * the context *from it*. The approver cannot override any of those fields —
 * supplying them is refused, not merged.
 *
 * **Integrity.** The artifact's canonical bytes are hashed, and the digest
 * travels through the **trusted execution channel** while the content travels
 * as a file. The container recomputes the digest and refuses on mismatch. So
 * substituting the artifact requires also controlling the trusted channel,
 * which is the same boundary every other trusted field already relies on. No
 * signing key is introduced, because a key would need storing, rotating and
 * protecting to buy a property the trusted channel already provides. The
 * canonical form is defined here precisely so a future deployment can sign it
 * instead without changing what is signed.
 *
 * **No database request table.** The artifact is deliberately not persisted by
 * Reqro. Approval consumption is still guarded by the existing
 * `tenant_domain_operator_approval` row and its context checks; this contract
 * governs how the *approval* is populated, and adds no schema.
 */

/** The artifact format version. A reader refuses a version it does not know
 * rather than guessing which fields are present. */
export const REQUEST_ARTIFACT_VERSION = 1;

/** The longest an artifact may remain usable, regardless of what it claims.
 * A request older than this must be re-planned against current registry
 * state, because the expected revision it carries is no longer evidence. */
export const MAXIMUM_REQUEST_LIFETIME_MINUTES = 240;

/**
 * The provider-neutral artifact.
 *
 * Every field is required except `role` and `ticket`, which are meaningful
 * only for some operations; both are explicitly `null` rather than absent, so
 * the canonical form has a fixed shape and a missing field can never be
 * confused with an intentionally empty one.
 */
export interface TrustedRequestArtifact {
  readonly version: number;
  /** The requester's resolved canonical identity, `iam:<tenant>/<oid>`. */
  readonly requesterIdentity: string;
  /** The operator verb this request is for. */
  readonly operation: string;
  readonly organizationId: string;
  readonly hostname: string;
  /** The tenant-domain role, for `register` only; otherwise null. */
  readonly role: string | null;
  readonly expectedRevision: number;
  readonly reason: string;
  /** The change-management ticket, when the deployment records one. */
  readonly ticket: string | null;
  readonly correlationId: string;
  /** Provenance of the code that produced the request. */
  readonly commitSha: string;
  readonly imageDigest: string;
  /** The control-plane run that produced it. */
  readonly jobRunId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

/** The field order of the canonical form. Fixed and explicit: relying on
 * object key order would make the digest depend on how the object was built. */
export const CANONICAL_REQUEST_FIELDS = [
  'version',
  'requesterIdentity',
  'operation',
  'organizationId',
  'hostname',
  'role',
  'expectedRevision',
  'reason',
  'ticket',
  'correlationId',
  'commitSha',
  'imageDigest',
  'jobRunId',
  'createdAt',
  'expiresAt',
] as const;

/**
 * The canonical byte form that is hashed.
 *
 * A fixed field order, `JSON.stringify` for each value so strings are escaped
 * exactly once, and a newline terminator per field so no concatenation of two
 * values can collide with a different split of the same bytes.
 */
export function canonicalRequestBytes(
  artifact: TrustedRequestArtifact,
): string {
  const record = artifact as unknown as Record<string, unknown>;
  return CANONICAL_REQUEST_FIELDS.map(
    (field) => `${field}=${JSON.stringify(record[field] ?? null)}\n`,
  ).join('');
}

/** `sha256:<64 hex>` over the canonical bytes, matching the shape the
 * provenance fields already use so one digest format appears in the contract. */
export function requestArtifactDigest(
  artifact: TrustedRequestArtifact,
): string {
  return `sha256:${createHash('sha256')
    .update(canonicalRequestBytes(artifact), 'utf8')
    .digest('hex')}`;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY = /^iam:[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$/;
const COMMIT_SHA = /^[0-9a-f]{40}$/;
const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,190}$/;

function text(value: unknown, label: string, limit = 400): string {
  if (typeof value !== 'string' || value.trim() === '')
    refuse(
      'request_artifact_invalid',
      `the request artifact field ${label} is absent or not a string`,
    );
  const trimmed = value.trim();
  if (trimmed.length > limit)
    refuse(
      'request_artifact_invalid',
      `the request artifact field ${label} exceeds its length limit`,
    );
  return trimmed;
}

function optional(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function instant(value: unknown, label: string): Date {
  const when = new Date(text(value, label, 40));
  if (Number.isNaN(when.getTime()))
    refuse(
      'request_artifact_invalid',
      `the request artifact field ${label} is not a valid ISO-8601 instant`,
    );
  return when;
}

/**
 * Parses, integrity-checks and expiry-checks an artifact.
 *
 * The digest is verified **before** any field is trusted, and the digest is
 * recomputed from the parsed-and-normalized artifact rather than from the raw
 * file bytes. That is deliberate: hashing the raw bytes would let two
 * different files with equivalent JSON produce different digests, and would
 * let unexpected extra keys ride along unnoticed. Hashing the canonical form
 * means the digest covers exactly the fields the contract defines, and nothing
 * else in the file can influence behaviour.
 */
export function readRequestArtifact(
  contents: string,
  expectedDigest: string,
  now: Date,
): TrustedRequestArtifact {
  if (!DIGEST.test(expectedDigest))
    refuse(
      'request_artifact_invalid',
      'the expected request artifact digest is not a sha256 digest',
    );

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    refuse(
      'request_artifact_invalid',
      'the request artifact is not valid JSON',
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    refuse('request_artifact_invalid', 'the request artifact is not an object');
  const raw = parsed as Record<string, unknown>;

  if (raw.version !== REQUEST_ARTIFACT_VERSION)
    refuse(
      'request_artifact_invalid',
      'the request artifact version is not supported',
    );

  const revision = raw.expectedRevision;
  if (
    typeof revision !== 'number' ||
    !Number.isInteger(revision) ||
    revision < 0
  )
    refuse(
      'request_artifact_invalid',
      'the request artifact expectedRevision is not a non-negative integer',
    );

  const artifact: TrustedRequestArtifact = {
    version: REQUEST_ARTIFACT_VERSION,
    requesterIdentity: text(raw.requesterIdentity, 'requesterIdentity'),
    operation: text(raw.operation, 'operation', 40),
    organizationId: text(raw.organizationId, 'organizationId', 40),
    hostname: text(raw.hostname, 'hostname', 255),
    role: optional(raw.role, 'role'),
    expectedRevision: revision,
    reason: text(raw.reason, 'reason'),
    ticket: optional(raw.ticket, 'ticket'),
    correlationId: text(raw.correlationId, 'correlationId', 40),
    commitSha: text(raw.commitSha, 'commitSha', 40),
    imageDigest: text(raw.imageDigest, 'imageDigest', 80),
    jobRunId: text(raw.jobRunId, 'jobRunId'),
    createdAt: text(raw.createdAt, 'createdAt', 40),
    expiresAt: text(raw.expiresAt, 'expiresAt', 40),
  };

  if (requestArtifactDigest(artifact) !== expectedDigest)
    refuse(
      'request_artifact_invalid',
      'the request artifact does not match its expected digest; it was substituted or modified',
    );

  // Shape checks come after the digest, so a tampered artifact is reported as
  // tampered rather than as malformed.
  if (!IDENTITY.test(artifact.requesterIdentity))
    refuse(
      'request_artifact_invalid',
      'the request artifact requester identity is not a canonical iam identity',
    );
  if (!UUID.test(artifact.organizationId) || !UUID.test(artifact.correlationId))
    refuse(
      'request_artifact_invalid',
      'the request artifact organization or correlation identifier is not a UUID',
    );
  if (
    !COMMIT_SHA.test(artifact.commitSha) ||
    !DIGEST.test(artifact.imageDigest)
  )
    refuse(
      'request_artifact_invalid',
      'the request artifact provenance is not a full commit SHA and an immutable image digest',
    );
  if (!OPAQUE.test(artifact.jobRunId))
    refuse(
      'request_artifact_invalid',
      'the request artifact job run identifier is not a plain opaque identifier',
    );

  const createdAt = instant(artifact.createdAt, 'createdAt');
  const expiresAt = instant(artifact.expiresAt, 'expiresAt');
  if (expiresAt.getTime() <= createdAt.getTime())
    refuse(
      'request_artifact_expired',
      'the request artifact expires before it was created',
    );
  if (
    expiresAt.getTime() - createdAt.getTime() >
    MAXIMUM_REQUEST_LIFETIME_MINUTES * 60_000
  )
    refuse(
      'request_artifact_expired',
      `the request artifact lifetime exceeds the ${String(MAXIMUM_REQUEST_LIFETIME_MINUTES)}-minute maximum`,
    );
  if (expiresAt.getTime() <= now.getTime())
    refuse(
      'request_artifact_expired',
      'the request artifact has expired; re-plan the request against current registry state',
    );

  return artifact;
}

/** Loads the artifact named by the trusted channel. The path is
 * infrastructure-injected, never an operator argument. */
export function loadRequestArtifact(
  path: string,
  expectedDigest: string,
  now: Date,
): TrustedRequestArtifact {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    refuse(
      'request_artifact_invalid',
      'the request artifact could not be read from the path the platform supplied',
    );
  }
  return readRequestArtifact(contents, expectedDigest, now);
}

/**
 * Binds the approval to the artifact.
 *
 * The approver's invocation must be *for* the request that was planned. This
 * refuses a context substitution — approving a different Organization,
 * hostname, revision or operation than the one the requester planned — which
 * is the attack the digest alone does not prevent, because a valid artifact
 * for one change could otherwise be presented while approving another.
 */
export function assertRequestContext(
  artifact: TrustedRequestArtifact,
  context: {
    readonly operation: string;
    readonly organizationId: string;
    readonly hostname: string;
    readonly expectedRevision: number;
  },
): void {
  const mismatched =
    artifact.operation !== context.operation ||
    artifact.organizationId !== context.organizationId ||
    artifact.hostname.toLowerCase() !== context.hostname.toLowerCase() ||
    artifact.expectedRevision !== context.expectedRevision;
  if (mismatched)
    refuse(
      'request_context_mismatch',
      'the approval context does not match the request artifact; a request may only be approved for exactly what was planned',
    );
}

/**
 * Refuses an approver who is also the requester.
 *
 * Third independent control over the same property, after the mutually
 * exclusive IAM assignment and Migration 47's `requested_by <> approved_by`
 * check. It exists here because this is the first point at which both
 * identities are known to be *real* — the requester's now comes from the
 * artifact rather than from the approver's keyboard.
 */
export function assertIndependentApprover(
  artifact: TrustedRequestArtifact,
  approverIdentity: string,
): void {
  if (artifact.requesterIdentity === approverIdentity)
    refuse(
      'self_approval',
      'the approving operator is the requester named by the request artifact',
    );
}

/** Builds the artifact a request invocation emits. Exported so the request
 * path and the tests construct it the same way. */
export function buildRequestArtifact(input: {
  readonly requesterIdentity: string;
  readonly operation: string;
  readonly organizationId: string;
  readonly hostname: string;
  readonly role: string | null;
  readonly expectedRevision: number;
  readonly reason: string;
  readonly ticket: string | null;
  readonly correlationId: string;
  readonly commitSha: string;
  readonly imageDigest: string;
  readonly jobRunId: string;
  readonly createdAt: Date;
  readonly lifetimeMinutes: number;
}): { artifact: TrustedRequestArtifact; digest: string } {
  if (
    !Number.isInteger(input.lifetimeMinutes) ||
    input.lifetimeMinutes < 1 ||
    input.lifetimeMinutes > MAXIMUM_REQUEST_LIFETIME_MINUTES
  )
    refuse(
      'request_artifact_invalid',
      `the request artifact lifetime must be between 1 and ${String(MAXIMUM_REQUEST_LIFETIME_MINUTES)} minutes`,
    );
  const artifact: TrustedRequestArtifact = {
    version: REQUEST_ARTIFACT_VERSION,
    requesterIdentity: input.requesterIdentity,
    operation: input.operation,
    organizationId: input.organizationId,
    hostname: input.hostname,
    role: input.role,
    expectedRevision: input.expectedRevision,
    reason: input.reason,
    ticket: input.ticket,
    correlationId: input.correlationId,
    commitSha: input.commitSha,
    imageDigest: input.imageDigest,
    jobRunId: input.jobRunId,
    createdAt: input.createdAt.toISOString(),
    expiresAt: new Date(
      input.createdAt.getTime() + input.lifetimeMinutes * 60_000,
    ).toISOString(),
  };
  return { artifact, digest: requestArtifactDigest(artifact) };
}

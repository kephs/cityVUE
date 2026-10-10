/**
 * F062.1 — the provider-neutral integration envelope.
 *
 * **This slice is deliberately inert.** It defines contracts and nothing else:
 * no transport, no persistence, no credential, no network access and no
 * connector implementation. The boundary suite asserts that structurally.
 *
 * **Two contract kinds, and conflating them is a correctness bug** (F062 §3.2).
 * An `event` asserts that something happened at a revision and must be
 * reconstructable as of that revision; a `state_sync` intent asks a
 * destination to converge on what is true *now* and is legitimately projected
 * at attempt time. A replay of an `event` re-sends what was true then. A
 * re-dispatch of a `state_sync` intent is **re-synchronization, not replay**,
 * and must never be described as one.
 *
 * **Delivery is at-least-once with idempotent processing.** Nothing here
 * claims exactly-once distributed execution, because that is not achievable
 * against a system Reqro does not control. Duplicates are expected, which is
 * why consumers deduplicate on `integrationId`.
 *
 * **Bounded metadata only.** Every field below is an identifier, a closed
 * vocabulary member, an integer or a timestamp. Resident PII, secrets,
 * tracking credentials, raw vendor error bodies and free-form or unbounded
 * status text are refused by {@link assertEnvelopeMetadataBounded} and are
 * structurally absent from the type.
 */

/** Immutable business fact versus desired-state intent. Declared per
 * {@link IntegrationType}, never inferred from the payload. */
export const contractKinds = ['event', 'state_sync'] as const;
export type ContractKind = (typeof contractKinds)[number];

/** Neutral aggregate vocabulary. A vendor resource name never appears here;
 * `work_item` is Reqro's abstraction, and a connector maps it to whatever its
 * destination calls that concept. */
export const aggregateTypes = [
  'service_request',
  'work_item',
  'attachment',
] as const;
export type AggregateType = (typeof aggregateTypes)[number];

/**
 * The closed integration vocabulary, and each entry's contract kind.
 *
 * Additive: new entries may be added. **A existing entry's meaning may never
 * change** — a changed meaning under an unchanged name is the one evolution
 * failure no consumer can defend against (F062 Part 7).
 *
 * `contractKind` is data here precisely so it cannot be inferred, guessed or
 * varied per call site.
 */
export const INTEGRATION_TYPES = {
  'service_request.submitted': {
    kind: 'event',
    aggregate: 'service_request',
    schemaVersion: 1,
  },
  'service_request.status_changed': {
    kind: 'event',
    aggregate: 'service_request',
    schemaVersion: 1,
  },
  'service_request.closed': {
    kind: 'event',
    aggregate: 'service_request',
    schemaVersion: 1,
  },
  'work_item.assigned': {
    kind: 'event',
    aggregate: 'work_item',
    schemaVersion: 1,
  },
  /** Desired-state: converge the destination on current approved state. */
  'work_item.sync_requested': {
    kind: 'state_sync',
    aggregate: 'work_item',
    schemaVersion: 1,
  },
} as const satisfies Record<
  string,
  {
    readonly kind: ContractKind;
    readonly aggregate: AggregateType;
    readonly schemaVersion: number;
  }
>;

export type IntegrationType = keyof typeof INTEGRATION_TYPES;

export const integrationTypes = Object.keys(
  INTEGRATION_TYPES,
) as readonly IntegrationType[];

export function isIntegrationType(value: string): value is IntegrationType {
  return Object.hasOwn(INTEGRATION_TYPES, value);
}

/** The contract kind declared for a type. Total over the vocabulary, so a
 * caller cannot supply its own answer. */
export function contractKindOf(type: IntegrationType): ContractKind {
  return INTEGRATION_TYPES[type].kind;
}

/**
 * Who authored the fact.
 *
 * `reqro` means Reqro authored it. `external` means it was mirrored inward
 * from the named connector, and is the input to loop prevention (F062 §9.3).
 *
 * **`origin` is loop-prevention evidence, not authorization.** It records who
 * is speaking; whether that speaker may assert a given fact is a separate
 * question answered only by the fact-authority contract.
 */
export type EventOrigin =
  | { readonly kind: 'reqro' }
  | { readonly kind: 'external'; readonly connectorId: string };

/** Closed failure taxonomy, mirroring the notification taxonomy ADR-026
 * established so adapters never invent their own vocabulary. */
export const integrationFailureCategories = [
  'destination_unavailable',
  'destination_timeout',
  'destination_rejected',
  'rate_limited',
  'authentication_failed',
  'destination_unconfigured',
  'projection_failed',
  'contract_unsupported',
  'malformed_request',
  'internal_failure',
] as const;
export type IntegrationFailureCategory =
  (typeof integrationFailureCategories)[number];

/**
 * Categories that may be retried.
 *
 * `destination_timeout` is **deliberately absent**: a timeout is ambiguous,
 * not transient, because the mutation may already have taken effect. It
 * resolves through {@link DeliveryOutcome} `ambiguous`, never through a blind
 * retry. ADR-026 made the same choice for `provider_timeout`, and the stakes
 * are higher here — a duplicated work item can reach a crew.
 */
export const transientIntegrationFailures: readonly IntegrationFailureCategory[] =
  ['destination_unavailable', 'rate_limited'] as const;

export function isTransientIntegrationFailure(
  category: IntegrationFailureCategory,
): boolean {
  return transientIntegrationFailures.includes(category);
}

/**
 * The envelope. Immutable once created.
 *
 * Delivery-attempt metadata is deliberately **not** here: attempt counts,
 * timestamps, failure categories and backoff state describe the plumbing, not
 * the business fact, and putting them here would make the envelope mutable —
 * which would destroy the one property an `event` depends on. One envelope
 * also fans out to several connectors whose attempt histories differ.
 */
export interface IntegrationEnvelope {
  /** The identity consumers deduplicate on. */
  readonly integrationId: string;
  readonly type: IntegrationType;
  readonly contractKind: ContractKind;
  readonly schemaVersion: number;
  /** Immutable tenancy, captured when the fact occurred. Never re-derived
   * from hostname, deployment state, retry context or an inbound payload. */
  readonly organizationId: string;
  /** The serving authority that produced it, so a staging envelope cannot be
   * accepted by a production connector. */
  readonly deploymentEnvironment: string;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  /** Per-aggregate sequence. Pins which version the intent was formed
   * against; null only where the aggregate has no revision concept. */
  readonly aggregateRevision: number | null;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly correlationId: string;
  /** The envelope or inbound-delivery identity that caused this one. */
  readonly causationId: string | null;
  readonly origin: EventOrigin;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Deliberately narrow: no whitespace, no separators that could confuse a
 * downstream log or a routing key. */
const CONNECTOR_ID = /^[a-z][a-z0-9-]{2,62}$/;
const ENVIRONMENT = /^[a-z][a-z0-9-]{2,30}$/;

export type EnvelopeRefusalCode =
  | 'type_unknown'
  | 'contract_kind_mismatch'
  | 'identifier_invalid'
  | 'revision_invalid'
  | 'timestamp_invalid'
  | 'origin_invalid'
  | 'metadata_unbounded';

export class EnvelopeRefusal extends Error {
  constructor(
    readonly code: EnvelopeRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'EnvelopeRefusal';
  }
}

function refuse(code: EnvelopeRefusalCode, message: string): never {
  throw new EnvelopeRefusal(code, message);
}

function instantOf(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed))
    refuse('timestamp_invalid', `${label} is not a valid ISO-8601 instant`);
  return parsed;
}

/**
 * Field names that must never appear as envelope metadata, matched as
 * substrings and case-insensitively. The envelope type makes them impossible
 * in typed code; this guards the boundary where an envelope is parsed from
 * JSON, which a later slice will need.
 */
export const PROHIBITED_ENVELOPE_FIELDS: readonly string[] = [
  'name',
  'email',
  'mail',
  'phone',
  'address',
  'contact',
  'requester',
  'password',
  'secret',
  'token',
  'credential',
  'authorization',
  'apikey',
  'api_key',
  'tracking',
  'vendorerror',
  'vendor_error',
  'rawerror',
  'raw_error',
  'stack',
  'note',
  'notes',
  'comment',
  'message',
  'description',
  'statustext',
  'status_text',
  'payload',
  'body',
];

/**
 * Refuses an envelope-shaped object carrying prohibited or unbounded
 * metadata.
 *
 * Why a free-text prohibition and not just "no PII": an unbounded status or
 * note field is unsanitisable, is a path for staff free text to leave the
 * boundary unreviewed, and defeats bounded telemetry. `description` and
 * `message` are refused for exactly that reason even though neither is PII by
 * name.
 */
export function assertEnvelopeMetadataBounded(candidate: unknown): void {
  if (typeof candidate !== 'object' || candidate === null) return;
  const seen = new Set<unknown>();
  const walk = (value: unknown): void => {
    if (typeof value !== 'object' || value === null) return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      const lowered = key.toLowerCase();
      for (const prohibited of PROHIBITED_ENVELOPE_FIELDS)
        if (lowered === prohibited || lowered.endsWith(prohibited))
          refuse(
            'metadata_unbounded',
            'the envelope carries a prohibited or unbounded metadata field',
          );
      walk(nested);
    }
  };
  walk(candidate);
}

/**
 * Validates an envelope.
 *
 * The declared `contractKind` and `schemaVersion` must match what the
 * vocabulary declares for the type. A caller cannot relabel an immutable
 * event as a state-sync intent, which is the misuse §3.2 exists to prevent.
 */
export function assertEnvelope(envelope: IntegrationEnvelope): void {
  if (!isIntegrationType(envelope.type))
    refuse('type_unknown', 'the integration type is not in the vocabulary');
  const declared = INTEGRATION_TYPES[envelope.type];

  if (envelope.contractKind !== declared.kind)
    refuse(
      'contract_kind_mismatch',
      'the declared contract kind does not match the vocabulary for this type',
    );
  if (envelope.aggregateType !== declared.aggregate)
    refuse(
      'contract_kind_mismatch',
      'the aggregate type does not match the vocabulary for this type',
    );
  if (envelope.schemaVersion !== declared.schemaVersion)
    refuse(
      'contract_kind_mismatch',
      'the schema version does not match the version declared for this type',
    );

  for (const [value, label] of [
    [envelope.integrationId, 'integrationId'],
    [envelope.organizationId, 'organizationId'],
    [envelope.aggregateId, 'aggregateId'],
    [envelope.correlationId, 'correlationId'],
  ] as const)
    if (!UUID.test(value))
      refuse('identifier_invalid', `${label} must be a hyphenated UUID`);
  if (envelope.causationId !== null && !UUID.test(envelope.causationId))
    refuse('identifier_invalid', 'causationId must be a hyphenated UUID');
  if (!ENVIRONMENT.test(envelope.deploymentEnvironment))
    refuse('identifier_invalid', 'deploymentEnvironment is not a plain label');

  if (
    envelope.aggregateRevision !== null &&
    (!Number.isInteger(envelope.aggregateRevision) ||
      envelope.aggregateRevision < 0)
  )
    refuse(
      'revision_invalid',
      'aggregateRevision must be a non-negative integer or null',
    );

  // An immutable event must be reconstructable as of a revision, so it cannot
  // be revisionless. A state-sync intent needs no revision, because its
  // meaning is "whatever is true now".
  if (declared.kind === 'event' && envelope.aggregateRevision === null)
    refuse(
      'revision_invalid',
      'an immutable event requires an aggregate revision so it can be reconstructed as of that revision',
    );

  const occurred = instantOf(envelope.occurredAt, 'occurredAt');
  const recorded = instantOf(envelope.recordedAt, 'recordedAt');
  if (recorded < occurred)
    refuse(
      'timestamp_invalid',
      'recordedAt precedes occurredAt; a fact cannot be recorded before it happened',
    );

  // Read widened, so an origin parsed from JSON with an unknown kind is
  // refused rather than narrowed away by the compiler at the type level.
  const originKind: string = envelope.origin.kind;
  if (originKind === 'external') {
    const { connectorId } = envelope.origin as { readonly connectorId: string };
    if (!CONNECTOR_ID.test(connectorId))
      refuse('origin_invalid', 'the external origin connector id is invalid');
  } else if (originKind !== 'reqro')
    refuse('origin_invalid', 'the envelope origin is not a known origin kind');

  assertEnvelopeMetadataBounded(envelope);
}

/**
 * Whether re-dispatching this envelope may be called a **replay**.
 *
 * Only an immutable event can be replayed, and a replay reproduces the
 * original intent — including its schema version. Re-dispatching a state-sync
 * intent is re-synchronization: it legitimately sends newer data, which is
 * correct behaviour for that contract and would be a correctness bug if
 * called a replay.
 */
export function isReplayable(envelope: IntegrationEnvelope): boolean {
  return envelope.contractKind === 'event';
}

/**
 * The schema version a re-dispatch must use.
 *
 * A replayed event keeps the version recorded on the envelope, never today's
 * newest, because the point of a replay is to reproduce the original
 * integration intent. A state-sync re-dispatch uses the current declared
 * version, because its meaning is current state.
 */
export function redispatchSchemaVersion(envelope: IntegrationEnvelope): number {
  return envelope.contractKind === 'event'
    ? envelope.schemaVersion
    : INTEGRATION_TYPES[envelope.type].schemaVersion;
}

import {
  type AggregateType,
  type ContractKind,
  type EventOrigin,
  INTEGRATION_TYPES,
  type IntegrationType,
  contractKindOf,
  isIntegrationType,
} from '../integration-envelope.js';

/**
 * F062.2C — the transactional outbox domain contract.
 *
 * **NO EXTERNAL DELIVERY IS ENABLED BY THIS SLICE.** There is no worker, no
 * claiming, no retry, no dead-letter handling, no transport and no connector
 * invocation. An intent is a durable row; nothing reads it to dispatch.
 *
 * **Vocabularies are F062.1's, re-derived rather than copied.** The contract
 * kind, aggregate type and schema version for a given integration type are
 * read from `INTEGRATION_TYPES`, so a caller cannot supply its own pairing and
 * a change there is a compile or test failure here rather than a silent
 * divergence between the schema and the contract.
 *
 * **Deliberately absent from `src/integration/index.ts`**, like the rest of
 * persistence, so F062.1's empty-external-import proof stays intact.
 */

/**
 * The payload modes F062.2A defines.
 *
 * Only `current_state_projection` is reachable. `historical_reference` is
 * refused because no declared event type has proven historical
 * reconstructability, and `approved_snapshot` is refused because snapshot
 * retention is unapproved — it is the one mode that would put business data,
 * and therefore potentially resident PII, into an integration table. Both
 * refusals are enforced by named database constraints; these constants exist
 * so the policy is also assertable in TypeScript.
 */
export const payloadModes = [
  'historical_reference',
  'approved_snapshot',
  'current_state_projection',
] as const;
export type PayloadMode = (typeof payloadModes)[number];

/** The modes a reviewed migration has authorized. Exactly one, and widening
 * it requires changing a named constraint, which requires naming the
 * evidence. */
export const enqueueablePayloadModes: readonly PayloadMode[] = [
  'current_state_projection',
];

export function isEnqueueablePayloadMode(mode: PayloadMode): boolean {
  return enqueueablePayloadModes.includes(mode);
}

/**
 * The payload mode a contract kind requires.
 *
 * Total over `ContractKind`, so the mapping cannot be partially applied. An
 * `event` needs a historical basis, which is precisely what is unavailable —
 * so this returns the mode an event *would* need rather than one that works,
 * and {@link assertEnqueueable} then refuses it.
 */
export function requiredPayloadMode(kind: ContractKind): PayloadMode {
  return kind === 'state_sync'
    ? 'current_state_projection'
    : 'historical_reference';
}

/** The only delivery state an intent may begin in. A caller never chooses
 * one; the database forces it. */
export const INITIAL_DELIVERY_STATE = 'pending' as const;

/** The closed refusal vocabulary. Every rejection is one of these. */
export const outboxRefusals = [
  'integration_type_unknown',
  'contract_kind_mismatch',
  'aggregate_mismatch',
  'schema_version_mismatch',
  'aggregate_revision_required',
  'payload_mode_unavailable',
  'payload_mode_mismatch',
  'origin_invalid',
  'environment_invalid',
  'connector_unknown',
  'connector_retired',
  'connector_revision_stale',
  'intent_duplicate',
  'delivery_state_not_caller_controlled',
] as const;
export type OutboxRefusalCode = (typeof outboxRefusals)[number];

/**
 * A bounded refusal.
 *
 * As in F062.2B, `connector_unknown` covers both "no such connector" and
 * "belongs to another Organization", so an error cannot confirm that another
 * tenant's connector exists.
 */
export class OutboxRefusal extends Error {
  constructor(
    readonly code: OutboxRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'OutboxRefusal';
  }
}

function refuse(code: OutboxRefusalCode, message: string): never {
  throw new OutboxRefusal(code, message);
}

/** Matches F062.1's `ENVIRONMENT`, so a value the contract layer would refuse
 * cannot be stored. */
const ENVIRONMENT = /^[a-z][a-z0-9-]{2,30}$/;

/**
 * What a caller supplies to enqueue an intent.
 *
 * `contractKind`, `aggregateType` and `schemaVersion` are deliberately **not**
 * accepted: they are derived from `INTEGRATION_TYPES`, so a caller cannot
 * relabel an immutable event as current-state synchronization. `state` is not
 * accepted either — the initial state is not a caller's choice.
 */
export interface EnqueueIntentInput {
  readonly organizationId: string;
  readonly connectorId: string;
  readonly integrationId: string;
  readonly integrationType: IntegrationType;
  readonly aggregateId: string;
  readonly aggregateRevision: number | null;
  readonly origin: EventOrigin;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly deploymentEnvironment: string;
  readonly occurredAt: Date;
}

/** An intent as stored. No payload, no business data, no vendor text. */
export interface IntegrationIntent {
  readonly id: string;
  readonly organizationId: string;
  readonly connectorId: string;
  readonly integrationId: string;
  readonly integrationType: IntegrationType;
  readonly contractKind: ContractKind;
  readonly aggregateType: AggregateType;
  readonly aggregateId: string;
  readonly aggregateRevision: number | null;
  readonly schemaVersion: number;
  readonly payloadMode: PayloadMode;
  readonly pinnedConnectorConfigurationRevision: number;
  readonly state: typeof INITIAL_DELIVERY_STATE;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly occurredAt: Date;
}

/** The contract facts a type declares, read from F062.1 rather than supplied
 * or restated. */
export interface ResolvedIntentContract {
  readonly contractKind: ContractKind;
  readonly aggregateType: AggregateType;
  readonly schemaVersion: number;
  readonly payloadMode: PayloadMode;
}

/**
 * Resolves and validates an intent against F062.1, refusing anything the
 * contract or the current payload-mode policy does not allow.
 *
 * The order matters: an unknown type is refused before anything is derived
 * from it, and the payload-mode refusal comes last so a caller learns that its
 * *type* is fine and its *mode* is unavailable rather than receiving a generic
 * rejection.
 */
export function assertEnqueueable(
  input: EnqueueIntentInput,
): ResolvedIntentContract {
  if (!isIntegrationType(input.integrationType))
    refuse(
      'integration_type_unknown',
      'the integration type is not in the F062.1 vocabulary',
    );

  const declared = INTEGRATION_TYPES[input.integrationType];
  const contractKind = contractKindOf(input.integrationType);
  const payloadMode = requiredPayloadMode(contractKind);

  if (!ENVIRONMENT.test(input.deploymentEnvironment))
    refuse(
      'environment_invalid',
      'the deployment environment does not match the required grammar',
    );

  if (input.origin.kind === 'external' && input.origin.connectorId.length === 0)
    refuse('origin_invalid', 'an external origin must name its connector');

  // An immutable event asserts something happened at a revision, so it cannot
  // be formed without one. F062.1 refuses the same envelope.
  if (contractKind === 'event' && input.aggregateRevision === null)
    refuse(
      'aggregate_revision_required',
      'an immutable event must pin the aggregate revision it occurred at',
    );

  if (!isEnqueueablePayloadMode(payloadMode))
    refuse(
      'payload_mode_unavailable',
      `the payload mode this contract kind requires is not authorized: ${payloadMode}`,
    );

  return {
    contractKind,
    aggregateType: declared.aggregate,
    schemaVersion: declared.schemaVersion,
    payloadMode,
  };
}

/** The integration types that can currently be enqueued at all: those whose
 * contract kind requires an authorized payload mode. Derived, never listed, so
 * it cannot disagree with the policy above. */
export function enqueueableIntegrationTypes(): readonly IntegrationType[] {
  return (Object.keys(INTEGRATION_TYPES) as IntegrationType[]).filter((type) =>
    isEnqueueablePayloadMode(requiredPayloadMode(contractKindOf(type))),
  );
}

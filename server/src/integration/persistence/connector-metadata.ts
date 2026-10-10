import {
  type ConnectorCapabilities,
  type ConnectorOperation,
  connectorOperations,
  NO_CAPABILITIES,
  orderingGuarantees,
  sideEffectRisks,
} from '../connector-capabilities.js';
import {
  type ConnectorLifecycleState,
  connectorLifecycleStates,
} from '../delivery-contract.js';

/**
 * F062.2B — connector metadata domain contract.
 *
 * **This module and its repository are deliberately absent from
 * `src/integration/index.ts`.** F062.1's boundary suite resolves the module
 * graph from that entry point and asserts the external import set is exactly
 * empty; persistence necessarily imports Kysely and Nest. Keeping it out of
 * the entry point preserves that proof rather than weakening it, and the
 * dependency runs one way only: persistence imports the contracts, and no
 * contract module imports persistence.
 *
 * **Nothing here enables integration traffic.** No transport, no HTTP client,
 * no credential resolution, no outbox, no delivery attempt and no worker. A
 * connector row declares that a destination exists and what it can do; nothing
 * reads it to dispatch, because no dispatch code exists.
 *
 * **The vocabularies are F062.1's, not copies.** Lifecycle states, operations,
 * ordering guarantees and side-effect risks are imported and re-derived from
 * the contract module, so a rename there is a compile error here and the
 * database check constraints have exactly one source of truth.
 */

/**
 * The provider-neutral capability profile a connector row declares.
 *
 * **A profile, never a vendor product.** It describes the shape of a
 * destination's integration surface; which product a deployment points at is
 * deployment configuration, and encoding it here would put a vendor identity
 * in Reqro's core domain model.
 */
export const connectorKinds = [
  'loopback',
  'work_management',
  'asset_management',
  'service_request_exchange',
] as const;
export type ConnectorKind = (typeof connectorKinds)[number];

export function isConnectorKind(value: string): value is ConnectorKind {
  return (connectorKinds as readonly string[]).includes(value);
}

/** Why a revision exists, or why an audited change advanced nothing. */
export const connectorChangeCategories = [
  'registered',
  'lifecycle_changed',
  'capabilities_changed',
  'credential_reference_rotated',
] as const;
export type ConnectorChangeCategory =
  (typeof connectorChangeCategories)[number];

/**
 * The categories that advance `configuration_revision`.
 *
 * A credential rotation is deliberately excluded. That revision pins the
 * *semantics* a dispatch was formed against (F062.2A §9.2), and a rotation
 * changes no semantics — so advancing it would leave every pinned revision
 * aimed at a superseded row for no gain, while telling an operator that
 * behaviour changed when it did not.
 *
 * **Every category advances `record_revision`**, which is why that is the
 * concurrency token and this one is not. A rotation is semantically inert but
 * it is still a mutation, and two concurrent rotations must not be able to
 * satisfy the same expected-revision predicate.
 */
export function advancesConfigurationRevision(
  category: ConnectorChangeCategory,
): boolean {
  return category !== 'credential_reference_rotated';
}

/** Every accepted mutation advances the record revision, without exception.
 * Expressed as a function so the rule is callable and assertable rather than
 * only implied by its absence. */
export function advancesRecordRevision(
  category: ConnectorChangeCategory,
): boolean {
  void category;
  return true;
}

/** Matches F062.1's `CONNECTOR_ID` grammar and the database check, so a key
 * the contract layer would refuse cannot be stored. */
const CONNECTOR_KEY = /^[a-z][a-z0-9-]{2,62}$/;

/**
 * The grammar for a credential **reference**.
 *
 * **`credential_reference` is non-secret metadata by contract, not by
 * detection.** This slice never resolves it, never interprets it as credential
 * material, never reads a secret and never authenticates. No regular
 * expression can decide whether a string is secret, and these constraints
 * must not be read as claiming to: they bound the field to a short, opaque,
 * URL-free, whitespace-free token so an obvious accidental paste is refused
 * at the boundary. That is **defence-in-depth against accidental misuse**.
 *
 * The future secret-management architecture owns the reference namespace and
 * the rules for resolving it.
 */
const CREDENTIAL_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._/-]{2,199}$/;
const SECRET_SHAPED = /[A-Za-z0-9+/=]{32,}/;

/** The closed refusal vocabulary. Every rejection is one of these, so a caller
 * branches on a bounded value rather than parsing a message. */
export const connectorMetadataRefusals = [
  'connector_unknown',
  'connector_key_invalid',
  'connector_key_duplicate',
  'connector_kind_invalid',
  'capability_contract_invalid',
  'credential_reference_invalid',
  'lifecycle_transition_unsupported',
  'revision_stale',
  'organization_unavailable',
  'change_not_permitted',
] as const;
export type ConnectorMetadataRefusalCode =
  (typeof connectorMetadataRefusals)[number];

/**
 * A bounded refusal.
 *
 * **The message never names another Organization's data.** `connector_unknown`
 * covers both "no such connector" and "that connector belongs to someone
 * else", deliberately: distinguishing them would confirm the existence of
 * another tenant's connector to a caller who may not know it exists. The
 * database enforces the same boundary structurally; this keeps the error
 * surface from leaking what the constraints protect.
 */
export class ConnectorMetadataRefusal extends Error {
  constructor(
    readonly code: ConnectorMetadataRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = 'ConnectorMetadataRefusal';
  }
}

function refuse(code: ConnectorMetadataRefusalCode, message: string): never {
  throw new ConnectorMetadataRefusal(code, message);
}

/** Connector metadata as the application sees it. Capabilities are F062.1's
 * own interface rather than a parallel shape. */
export interface ConnectorMetadata {
  readonly id: string;
  readonly organizationId: string;
  readonly connectorKey: string;
  readonly connectorKind: ConnectorKind;
  readonly lifecycleState: ConnectorLifecycleState;
  /** The semantic pin. Record this on an outbox intent; do not use it as a
   * concurrency token. */
  readonly configurationRevision: number;
  /** The concurrency token. Supply this as `expectedRecordRevision` on any
   * mutation. */
  readonly recordRevision: number;
  readonly capabilities: ConnectorCapabilities;
  /** Presence only. The reference itself is not projected, so it does not
   * reach logs or responses by default. */
  readonly credentialReferencePresent: boolean;
}

/** One historical revision, sufficient to answer what was authoritative at
 * revision N without re-reading current configuration. */
export interface ConnectorRevisionRecord {
  /** Monotonic, one per accepted mutation, and the history's ordering key. */
  readonly recordRevision: number;
  readonly priorRecordRevision: number | null;
  readonly configurationRevision: number;
  /** Whether this mutation advanced the semantic revision. False for a
   * credential rotation. */
  readonly revisionAdvanced: boolean;
  readonly changeCategory: ConnectorChangeCategory;
  readonly lifecycleState: ConnectorLifecycleState;
  readonly priorLifecycleState: ConnectorLifecycleState | null;
  readonly capabilities: ConnectorCapabilities;
  readonly credentialReferencePresent: boolean;
  readonly changedAt: Date;
}

/**
 * The allowed lifecycle transitions, declared as data.
 *
 * `retired` is terminal and absent as a source, and no state returns to
 * `configured`: a decommissioned connector must not quietly resume, and a
 * connector that has been live is not "newly configured" again. Disabling is
 * reversible because it represents an outage, not a decision to discard.
 */
export const connectorLifecycleTransitions: Readonly<
  Record<ConnectorLifecycleState, readonly ConnectorLifecycleState[]>
> = {
  configured: ['active', 'disabled', 'retired'],
  active: ['degraded', 'disabled', 'retired'],
  degraded: ['active', 'disabled', 'retired'],
  disabled: ['active', 'retired'],
  retired: [],
};

export function mayTransitionLifecycle(
  from: ConnectorLifecycleState,
  to: ConnectorLifecycleState,
): boolean {
  return connectorLifecycleTransitions[from].includes(to);
}

export function assertConnectorKey(value: string): string {
  if (!CONNECTOR_KEY.test(value))
    refuse(
      'connector_key_invalid',
      'the connector key does not match the required grammar',
    );
  return value;
}

export function assertConnectorKind(value: string): ConnectorKind {
  if (!isConnectorKind(value))
    refuse('connector_kind_invalid', 'the connector kind is not recognised');
  return value;
}

/**
 * Validates a credential reference against the bounded grammar.
 *
 * This refuses shapes a reference should never take. It does **not** certify
 * that an accepted value is non-secret — that is a contract this slice keeps
 * by never resolving or interpreting the value, not a property any check
 * could establish.
 */
export function assertCredentialReference(value: string | null): string | null {
  if (value === null) return null;
  if (!CREDENTIAL_REFERENCE.test(value) || SECRET_SHAPED.test(value))
    refuse(
      'credential_reference_invalid',
      'the credential reference must be a non-secret locator',
    );
  return value;
}

/**
 * Validates a capability contract against F062.1's closed vocabularies.
 *
 * Deliberately **no inferred couplings** — nothing here concludes that
 * `supportsUpdate` implies the `updateRequest` operation, or that
 * `reportsTerminalState` requires a webhook. F062.1 declares no such
 * relationship, and inventing one in persistence would be this layer quietly
 * authoring contract semantics it does not own.
 */
export function assertCapabilities(
  capabilities: ConnectorCapabilities,
): ConnectorCapabilities {
  const operations = capabilities.operations;
  if (operations.length > connectorOperations.length)
    refuse(
      'capability_contract_invalid',
      'the capability contract declares more operations than exist',
    );
  for (const operation of operations)
    if (!(connectorOperations as readonly string[]).includes(operation))
      refuse(
        'capability_contract_invalid',
        'the capability contract declares an unknown operation',
      );
  if (new Set(operations).size !== operations.length)
    refuse(
      'capability_contract_invalid',
      'the capability contract repeats an operation',
    );
  if (
    !(orderingGuarantees as readonly string[]).includes(
      capabilities.supportsOrdering,
    )
  )
    refuse(
      'capability_contract_invalid',
      'the capability contract declares an unknown ordering guarantee',
    );
  if (
    !(sideEffectRisks as readonly string[]).includes(
      capabilities.sideEffectRisk,
    )
  )
    refuse(
      'capability_contract_invalid',
      'the capability contract declares an unknown side-effect risk',
    );
  return capabilities;
}

export function assertLifecycleState(value: string): ConnectorLifecycleState {
  if (!(connectorLifecycleStates as readonly string[]).includes(value))
    refuse(
      'lifecycle_transition_unsupported',
      'the lifecycle state is not in the approved vocabulary',
    );
  return value as ConnectorLifecycleState;
}

/** The conservative starting profile, taken from F062.1 rather than restated:
 * a destination supports nothing, and is assumed consequential, until it
 * declares otherwise. */
export const INITIAL_CAPABILITIES: ConnectorCapabilities = NO_CAPABILITIES;

/** Column-shaped capability values, so the repository and the audit writer
 * share one mapping instead of two hand-maintained ones. */
export interface CapabilityColumns {
  readonly operations: ConnectorOperation[];
  readonly supports_idempotency_key: boolean;
  readonly supports_read_after_write: boolean;
  readonly supports_reconciliation: boolean;
  readonly supports_webhook_callback: boolean;
  readonly supports_ordering: ConnectorCapabilities['supportsOrdering'];
  readonly supports_update: boolean;
  readonly supports_cancel: boolean;
  readonly supports_delete: boolean;
  readonly supports_current_state_sync: boolean;
  readonly reports_terminal_state: boolean;
  readonly side_effect_risk: ConnectorCapabilities['sideEffectRisk'];
}

export function toCapabilityColumns(
  capabilities: ConnectorCapabilities,
): CapabilityColumns {
  return {
    operations: [...capabilities.operations],
    supports_idempotency_key: capabilities.supportsIdempotencyKey,
    supports_read_after_write: capabilities.supportsReadAfterWrite,
    supports_reconciliation: capabilities.supportsReconciliation,
    supports_webhook_callback: capabilities.supportsWebhookCallback,
    supports_ordering: capabilities.supportsOrdering,
    supports_update: capabilities.supportsUpdate,
    supports_cancel: capabilities.supportsCancel,
    supports_delete: capabilities.supportsDelete,
    supports_current_state_sync: capabilities.supportsCurrentStateSync,
    reports_terminal_state: capabilities.reportsTerminalState,
    side_effect_risk: capabilities.sideEffectRisk,
  };
}

export function fromCapabilityColumns(
  row: CapabilityColumns,
): ConnectorCapabilities {
  return {
    operations: [...row.operations].sort(),
    supportsIdempotencyKey: row.supports_idempotency_key,
    supportsReadAfterWrite: row.supports_read_after_write,
    supportsReconciliation: row.supports_reconciliation,
    supportsWebhookCallback: row.supports_webhook_callback,
    supportsOrdering: row.supports_ordering,
    supportsUpdate: row.supports_update,
    supportsCancel: row.supports_cancel,
    supportsDelete: row.supports_delete,
    supportsCurrentStateSync: row.supports_current_state_sync,
    reportsTerminalState: row.reports_terminal_state,
    sideEffectRisk: row.side_effect_risk,
  };
}

/** Whether two capability contracts differ, which is what makes a change
 * revision-significant. Compared field by field over the closed contract
 * rather than by serialisation, so field order cannot create a false change. */
export function capabilitiesDiffer(
  left: ConnectorCapabilities,
  right: ConnectorCapabilities,
): boolean {
  const a = toCapabilityColumns(left);
  const b = toCapabilityColumns(right);
  if (a.operations.length !== b.operations.length) return true;
  const sortedA = [...a.operations].sort();
  const sortedB = [...b.operations].sort();
  if (sortedA.some((value, index) => value !== sortedB[index])) return true;
  return (
    a.supports_idempotency_key !== b.supports_idempotency_key ||
    a.supports_read_after_write !== b.supports_read_after_write ||
    a.supports_reconciliation !== b.supports_reconciliation ||
    a.supports_webhook_callback !== b.supports_webhook_callback ||
    a.supports_ordering !== b.supports_ordering ||
    a.supports_update !== b.supports_update ||
    a.supports_cancel !== b.supports_cancel ||
    a.supports_delete !== b.supports_delete ||
    a.supports_current_state_sync !== b.supports_current_state_sync ||
    a.reports_terminal_state !== b.reports_terminal_state ||
    a.side_effect_risk !== b.side_effect_risk
  );
}

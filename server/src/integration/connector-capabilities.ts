/**
 * F062.1 — the closed connector capability contract.
 *
 * **Capabilities are declared, never assumed, and never emulated.** An
 * unsupported capability is declared false and the router routes around it or
 * refuses; it is not simulated, and it is not inferred because a sibling
 * connector has it. AGENTS.md states the rule directly: do not force an
 * adapter to support functionality its destination does not provide.
 *
 * **No capability may encode a vendor name or act as a proxy for one.**
 * Capabilities describe what a destination *can do*, never which product it
 * is. A connector needing behaviour conditional on its own product identity
 * has pushed vendor logic into the wrong layer.
 */

/** The operations a destination may expose, matching the neutral vocabulary
 * AGENTS.md authorizes. A destination supports a subset; none is assumed. */
export const connectorOperations = [
  'createRequest',
  'getRequest',
  'getRequestStatus',
  'updateRequest',
  'addAttachment',
] as const;
export type ConnectorOperation = (typeof connectorOperations)[number];

/**
 * How consequential a repeated or mistaken dispatch is.
 *
 * A **bounded classification, not a free-text note**, because it is the
 * decisive input to retry policy. `physical` exists as its own value because
 * a work item that reaches a crew has consequences no software rollback
 * addresses — the difference between a wasted API call and a second crew
 * dispatched to a site.
 */
export const sideEffectRisks = [
  'none',
  'reversible',
  'irreversible',
  'physical',
] as const;
export type SideEffectRisk = (typeof sideEffectRisks)[number];

/** Risks that must never be auto-retried on an ambiguous outcome, whatever
 * other capabilities a destination declares. */
export const unretryableSideEffectRisks: readonly SideEffectRisk[] = [
  'irreversible',
  'physical',
];

/** Whether a destination honours per-aggregate ordering, or Reqro must
 * serialise. No global ordering is offered or needed. */
export const orderingGuarantees = ['none', 'per_aggregate'] as const;
export type OrderingGuarantee = (typeof orderingGuarantees)[number];

/**
 * The closed capability contract.
 *
 * Each field answers a question whose wrong assumption causes a specific,
 * identifiable harm — recorded in the F062 architecture and summarised here
 * so a future implementer does not have to infer why the field exists.
 */
export interface ConnectorCapabilities {
  readonly operations: readonly ConnectorOperation[];
  /** May an ambiguous attempt be safely retried? Wrongly true duplicates a
   * mutation; wrongly false sends resolvable cases to a human. */
  readonly supportsIdempotencyKey: boolean;
  /** May Reqro resolve an ambiguous attempt by reading back rather than
   * retrying? Without it, ambiguity is resolved by guessing or by a human. */
  readonly supportsReadAfterWrite: boolean;
  /** Is periodic divergence detection possible at all? Wrongly true presents
   * unverifiable state as verified. */
  readonly supportsReconciliation: boolean;
  /** Does the destination push, or must Reqro poll? */
  readonly supportsWebhookCallback: boolean;
  /** Does it honour per-aggregate order? */
  readonly supportsOrdering: OrderingGuarantee;
  /** Can an existing external record be amended, or would a correction
   * create a duplicate instead? */
  readonly supportsUpdate: boolean;
  /** Can withdrawal be expressed, where the destination has the concept?
   * Without it a withdrawn request may remain live and dispatched. */
  readonly supportsCancel: boolean;
  readonly supportsDelete: boolean;
  /** May a desired-state intent be sent? A create-once destination cannot
   * receive repeated convergence instructions. */
  readonly supportsCurrentStateSync: boolean;
  /** May `acknowledged` ever be recorded? Without it the honest terminal
   * state is `accepted`, exactly as a non-reporting notification transport
   * must never show `delivered`. */
  readonly reportsTerminalState: boolean;
  readonly sideEffectRisk: SideEffectRisk;
}

/** The conservative default: a destination supports nothing until it says so.
 * Declaring capabilities is an act; inheriting them must not be. */
export const NO_CAPABILITIES: ConnectorCapabilities = {
  operations: [],
  supportsIdempotencyKey: false,
  supportsReadAfterWrite: false,
  supportsReconciliation: false,
  supportsWebhookCallback: false,
  supportsOrdering: 'none',
  supportsUpdate: false,
  supportsCancel: false,
  supportsDelete: false,
  supportsCurrentStateSync: false,
  reportsTerminalState: false,
  sideEffectRisk: 'irreversible',
};

export function supportsOperation(
  capabilities: ConnectorCapabilities,
  operation: ConnectorOperation,
): boolean {
  return capabilities.operations.includes(operation);
}

/**
 * How an ambiguous outcome must be resolved for this destination.
 *
 * The order is deliberate and the terminal case is a human:
 *
 * 1. an idempotency key makes a retry safe;
 * 2. otherwise read-after-write resolves it on evidence;
 * 3. otherwise a person decides.
 *
 * An `irreversible` or `physical` side effect **short-circuits to operator
 * review regardless of the other capabilities**, because being able to retry
 * safely in the protocol sense is not the same as it being safe to repeat an
 * action in the world.
 */
export const ambiguityResolutions = [
  'retry_with_idempotency_key',
  'verify_by_read_after_write',
  'operator_review',
] as const;
export type AmbiguityResolution = (typeof ambiguityResolutions)[number];

export function resolveAmbiguity(
  capabilities: ConnectorCapabilities,
): AmbiguityResolution {
  if (unretryableSideEffectRisks.includes(capabilities.sideEffectRisk))
    return capabilities.supportsReadAfterWrite
      ? 'verify_by_read_after_write'
      : 'operator_review';
  if (capabilities.supportsIdempotencyKey) return 'retry_with_idempotency_key';
  if (capabilities.supportsReadAfterWrite) return 'verify_by_read_after_write';
  return 'operator_review';
}

/** Whether a blind retry of an ambiguous mutation is permitted. Separate from
 * {@link resolveAmbiguity} so the prohibition can be asserted on its own. */
export function mayRetryAmbiguous(
  capabilities: ConnectorCapabilities,
): boolean {
  return resolveAmbiguity(capabilities) === 'retry_with_idempotency_key';
}

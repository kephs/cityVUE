/**
 * F062.1 — delivery outcomes and connector lifecycle.
 *
 * **Delivery is at-least-once with idempotent processing.** No exactly-once
 * distributed execution is claimed, because it is not achievable against a
 * system Reqro does not control. Duplicates are expected rather than
 * exceptional, which is the premise every idempotency mechanism rests on.
 */

import {
  transientIntegrationFailures,
  type IntegrationFailureCategory,
} from './integration-envelope.js';

/**
 * The closed delivery state vocabulary.
 *
 * `accepted` means the destination took responsibility; it never asserts the
 * work happened. `acknowledged` is recorded **only** where the connector
 * declares `reportsTerminalState`, mirroring ADR-026's rule that a
 * non-reporting transport must never show `delivered`.
 */
export const deliveryStates = [
  'pending',
  'dispatching',
  'accepted',
  'acknowledged',
  'retrying',
  'ambiguous',
  'failed_permanent',
  'dead_lettered',
  'refused',
] as const;
export type DeliveryState = (typeof deliveryStates)[number];

/**
 * The outcome of a single attempt.
 *
 * **`ambiguous` is distinct from both success and failure, deliberately.** It
 * is the honest representation of "the external mutation may or may not have
 * taken effect, and we cannot tell" — a response lost after a request that may
 * already have succeeded. Collapsing it into `failed` invites a retry that
 * duplicates; collapsing it into `succeeded` invents an outcome nobody
 * observed. It is its own value so neither collapse is expressible.
 */
export const attemptOutcomes = [
  'succeeded',
  'failed_transient',
  'failed_permanent',
  'ambiguous',
] as const;
export type AttemptOutcome = (typeof attemptOutcomes)[number];

/** Outcomes that are neither success nor a settled failure, and therefore
 * must not be treated as either. */
export const unsettledAttemptOutcomes: readonly AttemptOutcome[] = [
  'ambiguous',
];

export function isSettledOutcome(outcome: AttemptOutcome): boolean {
  return !unsettledAttemptOutcomes.includes(outcome);
}

/**
 * F062.2D-2C-1 — the bounded Reqro-owned attempt settlement reason namespace.
 *
 * **`reason_code` and `failure_category` answer different questions.**
 * `failure_category` answers "what did the destination or external transport
 * do?" and is the ten-value destination taxonomy. A reason code answers "what
 * did Reqro's own delivery machinery do?" and no destination is implied by
 * any value in it.
 *
 * **This is the currently persisted subset, not the whole design.** F062.2A
 * §8.1 designs a wider taxonomy across ten groups; only the two values below
 * have a producer, so only they are persisted. The remainder arrives with the
 * classifying settle path that can write it, alongside its own authority
 * here. Adding a value requires a reviewed migration altering the `CHECK`,
 * which is deliberately the same friction as adding a delivery state.
 *
 * **These are delivery evidence, not observability classifications.** F061's
 * `reason` dimension is a bounded metric label and is deliberately coarser.
 * The dependency direction is F062 semantics → a future mapping → F061
 * observability, never the reverse, so nothing here imports F061.
 */
export const integrationAttemptReasonCodes = [
  /** The claim lease expired while the dispatch boundary was unset, so no
   * external transmission could have occurred. The one reason that authorizes
   * automatic retry, and it is authorized by evidence rather than by elapsed
   * time. It never means "a generic internal failure". */
  'lease_expired_pre_dispatch',
  /** The claim lease expired after the dispatch boundary was set, so a
   * request may already have reached the destination and its outcome cannot
   * be established. Blind retry is forbidden; resolution is the
   * capability-gated re-attempt, reconciliation, or an operator. */
  'lease_expired_uncertain',
] as const;
export type IntegrationAttemptReasonCode =
  (typeof integrationAttemptReasonCodes)[number];

export function isIntegrationAttemptReasonCode(
  value: string,
): value is IntegrationAttemptReasonCode {
  return (integrationAttemptReasonCodes as readonly string[]).includes(value);
}

/** One attempt's settlement evidence, as the database records it.
 *
 * `dispatchStarted` is the boolean reading of `dispatch_started_at`: the
 * timestamp itself carries no authority here, only whether the boundary was
 * crossed. */
export interface AttemptSettlementEvidence {
  readonly outcome: AttemptOutcome | null;
  readonly failureCategory: IntegrationFailureCategory | null;
  readonly reasonCode: IntegrationAttemptReasonCode | null;
  readonly dispatchStarted: boolean;
}

/**
 * Whether a settlement shape is one the contract authorizes.
 *
 * The TypeScript twin of the `integration_delivery_attempt` settlement
 * constraints, so the matrix is assertable from either side and a divergence
 * is a test failure rather than a discovery. Pure and side-effect free: this
 * is contract authority, not application behaviour.
 *
 * | Origin                       | outcome            | category     | reason                       |
 * | ---------------------------- | ------------------ | ------------ | ---------------------------- |
 * | open                         | null               | null         | null                         |
 * | A success                    | `succeeded`        | null         | null                         |
 * | B adapter-derived            | the other three    | **not null** | null                         |
 * | C pre-dispatch recovery      | `failed_transient` | null         | `lease_expired_pre_dispatch` |
 * | D possibly-dispatched expiry | `ambiguous`        | null         | `lease_expired_uncertain`    |
 *
 * C additionally requires the boundary **unset** and D requires it **set**, so
 * neither reason can assert a boundary state the evidence contradicts.
 */
export function isAuthorizedAttemptSettlement(
  evidence: AttemptSettlementEvidence,
): boolean {
  const { outcome, failureCategory, reasonCode, dispatchStarted } = evidence;

  // An open attempt has nothing to explain yet.
  if (outcome === null) return failureCategory === null && reasonCode === null;

  // A. Success carries neither an explanation nor a reason.
  if (outcome === 'succeeded')
    return failureCategory === null && reasonCode === null;

  // C and D. A lifecycle reason never coexists with destination behaviour it
  // did not observe, and each pins both its outcome and its boundary state.
  if (reasonCode === 'lease_expired_pre_dispatch')
    return (
      outcome === 'failed_transient' &&
      failureCategory === null &&
      !dispatchStarted
    );
  if (reasonCode === 'lease_expired_uncertain')
    return (
      outcome === 'ambiguous' && failureCategory === null && dispatchStarted
    );

  // B. Adapter-derived. Every non-successful settlement is explained by
  // exactly one namespace, so with no lifecycle reason a category is required
  // -- which is also what refuses `failed_permanent` with no category.
  if (failureCategory === null) return false;

  // F062.1 transientIntegrationFailures, both halves. A timeout may already
  // have taken effect, so it settles only as ambiguous and can never earn a
  // transient retry.
  if (outcome === 'failed_transient')
    return (transientIntegrationFailures as readonly string[]).includes(
      failureCategory,
    );
  if (failureCategory === 'destination_timeout') return outcome === 'ambiguous';
  return true;
}

/** Terminal states. A terminal state is not re-attempted without an explicit,
 * authorized operator action. */
export const terminalDeliveryStates: readonly DeliveryState[] = [
  'acknowledged',
  'failed_permanent',
  'dead_lettered',
  'refused',
];

export function isTerminalDeliveryState(state: DeliveryState): boolean {
  return terminalDeliveryStates.includes(state);
}

/**
 * The allowed **non-age** delivery-state transitions, declared as data.
 *
 * **This is the authority the database mirrors**, not a convenience. The
 * durable state machine restates these pairs in SQL, and a parity test asserts
 * the two agree in both directions — so adding an edge here without the
 * migration, or in the migration without here, fails rather than diverging
 * silently. F062.2A established that discipline for the state vocabulary; this
 * extends it to the edges.
 *
 * **Age-based expiry is deliberately absent.** F062.2D-1A decided its
 * semantics but left its threshold, ownership and measurability unresolved, so
 * the `pending_age_exceeded` edge belongs to a later policy-implementation
 * slice. A transition whose predicate nobody has set is a guessed edge.
 *
 * **`dead_lettered` has no outgoing edge here.** F062.2A requires an authorized
 * replay to carry audit evidence in the same transaction, and no replay
 * authorization record exists yet; enabling `dead_lettered -> pending` before
 * it would permit an unaudited replay to a live external system.
 *
 * Two edges carry a precondition the pair alone cannot express, and the
 * database enforces both from the connector snapshot pinned on the intent:
 * `accepted -> acknowledged` only where the connector declares
 * `reportsTerminalState`, mirroring ADR-026's rule that a non-reporting
 * transport must never show delivery; and `ambiguous -> dispatching` only
 * where it declares `supportsIdempotencyKey`, so an ambiguous mutation is
 * never blind-retried.
 */
export const deliveryStateTransitions: Readonly<
  Record<DeliveryState, readonly DeliveryState[]>
> = {
  pending: ['dispatching', 'refused'],
  dispatching: [
    'accepted',
    'retrying',
    'ambiguous',
    'failed_permanent',
    'dead_lettered',
  ],
  retrying: ['dispatching', 'dead_lettered'],
  accepted: ['acknowledged'],
  ambiguous: ['dispatching', 'accepted', 'failed_permanent', 'dead_lettered'],
  acknowledged: [],
  failed_permanent: [],
  dead_lettered: [],
  refused: [],
};

export function mayTransitionDeliveryState(
  from: DeliveryState,
  to: DeliveryState,
): boolean {
  return deliveryStateTransitions[from].includes(to);
}

/** Transitions whose pair is permitted only when the pinned connector
 * capability named here is declared. Kept separate from the pair table so the
 * precondition cannot be lost by reading the pairs alone. */
export const transitionCapabilityPreconditions: readonly {
  readonly from: DeliveryState;
  readonly to: DeliveryState;
  readonly requires: 'reportsTerminalState' | 'supportsIdempotencyKey';
}[] = [
  { from: 'accepted', to: 'acknowledged', requires: 'reportsTerminalState' },
  {
    from: 'ambiguous',
    to: 'dispatching',
    requires: 'supportsIdempotencyKey',
  },
];

/**
 * Delivery states that must never be shown to a resident.
 *
 * Residents see Reqro's own request status, which Reqro owns and can always
 * answer. Retry and dead-letter state is internal plumbing: showing it would
 * expose vendor complexity, which AGENTS.md forbids, and would alarm a
 * resident about something they cannot act on. The integration surface is
 * staff and operator only.
 */
export const residentVisibleDeliveryStates: readonly DeliveryState[] = [];

export function isResidentVisibleDeliveryState(state: DeliveryState): boolean {
  return residentVisibleDeliveryStates.includes(state);
}

/**
 * Connector lifecycle.
 *
 * `degraded` is distinct from `disabled` because "working slowly" and "not
 * working" need different operational responses. `retired` is terminal: a
 * decommissioned integration must not quietly resume and flush a months-old
 * backlog at a destination.
 */
export const connectorLifecycleStates = [
  'configured',
  'active',
  'degraded',
  'disabled',
  'retired',
] as const;
export type ConnectorLifecycleState = (typeof connectorLifecycleStates)[number];

/** States in which an envelope may be dispatched. `configured` and `disabled`
 * accumulate without dispatching; `retired` accepts nothing at all. */
export const dispatchingLifecycleStates: readonly ConnectorLifecycleState[] = [
  'active',
  'degraded',
];

export function mayDispatch(state: ConnectorLifecycleState): boolean {
  return dispatchingLifecycleStates.includes(state);
}

/**
 * Whether new envelopes may still be enqueued for a connector in this state.
 *
 * **Disabling accumulates; it does not discard.** A disabled connector
 * behaves like an outage, so events keep enqueuing and nothing is lost —
 * silently dropping on disable would make "disable" a data-loss operation,
 * which no operator would expect. **`retired` is the only state that refuses
 * enqueue**, and it is deliberately terminal.
 */
export function mayEnqueue(state: ConnectorLifecycleState): boolean {
  return state !== 'retired';
}

/**
 * Whether evidence may be erased when a connector reaches this state.
 *
 * **Never, in any state.** Delivery history, dead-letter rows, reconciliation
 * findings and audit records are the evidence of what was and was not sent,
 * and they outlive the connector that produced them. Decommissioning is a
 * state transition, not a deletion. This exists as a function returning a
 * constant so the rule is callable and assertable rather than only written in
 * prose.
 */
export function mayEraseEvidence(): false {
  return false;
}

/**
 * F062.1 — delivery outcomes and connector lifecycle.
 *
 * **Delivery is at-least-once with idempotent processing.** No exactly-once
 * distributed execution is claimed, because it is not achievable against a
 * system Reqro does not control. Duplicates are expected rather than
 * exceptional, which is the premise every idempotency mechanism rests on.
 */

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

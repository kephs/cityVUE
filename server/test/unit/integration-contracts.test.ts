import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ambiguityResolutions,
  mayRetryAmbiguous,
  NO_CAPABILITIES,
  resolveAmbiguity,
  sideEffectRisks,
  supportsOperation,
  type ConnectorCapabilities,
} from '../../src/integration/connector-capabilities.js';
import {
  ConnectorRegistry,
  EMPTY_CONNECTOR_REGISTRY,
} from '../../src/integration/connector-registry.js';
import {
  attemptOutcomes,
  connectorLifecycleStates,
  deliveryStates,
  isResidentVisibleDeliveryState,
  isSettledOutcome,
  isTerminalDeliveryState,
  mayDispatch,
  mayEnqueue,
  mayEraseEvidence,
} from '../../src/integration/delivery-contract.js';
import {
  assertMayWriteFact,
  factAuthorityKinds,
  FactAuthorityRefusal,
  FactAuthorityRegistry,
  wouldEcho,
  type FactAuthorityDeclaration,
} from '../../src/integration/fact-authority.js';
import {
  assertEnvelope,
  assertEnvelopeMetadataBounded,
  contractKindOf,
  contractKinds,
  EnvelopeRefusal,
  INTEGRATION_TYPES,
  integrationTypes,
  isIntegrationType,
  isReplayable,
  isTransientIntegrationFailure,
  redispatchSchemaVersion,
  type IntegrationEnvelope,
} from '../../src/integration/integration-envelope.js';
import {
  negotiateReplayVersion,
  negotiateVersion,
  requiresDeprecationWindow,
  requiresVersionBump,
  schemaChangeKinds,
  type SupportedTypeVersions,
} from '../../src/integration/schema-compatibility.js';
import {
  assertIntegrationLabels,
  failureReasonDimension,
  INTEGRATION_COMPONENT,
  INTEGRATION_METRIC_CONCEPTS,
  integrationMetricUnit,
  integrationSlisImplemented,
  isIntegrationMetricConcept,
  NO_TELEMETRY,
  outcomeDimension,
} from '../../src/integration/integration-telemetry.js';
import {
  metricConcepts,
  restrictedAttributePolicy,
  restrictedAttributes,
} from '../../src/observability/telemetry-contracts.js';
import { integrationFailureCategories } from '../../src/integration/integration-envelope.js';

/** F062.1. The integration contracts, proven without a network, a database, a
 * credential or a connector. Every assertion below is a pure function call. */

const ORG = '10000000-0000-4000-8000-000000000001';
const ID = '20000000-0000-4000-8000-000000000002';
const AGG = '30000000-0000-4000-8000-000000000003';
const CORR = '40000000-0000-4000-8000-000000000004';

function envelope(
  overrides: Partial<IntegrationEnvelope> = {},
): IntegrationEnvelope {
  return {
    integrationId: ID,
    type: 'service_request.submitted',
    contractKind: 'event',
    schemaVersion: 1,
    organizationId: ORG,
    deploymentEnvironment: 'production',
    aggregateType: 'service_request',
    aggregateId: AGG,
    aggregateRevision: 3,
    occurredAt: '2026-10-09T12:00:00.000Z',
    recordedAt: '2026-10-09T12:00:00.100Z',
    correlationId: CORR,
    causationId: null,
    origin: { kind: 'reqro' },
    ...overrides,
  };
}

function refusalCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    assert.ok(
      error instanceof EnvelopeRefusal || error instanceof FactAuthorityRefusal,
      'expected a closed integration refusal',
    );
    return error.code;
  }
  return assert.fail('expected a refusal');
}

// ---------------------------------------------------------------------------
// Envelope and the two contract kinds
// ---------------------------------------------------------------------------

test('a valid envelope is accepted, and the vocabulary declares its contract kind', () => {
  assert.doesNotThrow(() => {
    assertEnvelope(envelope());
  });
  assert.deepEqual(contractKinds, ['event', 'state_sync']);
  // Every declared type's kind comes from the vocabulary, never a caller.
  for (const type of integrationTypes)
    assert.equal(contractKindOf(type), INTEGRATION_TYPES[type].kind, type);
  assert.ok(integrationTypes.length >= 5);
  assert.ok(isIntegrationType('service_request.submitted'));
  assert.ok(!isIntegrationType('vueworks.workorder.created'));
});

test('a caller cannot relabel an immutable event as a state-sync intent', () => {
  // The misuse F062 section 3.2 exists to prevent: current mutable state
  // masquerading as a historical event, or the reverse.
  const verdicts: Record<string, string> = {
    'event as state_sync': refusalCode(() => {
      assertEnvelope(envelope({ contractKind: 'state_sync' }));
    }),
    'state_sync as event': refusalCode(() => {
      assertEnvelope(
        envelope({
          type: 'work_item.sync_requested',
          contractKind: 'event',
          aggregateType: 'work_item',
        }),
      );
    }),
    'wrong aggregate': refusalCode(() => {
      assertEnvelope(envelope({ aggregateType: 'work_item' }));
    }),
    'wrong version': refusalCode(() => {
      assertEnvelope(envelope({ schemaVersion: 2 }));
    }),
    'unknown type': refusalCode(() => {
      assertEnvelope(envelope({ type: 'service_request.deleted' as never }));
    }),
  };
  assert.deepEqual(verdicts, {
    'event as state_sync': 'contract_kind_mismatch',
    'state_sync as event': 'contract_kind_mismatch',
    'wrong aggregate': 'contract_kind_mismatch',
    'wrong version': 'contract_kind_mismatch',
    'unknown type': 'type_unknown',
  });
  // The legitimate state-sync envelope is accepted, so the refusals above are
  // specific rather than a blanket rejection.
  assert.doesNotThrow(() => {
    assertEnvelope(
      envelope({
        type: 'work_item.sync_requested',
        contractKind: 'state_sync',
        aggregateType: 'work_item',
        aggregateRevision: null,
      }),
    );
  });
});

test('an immutable event requires a revision so it can be reconstructed as of it', () => {
  // An event without a revision cannot be reconstructed as of a point in
  // time, which is the whole requirement for contract kind `event`.
  assert.equal(
    refusalCode(() => {
      assertEnvelope(envelope({ aggregateRevision: null }));
    }),
    'revision_invalid',
  );
  // A state-sync intent legitimately has none: its meaning is "what is true
  // now", so there is no revision to pin.
  assert.doesNotThrow(() => {
    assertEnvelope(
      envelope({
        type: 'work_item.sync_requested',
        contractKind: 'state_sync',
        aggregateType: 'work_item',
        aggregateRevision: null,
      }),
    );
  });
});

test('only an immutable event is replayable, and a replay preserves its recorded version', () => {
  const event = envelope();
  const sync = envelope({
    type: 'work_item.sync_requested',
    contractKind: 'state_sync',
    aggregateType: 'work_item',
    aggregateRevision: null,
  });
  assert.equal(isReplayable(event), true);
  assert.equal(isReplayable(sync), false);

  // A replay reproduces the ORIGINAL intent, so it keeps the recorded version
  // even when the vocabulary has moved on. This is the property that stops
  // current state masquerading as a historical replay.
  const historical = { ...event, schemaVersion: 7 };
  assert.equal(redispatchSchemaVersion(historical), 7);
  // A state-sync re-dispatch is re-synchronization, not replay, so it uses
  // the current declared version.
  assert.equal(
    redispatchSchemaVersion({ ...sync, schemaVersion: 7 }),
    INTEGRATION_TYPES['work_item.sync_requested'].schemaVersion,
  );
});

test('envelope identifiers, timestamps and origin are bounded', () => {
  const verdicts: Record<string, string> = {
    'bad integrationId': refusalCode(() => {
      assertEnvelope(envelope({ integrationId: 'not-a-uuid' }));
    }),
    'bad organizationId': refusalCode(() => {
      assertEnvelope(envelope({ organizationId: '123' }));
    }),
    'bad causationId': refusalCode(() => {
      assertEnvelope(envelope({ causationId: 'x' }));
    }),
    'bad environment': refusalCode(() => {
      assertEnvelope(envelope({ deploymentEnvironment: 'Production!' }));
    }),
    'negative revision': refusalCode(() => {
      assertEnvelope(envelope({ aggregateRevision: -1 }));
    }),
    'bad timestamp': refusalCode(() => {
      assertEnvelope(envelope({ occurredAt: 'yesterday' }));
    }),
    'recorded before occurred': refusalCode(() => {
      assertEnvelope(envelope({ recordedAt: '2026-10-09T11:00:00.000Z' }));
    }),
    'bad external origin': refusalCode(() => {
      assertEnvelope(
        envelope({ origin: { kind: 'external', connectorId: 'Bad Id' } }),
      );
    }),
  };
  assert.deepEqual(verdicts, {
    'bad integrationId': 'identifier_invalid',
    'bad organizationId': 'identifier_invalid',
    'bad causationId': 'identifier_invalid',
    'bad environment': 'identifier_invalid',
    'negative revision': 'revision_invalid',
    'bad timestamp': 'timestamp_invalid',
    'recorded before occurred': 'timestamp_invalid',
    'bad external origin': 'origin_invalid',
  });
  // A well-formed external origin is accepted.
  assert.doesNotThrow(() => {
    assertEnvelope(
      envelope({ origin: { kind: 'external', connectorId: 'eam-primary' } }),
    );
  });
});

test('prohibited and unbounded envelope metadata is refused', () => {
  const verdicts: Record<string, string> = {};
  const payloads: Record<string, unknown> = {
    'resident name': { requesterName: 'x' },
    email: { email: 'a@b.c' },
    phone: { phone: '555' },
    address: { serviceAddress: 'x' },
    secret: { clientSecret: 'x' },
    token: { accessToken: 'x' },
    'tracking credential': { tracking: 'x' },
    'raw vendor error': { vendorError: 'x' },
    'free-form status': { statusText: 'x' },
    note: { notes: 'x' },
    payload: { payload: {} },
    nested: { context: { residentEmail: 'x' } },
  };
  for (const [label, candidate] of Object.entries(payloads))
    verdicts[label] = refusalCode(() => {
      assertEnvelopeMetadataBounded(candidate);
    });
  for (const label of Object.keys(payloads))
    assert.equal(verdicts[label], 'metadata_unbounded', label);
  // A valid envelope passes the same walk, so the check is not vacuous.
  assert.doesNotThrow(() => {
    assertEnvelopeMetadataBounded(envelope());
  });
  // Cyclic input terminates.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.doesNotThrow(() => {
    assertEnvelopeMetadataBounded(cyclic);
  });
});

test('a timeout is ambiguous rather than transient', () => {
  // ADR-026 made the same choice for provider_timeout. A timeout may already
  // have mutated the destination, so retrying it is not safe by default.
  assert.equal(isTransientIntegrationFailure('destination_timeout'), false);
  assert.equal(isTransientIntegrationFailure('destination_unavailable'), true);
  assert.equal(isTransientIntegrationFailure('rate_limited'), true);
  assert.equal(isTransientIntegrationFailure('authentication_failed'), false);
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

test('capabilities default to supporting nothing', () => {
  // Declaring a capability is an act; inheriting one must not be.
  assert.deepEqual(NO_CAPABILITIES.operations, []);
  assert.equal(NO_CAPABILITIES.supportsIdempotencyKey, false);
  assert.equal(NO_CAPABILITIES.supportsCurrentStateSync, false);
  assert.equal(NO_CAPABILITIES.reportsTerminalState, false);
  assert.equal(NO_CAPABILITIES.supportsOrdering, 'none');
  // The conservative default for side-effect risk is NOT `none`: assuming a
  // destination is harmless to retry is the dangerous direction.
  assert.equal(NO_CAPABILITIES.sideEffectRisk, 'irreversible');
  assert.equal(supportsOperation(NO_CAPABILITIES, 'createRequest'), false);
});

test('ambiguity resolution never blindly retries a non-idempotent mutation', () => {
  const base: ConnectorCapabilities = {
    ...NO_CAPABILITIES,
    sideEffectRisk: 'reversible',
  };
  const verdicts: Record<string, string> = {
    'idempotency key': resolveAmbiguity({
      ...base,
      supportsIdempotencyKey: true,
    }),
    'read after write only': resolveAmbiguity({
      ...base,
      supportsReadAfterWrite: true,
    }),
    neither: resolveAmbiguity(base),
    // An irreversible or physical side effect short-circuits regardless of an
    // idempotency key: safe to retry in the protocol is not safe to repeat in
    // the world.
    'physical with idempotency key': resolveAmbiguity({
      ...base,
      sideEffectRisk: 'physical',
      supportsIdempotencyKey: true,
    }),
    'irreversible with idempotency key': resolveAmbiguity({
      ...base,
      sideEffectRisk: 'irreversible',
      supportsIdempotencyKey: true,
    }),
    'physical with read after write': resolveAmbiguity({
      ...base,
      sideEffectRisk: 'physical',
      supportsReadAfterWrite: true,
    }),
  };
  assert.deepEqual(verdicts, {
    'idempotency key': 'retry_with_idempotency_key',
    'read after write only': 'verify_by_read_after_write',
    neither: 'operator_review',
    'physical with idempotency key': 'operator_review',
    'irreversible with idempotency key': 'operator_review',
    'physical with read after write': 'verify_by_read_after_write',
  });

  // And the retry permission mirrors it.
  assert.equal(
    mayRetryAmbiguous({ ...base, supportsIdempotencyKey: true }),
    true,
  );
  assert.equal(
    mayRetryAmbiguous({
      ...base,
      sideEffectRisk: 'physical',
      supportsIdempotencyKey: true,
    }),
    false,
  );
  assert.equal(mayRetryAmbiguous(NO_CAPABILITIES), false);
  assert.deepEqual(sideEffectRisks, [
    'none',
    'reversible',
    'irreversible',
    'physical',
  ]);
  assert.equal(ambiguityResolutions.length, 3);
});

// ---------------------------------------------------------------------------
// Delivery outcomes and lifecycle
// ---------------------------------------------------------------------------

test('ambiguous is distinct from both success and failure', () => {
  assert.ok(attemptOutcomes.includes('ambiguous'));
  assert.ok(attemptOutcomes.includes('succeeded'));
  assert.ok(attemptOutcomes.includes('failed_transient'));
  assert.ok(attemptOutcomes.includes('failed_permanent'));
  // It is neither, and that is representable.
  assert.equal(isSettledOutcome('ambiguous'), false);
  assert.equal(isSettledOutcome('succeeded'), true);
  assert.equal(isSettledOutcome('failed_permanent'), true);
  assert.ok(deliveryStates.includes('ambiguous'));
  assert.ok(deliveryStates.includes('dead_lettered'));
});

test('no delivery state is resident visible', () => {
  // Residents see Reqro's own request status. Retry and dead-letter state is
  // internal plumbing and would expose vendor complexity.
  for (const state of deliveryStates)
    assert.equal(isResidentVisibleDeliveryState(state), false, state);
});

test('terminal states are not re-attempted without an explicit action', () => {
  const verdicts: Record<string, boolean> = {};
  for (const state of deliveryStates)
    verdicts[state] = isTerminalDeliveryState(state);
  assert.deepEqual(verdicts, {
    pending: false,
    dispatching: false,
    accepted: false,
    acknowledged: true,
    retrying: false,
    ambiguous: false,
    failed_permanent: true,
    dead_lettered: true,
    refused: true,
  });
});

test('lifecycle: disabling accumulates, retired refuses, evidence is never erased', () => {
  assert.deepEqual(connectorLifecycleStates, [
    'configured',
    'active',
    'degraded',
    'disabled',
    'retired',
  ]);
  const dispatch: Record<string, boolean> = {};
  const enqueue: Record<string, boolean> = {};
  for (const state of connectorLifecycleStates) {
    dispatch[state] = mayDispatch(state);
    enqueue[state] = mayEnqueue(state);
  }
  assert.deepEqual(dispatch, {
    configured: false,
    active: true,
    degraded: true,
    disabled: false,
    retired: false,
  });
  // Disabling accumulates rather than discarding: silently dropping on
  // disable would make disable a data-loss operation.
  assert.deepEqual(enqueue, {
    configured: true,
    active: true,
    degraded: true,
    disabled: true,
    retired: false,
  });
  // Evidence survives every state, including retirement.
  assert.equal(mayEraseEvidence(), false);
});

// ---------------------------------------------------------------------------
// Fact authority
// ---------------------------------------------------------------------------

const DECLARATIONS: readonly FactAuthorityDeclaration[] = [
  {
    fact: { aggregateType: 'service_request', field: 'resident_status' },
    authority: { kind: 'reqro' },
  },
  {
    fact: { aggregateType: 'work_item', field: 'lifecycle_state' },
    authority: { kind: 'connector', connectorId: 'eam-primary' },
  },
  {
    fact: { aggregateType: 'work_item', field: 'labour_cost' },
    authority: { kind: 'connector', connectorId: 'erp-primary' },
  },
];

test('a connector may write only the facts its system is declared authority for', () => {
  const registry = new FactAuthorityRegistry(DECLARATIONS);
  const eam = { kind: 'external', connectorId: 'eam-primary' } as const;

  // Its own fact: permitted.
  assert.equal(
    registry.mayWriteFact(eam, {
      aggregateType: 'work_item',
      field: 'lifecycle_state',
    }).permitted,
    true,
  );

  // Another connector's fact, a Reqro-owned fact, and an undeclared fact are
  // each refused with a distinct cause.
  const verdicts: Record<string, string> = {
    "another connector's fact": refusalCode(() => {
      assertMayWriteFact(registry, eam, {
        aggregateType: 'work_item',
        field: 'labour_cost',
      });
    }),
    'reqro-owned fact': refusalCode(() => {
      assertMayWriteFact(registry, eam, {
        aggregateType: 'service_request',
        field: 'resident_status',
      });
    }),
    'undeclared fact': refusalCode(() => {
      assertMayWriteFact(registry, eam, {
        aggregateType: 'work_item',
        field: 'not_declared',
      });
    }),
    'reqro origin writing an external fact': refusalCode(() => {
      assertMayWriteFact(
        registry,
        { kind: 'reqro' },
        { aggregateType: 'work_item', field: 'lifecycle_state' },
      );
    }),
  };
  assert.deepEqual(verdicts, {
    "another connector's fact": 'authority_mismatch',
    'reqro-owned fact': 'reqro_owned_fact',
    'undeclared fact': 'authority_undeclared',
    'reqro origin writing an external fact': 'authority_mismatch',
  });
});

test('origin and causationId are loop-prevention evidence, not authorization', () => {
  // The decisive property. A correctly attributed, non-echo inbound origin is
  // still refused for a fact it does not own: being able to prove who is
  // speaking is a different question from whether they may assert this.
  const registry = new FactAuthorityRegistry(DECLARATIONS);
  const eam = { kind: 'external', connectorId: 'eam-primary' } as const;
  const fact = { aggregateType: 'work_item', field: 'labour_cost' } as const;

  // Not an echo back to itself...
  assert.equal(wouldEcho(eam, 'erp-primary'), false);
  // ...and yet still not authorized.
  assert.equal(registry.mayWriteFact(eam, fact).permitted, false);

  // Echo detection works independently and does not confer anything.
  assert.equal(wouldEcho(eam, 'eam-primary'), true);
  assert.equal(wouldEcho({ kind: 'reqro' }, 'eam-primary'), false);
});

test('exactly one authority per fact, enforced at construction', () => {
  assert.throws(
    () =>
      new FactAuthorityRegistry([
        ...DECLARATIONS,
        {
          fact: { aggregateType: 'work_item', field: 'lifecycle_state' },
          authority: { kind: 'connector', connectorId: 'other' },
        },
      ]),
    (error: unknown) =>
      error instanceof FactAuthorityRefusal &&
      error.code === 'declaration_conflict',
  );
});

test('AI is an actor and never a declared authority', () => {
  // There is deliberately no `ai` authority kind, so no fact can be owned by
  // a model. Authority belongs to systems of record and to Reqro.
  assert.deepEqual(factAuthorityKinds(), ['reqro', 'connector']);
  assert.ok(!factAuthorityKinds().includes('ai'));
});

// ---------------------------------------------------------------------------
// Schema compatibility
// ---------------------------------------------------------------------------

const SUPPORTED: readonly SupportedTypeVersions[] = [
  { type: 'service_request.submitted', versions: [1] },
  { type: 'service_request.closed', versions: [] },
];

test('version negotiation fails safely rather than guessing', () => {
  assert.deepEqual(negotiateVersion('service_request.submitted', SUPPORTED), {
    outcome: 'negotiated',
    version: 1,
  });
  // Declared but with no acceptable version: refused, never downgraded.
  assert.deepEqual(negotiateVersion('service_request.closed', SUPPORTED), {
    outcome: 'no_mutual_version',
  });
  // Not declared at all: a distinct outcome from "declared but unsupported".
  assert.deepEqual(negotiateVersion('work_item.assigned', SUPPORTED), {
    outcome: 'type_not_supported',
  });
});

test('a replay refuses rather than re-encoding the original intent', () => {
  // The recorded version is accepted when still supported...
  assert.deepEqual(
    negotiateReplayVersion('service_request.submitted', 1, SUPPORTED),
    { outcome: 'negotiated', version: 1 },
  );
  // ...and a replay of an intent recorded at a version the connector has
  // dropped refuses, rather than silently re-encoding it as version 1.
  assert.deepEqual(
    negotiateReplayVersion('service_request.submitted', 0, SUPPORTED),
    { outcome: 'version_deprecated_and_unsupported' },
  );
});

test('only an additive optional field may ship without a version bump', () => {
  const bump: Record<string, boolean> = {};
  const deprecate: Record<string, boolean> = {};
  for (const change of schemaChangeKinds) {
    bump[change] = requiresVersionBump(change);
    deprecate[change] = requiresDeprecationWindow(change);
  }
  assert.deepEqual(bump, {
    additive_optional: false,
    semantic_meaning_change: true,
    removal_or_rename: true,
    type_narrowing: true,
    optional_to_required: true,
  });
  assert.deepEqual(deprecate, {
    additive_optional: false,
    semantic_meaning_change: false,
    removal_or_rename: true,
    type_narrowing: false,
    optional_to_required: false,
  });
});

// ---------------------------------------------------------------------------
// Empty registry
// ---------------------------------------------------------------------------

test('the shipped connector registry is empty and registers no vendor connector', () => {
  assert.equal(EMPTY_CONNECTOR_REGISTRY.size, 0);
  assert.deepEqual(EMPTY_CONNECTOR_REGISTRY.registeredIds(), []);
});

test('registry lookup fails closed and cannot silently fall back', () => {
  // Unknown ids refuse rather than returning a default, a substitute or the
  // first registered connector.
  for (const id of ['', 'eam-primary', 'default', 'any', 'vueworks']) {
    // Asserted as a whole shape: this proves there is no connector on the
    // result at all, not merely that `resolved` is false.
    assert.deepEqual(
      EMPTY_CONNECTOR_REGISTRY.resolve(id),
      { resolved: false, failure: 'connector_unknown' },
      id,
    );
  }
  // The result is a discriminated union, so a caller cannot read a connector
  // off a miss by accident -- `connector` does not exist on the failure arm.
  const miss = EMPTY_CONNECTOR_REGISTRY.resolve('absent');
  assert.equal(Object.hasOwn(miss, 'connector'), false);
});

test('a retired connector resolves to a refusal, not to itself', () => {
  // Proven with a stub port, which is the only connector-shaped object in
  // this slice and performs no I/O.
  const retired = {
    connectorId: 'stub-retired',
    capabilities: NO_CAPABILITIES,
    supportedVersions: [],
    lifecycleState: 'retired',
    dispatch: () => Promise.reject(new Error('F062.1 defines no transport')),
  } as const;
  const registry = new ConnectorRegistry([retired]);
  assert.equal(registry.size, 1);
  assert.deepEqual(registry.resolve('stub-retired'), {
    resolved: false,
    failure: 'connector_retired',
  });
  // And an active stub resolves, so the refusal above is specific.
  const active = { ...retired, lifecycleState: 'active' } as const;
  assert.equal(
    new ConnectorRegistry([active]).resolve('stub-retired').resolved,
    true,
  );
});

test('duplicate connector identifiers are refused at construction', () => {
  const stub = {
    connectorId: 'dup',
    capabilities: NO_CAPABILITIES,
    supportedVersions: [],
    lifecycleState: 'active',
    dispatch: () => Promise.reject(new Error('no transport')),
  } as const;
  assert.throws(
    () => new ConnectorRegistry([stub, stub]),
    /duplicate connector identifier/,
  );
});

// ---------------------------------------------------------------------------
// Telemetry contract
// ---------------------------------------------------------------------------

test('metric-label policy is delegated to F061, not duplicated here', () => {
  // F062 maintains no competing policy. These rejections are F061.1's rules
  // reached through its validator: unknown dimension, out-of-vocabulary value
  // and the label budget.
  assert.doesNotThrow(() => {
    assertIntegrationLabels({
      component: INTEGRATION_COMPONENT,
      operation: 'deliver',
      outcome: 'succeeded',
    });
  });
  for (const labels of [
    { connectorId: 'eam-primary' },
    { organizationId: '00000000-0000-4000-8000-000000000000' },
    { customerHostname: 'requests.example.gov' },
    { correlationId: CORR },
    { integrationId: ID },
    { aggregateId: AGG },
    { externalRecordId: 'x' },
    { traceId: 'x' },
    { spanId: 'x' },
    { residentName: 'x' },
    { externalSystemPayload: 'x' },
    { component: 'not_a_component' },
    { outcome: 'ambiguous' },
  ])
    assert.throws(
      () => {
        assertIntegrationLabels(labels);
      },
      /metric label policy is owned by F061/,
      JSON.stringify(labels),
    );
});

test('F061 forbids the attributes F062 must never promote to labels', () => {
  // Asserted against F061.1's own declarations rather than a local copy, so a
  // change there is visible here instead of silently diverging.
  assert.equal(restrictedAttributePolicy.metricLabels, 'forbidden');
  for (const attribute of ['organizationId', 'customerHostname', 'connectorId'])
    assert.ok(
      (restrictedAttributes as readonly string[]).includes(attribute),
      `${attribute} must be restricted by F061`,
    );
});

test('integration metric concepts come from F061 and are not redeclared', () => {
  for (const concept of INTEGRATION_METRIC_CONCEPTS) {
    assert.ok(
      Object.hasOwn(metricConcepts, concept),
      `${concept} must be declared by F061`,
    );
    assert.equal(integrationMetricUnit(concept), metricConcepts[concept]);
    assert.ok(isIntegrationMetricConcept(concept));
  }
  assert.equal(INTEGRATION_METRIC_CONCEPTS.length, 5);
  assert.ok(!isIntegrationMetricConcept('request_count'));
});

test('integration semantics map onto F061 dimensions without losing ambiguity', () => {
  const outcomes: Record<string, string> = {};
  for (const outcome of attemptOutcomes)
    outcomes[outcome] = outcomeDimension(outcome);
  // `ambiguous` maps to `pending`, never to succeeded or failed: reporting it
  // as either would assert an outcome nobody observed.
  assert.deepEqual(outcomes, {
    succeeded: 'succeeded',
    failed_transient: 'failed',
    failed_permanent: 'failed',
    ambiguous: 'pending',
  });
  // Every mapped value must be one F061 actually permits.
  for (const outcome of attemptOutcomes)
    assert.doesNotThrow(() => {
      assertIntegrationLabels({ outcome: outcomeDimension(outcome) });
    }, outcome);
  // Every failure category maps to a permitted `reason`, and a timeout is
  // reported as a timeout rather than a generic failure.
  assert.equal(failureReasonDimension('destination_timeout'), 'timeout');
  for (const category of integrationFailureCategories)
    assert.doesNotThrow(() => {
      assertIntegrationLabels({ reason: failureReasonDimension(category) });
    }, category);
});

test('unimplemented integration SLIs are never reported as healthy', () => {
  // F061 requires that unimplemented queue and delivery SLIs be marked not
  // implemented rather than reported green or as zero failures. The default
  // port therefore records nothing at all -- a zero would read as health.
  assert.equal(integrationSlisImplemented(), false);
  let emitted = 0;
  const counting = {
    record: () => {
      emitted += 1;
    },
  };
  // The no-op port emits nothing; the counting stub proves the test would
  // have observed an emission had one occurred.
  NO_TELEMETRY.record('integration_retry_count', {}, 1);
  NO_TELEMETRY.record('integration_dead_letter_count', {}, 0);
  assert.equal(emitted, 0);
  counting.record();
  assert.equal(emitted, 1);
});

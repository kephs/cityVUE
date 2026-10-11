import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {
  integrationDeadLetterReasonClasses,
  integrationLeaseRecoveryClasses,
  integrationOrderedBlockerClasses,
  metricConcepts,
  metricDimensions,
  workerHealthSeparation,
  workerProductionReleaseGateConcepts,
  type IntegrationLeaseRecoveryClass,
  type IntegrationOrderedBlockerClass,
  type MetricConcept,
} from '../../src/observability/telemetry-contracts.js';
import {
  metricLabelBudget,
  validateMetricLabels,
} from '../../src/observability/metric-label-policy.js';
import { createTelemetryExportBoundary } from '../../src/observability/telemetry-export.js';

const added = {
  integration_active_claim_count: 'count',
  integration_expired_lease_count: 'count',
  integration_lease_recovery_count: 'count',
  integration_oldest_retry_eligible_age: 'milliseconds',
  integration_ordered_stream_blocked_count: 'count',
} as const;

test('five execution concepts extend the vocabulary without aliases for existing retry/dead-letter/ambiguity concepts', () => {
  for (const [name, unit] of Object.entries(added))
    assert.equal(metricConcepts[name as MetricConcept], unit);
  assert.equal(Object.keys(metricConcepts).length, 24);
  for (const alias of [
    'integration_retry_exhaustion_count',
    'integration_worker_retry_count',
    'integration_ambiguous_ordered_stream_blocked_count',
    'integration_blocked_stream_count',
  ])
    assert.equal(Object.hasOwn(metricConcepts, alias), false);
  assert.equal(metricConcepts.integration_retry_count, 'count');
  assert.equal(metricConcepts.integration_ambiguous_count, 'count');
});

test('active claim inventory and expired lease inventory coexist with successful claim events and release-critical age', () => {
  assert.equal(metricConcepts.integration_claim_count, 'count');
  assert.equal(metricConcepts.integration_active_claim_count, 'count');
  assert.equal(metricConcepts.integration_expired_lease_count, 'count');
  assert.deepEqual(workerProductionReleaseGateConcepts, [
    'integration_active_claim_count',
    'integration_expired_lease_count',
    'integration_oldest_pending_age',
  ]);
  assert.ok(Object.isFrozen(workerProductionReleaseGateConcepts));
  assert.equal(new Set(workerProductionReleaseGateConcepts).size, 3);
});

test('retry-eligible age is a separate duration without changing pending-age, ready or age-transition concepts', () => {
  assert.equal(
    metricConcepts.integration_oldest_retry_eligible_age,
    'milliseconds',
  );
  assert.equal(metricConcepts.integration_oldest_pending_age, 'milliseconds');
  assert.equal(metricConcepts.integration_ready_count, 'count');
  assert.equal(metricConcepts.integration_age_policy_transition_count, 'count');
  for (const name of Object.keys(added))
    assert.doesNotMatch(
      name,
      /duration_policy|threshold|retry_budget|next_attempt/,
    );
});

test('recovery and ordered-blocker classes are distinct frozen two-value subsets of the existing reason dimension', () => {
  assert.deepEqual(integrationLeaseRecoveryClasses, [
    'pre_dispatch_recovery',
    'uncertain_dispatch_recovery',
  ]);
  assert.deepEqual(integrationOrderedBlockerClasses, [
    'ordered_predecessor',
    'ambiguous_predecessor',
  ]);
  for (const vocabulary of [
    integrationLeaseRecoveryClasses,
    integrationOrderedBlockerClasses,
  ]) {
    assert.ok(Object.isFrozen(vocabulary));
    assert.equal(new Set(vocabulary).size, 2);
    for (const reason of vocabulary) {
      assert.equal(
        metricDimensions.reason.filter((value) => value === reason).length,
        1,
      );
      assert.deepEqual(validateMetricLabels({ reason }), {
        ok: true,
        labels: { reason },
      });
    }
  }
  // @ts-expect-error Semantic delivery codes are not F061 observation classes.
  const raw: IntegrationLeaseRecoveryClass = 'lease_expired_uncertain';
  void raw;
  // @ts-expect-error Recovery is not an ordered-blocker classification.
  const blocker: IntegrationOrderedBlockerClass = 'uncertain_dispatch_recovery';
  void blocker;
});

test('retry exhaustion reuses the existing dead-letter budget reason without conflating age, destination failure or recovery', () => {
  assert.equal(metricConcepts.integration_dead_letter_count, 'count');
  assert.deepEqual(integrationDeadLetterReasonClasses, [
    'pending_age_exhausted',
    'attempt_budget_exhausted',
    'permanent_destination_outcome',
    'other_approved',
  ]);
  assert.equal(
    metricDimensions.reason.filter(
      (reason) => reason === 'attempt_budget_exhausted',
    ).length,
    1,
  );
  for (const reason of integrationLeaseRecoveryClasses)
    assert.equal(
      (integrationDeadLetterReasonClasses as readonly string[]).includes(
        reason,
      ),
      false,
    );
});

test('all execution classes fit four-label 240-combination schemas without changing either budget', () => {
  assert.deepEqual(metricLabelBudget, {
    maxLabels: 4,
    maxSeriesPerLabelSet: 256,
  });
  assert.equal(metricDimensions.reason.length, 16);
  assert.equal(new Set(metricDimensions.reason).size, 16);
  assert.equal(
    metricDimensions.component.length *
      metricDimensions.reason.length *
      metricDimensions.environment.length *
      metricDimensions.service.length,
    240,
  );
  for (const reason of [
    ...integrationLeaseRecoveryClasses,
    ...integrationOrderedBlockerClasses,
    'attempt_budget_exhausted',
  ]) {
    const labels = {
      component: 'integration',
      reason,
      environment: 'production',
      service: 'cityvue-api',
    };
    assert.deepEqual(validateMetricLabels(labels), { ok: true, labels });
    assert.deepEqual(
      validateMetricLabels({ ...labels, releaseCohort: 'current' }),
      {
        ok: false,
        reason: 'cardinality_budget',
      },
    );
    assert.deepEqual(
      validateMetricLabels({
        reason,
        operation: 'deliver',
        environment: 'production',
      }),
      {
        ok: false,
        reason: 'cardinality_budget',
      },
    );
  }
});

test('identifiers, unapproved aggregate types, private text and semantic reason aliases remain refused', () => {
  for (const key of [
    'organizationId',
    'connectorId',
    'aggregateId',
    'aggregateType',
    'outboxId',
    'attemptId',
    'integrationId',
    'externalId',
    'hostname',
    'workerInstanceId',
    'correlationId',
    'traceId',
    'spanId',
    'residentName',
    'vendorError',
    'vendorStatus',
    'service.instance.id',
    'replicaId',
    'recoveryClass',
    'blockerReason',
  ])
    assert.deepEqual(
      validateMetricLabels({
        [key]: 'PRIVATE',
        reason: 'pre_dispatch_recovery',
      }),
      {
        ok: false,
        reason: 'unknown_attribute',
      },
    );
  for (const reason of [
    'lease_expired_pre_dispatch',
    'lease_expired_uncertain',
    'fenced_stale_completion',
    'pre_dispatch_recovery ',
    'PRE_DISPATCH_RECOVERY',
    'https://private.invalid',
    'PRIVATE',
    null,
    5,
  ])
    assert.deepEqual(validateMetricLabels({ reason }), {
      ok: false,
      reason: 'invalid_value',
    });
});

test('execution observation classes neither become health states nor widen the HTTP-only export gate', () => {
  assert.equal(workerHealthSeparation.stalledBacklogFailsWorkerLiveness, false);
  assert.equal(
    workerHealthSeparation.workerHealthDeterminesApiReadiness,
    false,
  );
  assert.equal(
    workerHealthSeparation.connectorHealthDeterminesApiReadiness,
    false,
  );
  assert.equal(
    workerHealthSeparation.destinationOutageFailsWorkerLiveness,
    false,
  );
  for (const healthSignal of [
    ...integrationLeaseRecoveryClasses,
    ...integrationOrderedBlockerClasses,
  ])
    assert.deepEqual(validateMetricLabels({ healthSignal }), {
      ok: false,
      reason: 'invalid_value',
    });
  for (const concept of Object.keys(added))
    assert.deepEqual(
      createTelemetryExportBoundary().submit({
        signal: 'metric',
        concept,
        value: 1,
        timestampMs: 1000,
        resource: { service: 'cityvue-api', deployment: null, instance: null },
        labels: {
          method: 'GET',
          routeTemplate: 'unmatched',
          statusClass: '2xx',
        },
      }),
      { status: 'rejected', reason: 'privacy_policy' },
    );
});

test('execution vocabulary is declaration-only with no imports, SDKs, policy arithmetic, database, clock, timer or network behavior', () => {
  const file = resolve(
    __dirname,
    '../../../src/observability/telemetry-contracts.ts',
  );
  const ast = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): void => {
    assert.equal(
      ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isImportTypeNode(node) ||
        ts.isExportDeclaration(node) ||
        ts.isNewExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isBinaryExpression(node),
      false,
    );
    if (ts.isCallExpression(node))
      assert.equal(node.expression.getText(ast), 'Object.freeze');
    if (ts.isIdentifier(node))
      assert.ok(
        ![
          'process',
          'globalThis',
          'fetch',
          'require',
          'Date',
          'setTimeout',
          'setInterval',
        ].includes(node.text),
      );
    ts.forEachChild(node, visit);
  };
  visit(ast);
});

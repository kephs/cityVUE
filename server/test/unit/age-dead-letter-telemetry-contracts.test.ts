import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  metricConcepts,
  metricDimensions,
  integrationDeadLetterReasonClasses,
  workerHealthStates,
  workerHealthSeparation,
  forbiddenAttributes,
  restrictedAttributes,
  metricOnlyForbiddenAttributes,
  type IntegrationDeadLetterReasonClass,
} from '../../src/observability/telemetry-contracts.js';
import {
  metricLabelBudget,
  validateMetricLabels,
} from '../../src/observability/metric-label-policy.js';
import { createTelemetryExportBoundary } from '../../src/observability/telemetry-export.js';

test('age-policy transition count exists once and remains distinct from dead-letter count and age', () => {
  assert.equal(metricConcepts.integration_age_policy_transition_count, 'count');
  assert.equal(metricConcepts.integration_dead_letter_count, 'count');
  assert.equal(metricConcepts.integration_oldest_pending_age, 'milliseconds');
  assert.deepEqual(
    Object.keys(metricConcepts).filter((key) =>
      /age_policy|age_expir/.test(key),
    ),
    ['integration_age_policy_transition_count'],
  );
  assert.equal(Object.keys(metricConcepts).length, 19);
});

test('four dead-letter classes are frozen, unique and separate age from attempt-budget exhaustion', () => {
  assert.deepEqual(integrationDeadLetterReasonClasses, [
    'pending_age_exhausted',
    'attempt_budget_exhausted',
    'permanent_destination_outcome',
    'other_approved',
  ]);
  assert.ok(Object.isFrozen(integrationDeadLetterReasonClasses));
  assert.equal(new Set(integrationDeadLetterReasonClasses).size, 4);
  for (const reason of integrationDeadLetterReasonClasses)
    assert.deepEqual(validateMetricLabels({ reason }), {
      ok: true,
      labels: { reason },
    });
  const age: IntegrationDeadLetterReasonClass = 'pending_age_exhausted';
  const attempts: IntegrationDeadLetterReasonClass = 'attempt_budget_exhausted';
  assert.notEqual(age, attempts);
});

test('existing reason mechanism is reused without adding a new dimension or deleting prior reasons', () => {
  assert.deepEqual(Object.keys(metricDimensions), [
    'environment',
    'service',
    'component',
    'routeTemplate',
    'method',
    'statusClass',
    'operation',
    'outcome',
    'reason',
    'endpointClass',
    'dependencyClass',
    'releaseCohort',
    'healthSignal',
  ]);
  assert.deepEqual(metricDimensions.reason, [
    'none',
    'unknown',
    'timeout',
    'dependency_unavailable',
    'invalid_authority',
    'unknown_host',
    'untrusted_forwarded_peer',
    'registry_unavailable',
    ...integrationDeadLetterReasonClasses,
  ]);
  assert.equal(new Set(metricDimensions.reason).size, 12);
  assert.deepEqual(
    validateMetricLabels({ deadLetterReason: 'pending_age_exhausted' }),
    { ok: false, reason: 'unknown_attribute' },
  );
});

test('raw semantic values, ambiguity, vendor text and arbitrary input are not accepted reason classes', () => {
  for (const reason of [
    'ambiguous',
    'pending_age_exceeded',
    'credential_unavailable',
    'credential_rejected',
    'lease_expired_uncertain',
    'failed_permanent',
    'HTTP 429',
    'vendor:E_PRIVATE',
    'Error: private body',
    'resident@example.invalid',
    'tenant.invalid',
    'https://tenant.invalid/?token=private',
    '',
    429,
    null,
    {},
    [],
    'pending_age_exhausted ',
    'PENDING_AGE_EXHAUSTED',
  ])
    assert.deepEqual(validateMetricLabels({ reason }), {
      ok: false,
      reason: 'invalid_value',
    });
  // @ts-expect-error Uncertainty must never become a dead-letter cause.
  const ambiguous: IntegrationDeadLetterReasonClass = 'ambiguous';
  void ambiguous;
  // @ts-expect-error Raw semantic codes need an explicit future mapping.
  const raw: IntegrationDeadLetterReasonClass = 'pending_age_exceeded';
  void raw;
  // @ts-expect-error A generic unknown reason is not an approved dead-letter cause.
  const unknown: IntegrationDeadLetterReasonClass = 'unknown';
  void unknown;
});

test('forbidden identifiers, private data and replica metadata stay outside metric labels', () => {
  for (const key of [
    ...forbiddenAttributes,
    ...restrictedAttributes,
    ...metricOnlyForbiddenAttributes,
    'integrationId',
    'outboxId',
    'attemptId',
    'externalId',
    'aggregateId',
    'resourceId',
    'hostname',
    'workerInstanceId',
    'replicaId',
    'instance',
    'deployment',
    'vendorStatus',
    'vendorError',
  ])
    assert.deepEqual(
      validateMetricLabels({
        reason: 'pending_age_exhausted',
        [key]: 'PRIVATE',
      }),
      { ok: false, reason: 'unknown_attribute' },
    );
});

test('the unchanged four-label and 256-combination limits account for all twelve reason values', () => {
  assert.deepEqual(metricLabelBudget, {
    maxLabels: 4,
    maxSeriesPerLabelSet: 256,
  });
  const labels = {
    component: 'integration',
    reason: 'pending_age_exhausted',
    environment: 'production',
    service: 'cityvue-api',
  };
  // 5 * 12 * 3 * 1 = 180, including all generic reasons rather than only four classes.
  assert.deepEqual(validateMetricLabels(labels), { ok: true, labels });
  // Three labels can still exceed the Cartesian cap: 12 * 8 * 3 = 288.
  assert.deepEqual(
    validateMetricLabels({
      reason: 'attempt_budget_exhausted',
      operation: 'deliver',
      environment: 'test',
    }),
    { ok: false, reason: 'cardinality_budget' },
  );
  assert.deepEqual(
    validateMetricLabels({ ...labels, releaseCohort: 'current' }),
    { ok: false, reason: 'cardinality_budget' },
  );
});

test('all schemas containing reason obey both budgets without special-case exemptions', () => {
  const keys = Object.keys(
    metricDimensions,
  ) as (keyof typeof metricDimensions)[];
  for (let mask = 1; mask < 2 ** keys.length; mask++) {
    const chosen = keys.filter((_, i) => (mask & (1 << i)) !== 0);
    if (!chosen.includes('reason')) continue;
    const labels = Object.fromEntries(
      chosen.map((key) => [
        key,
        key === 'reason' ? 'other_approved' : metricDimensions[key][0],
      ]),
    );
    const combinations = chosen.reduce(
      (total, key) => total * metricDimensions[key].length,
      1,
    );
    const result = validateMetricLabels(labels);
    assert.equal(result.ok, chosen.length <= 4 && combinations <= 256);
    if (!result.ok) assert.equal(result.reason, 'cardinality_budget');
  }
});

test('delivery cause classes do not become health states or widen HTTP export', () => {
  for (const reason of integrationDeadLetterReasonClasses) {
    assert.deepEqual(validateMetricLabels({ healthSignal: reason }), {
      ok: false,
      reason: 'invalid_value',
    });
    for (const states of Object.values(workerHealthStates))
      assert.equal((states as readonly string[]).includes(reason), false);
  }
  assert.equal(workerHealthSeparation.stalledBacklogRequiresRestart, false);
  assert.equal(
    workerHealthSeparation.connectorHealthDeterminesApiReadiness,
    false,
  );
  assert.deepEqual(
    createTelemetryExportBoundary().submit({
      signal: 'metric',
      concept: 'integration_age_policy_transition_count',
      value: 1,
      timestampMs: 1000,
      resource: { service: 'cityvue-api', deployment: null, instance: null },
      labels: { method: 'GET', routeTemplate: 'unmatched', statusClass: '2xx' },
    }),
    { status: 'rejected', reason: 'privacy_policy' },
  );
});

test('contract source is declarative: no F062/SDK import, age calculation, I/O or runtime function', () => {
  const file = resolve(
    __dirname,
    '../../../src/observability/telemetry-contracts.ts',
  );
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const keys: string[] = [];
  const visit = (node: ts.Node): void => {
    assert.equal(
      ts.isImportDeclaration(node) ||
        ts.isImportEqualsDeclaration(node) ||
        ts.isImportTypeNode(node) ||
        ts.isExportDeclaration(node),
      false,
    );
    assert.equal(
      ts.isNewExpression(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node),
      false,
    );
    assert.equal(
      ts.isBinaryExpression(node),
      false,
      'No age arithmetic or assignments',
    );
    if (ts.isCallExpression(node))
      assert.equal(node.expression.getText(source), 'Object.freeze');
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === 'integration_age_policy_transition_count'
    )
      keys.push(node.name.getText(source));
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(keys.length, 1);
});

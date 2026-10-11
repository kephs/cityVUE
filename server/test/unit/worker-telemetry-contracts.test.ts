import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import {
  metricConcepts,
  metricDimensions,
  workerHealthStates,
  workerHealthSeparation,
  forbiddenAttributes,
  restrictedAttributes,
  metricOnlyForbiddenAttributes,
  type MetricConcept,
  type WorkerHealthObservation,
} from '../../src/observability/telemetry-contracts.js';
import {
  metricLabelBudget,
  validateMetricLabels,
} from '../../src/observability/metric-label-policy.js';
import { createTelemetryExportBoundary } from '../../src/observability/telemetry-export.js';

const additions = {
  integration_pending_count: 'count',
  integration_ready_count: 'count',
  integration_oldest_pending_age: 'milliseconds',
  integration_claim_count: 'count',
  integration_ambiguous_count: 'count',
} as const;
const retained = {
  request_count: 'count',
  request_duration: 'milliseconds',
  error_count: 'count',
  readiness_result: 'outcome',
  dependency_latency: 'milliseconds',
  dependency_failure: 'count',
  tenant_resolution_outcome: 'outcome',
  operator_execution_outcome: 'outcome',
  integration_delivery_latency: 'milliseconds',
  integration_retry_count: 'count',
  integration_dead_letter_count: 'count',
  integration_reconciliation_failure: 'count',
  integration_connector_health: 'outcome',
} as const;

test('F061.3A concepts are retained alongside the explicit F061.3B extension', () => {
  assert.deepEqual(metricConcepts, {
    ...retained,
    ...additions,
    integration_age_policy_transition_count: 'count',
  });
  assert.ok(Object.isFrozen(metricConcepts));
  // @ts-expect-error No alias for an existing retry concept.
  const invalid: MetricConcept = 'integration_worker_retry_count';
  void invalid;
});

test('claim rate and reconciliation needs reuse concepts rather than duplicate aliases', () => {
  const integration = Object.keys(metricConcepts).filter((key) =>
    key.startsWith('integration_'),
  );
  assert.equal(integration.length, 11);
  for (const alias of [
    'integration_claim_rate',
    'integration_worker_delivery_latency',
    'integration_worker_dead_letter_count',
    'integration_reconciliation_required_count',
  ])
    assert.equal(Object.hasOwn(metricConcepts, alias), false);
  assert.equal(metricConcepts.integration_claim_count, 'count');
  assert.equal(metricConcepts.integration_reconciliation_failure, 'count');
});

test('release-critical oldest pending age is a duration concept, with no threshold configuration', () => {
  assert.equal(metricConcepts.integration_oldest_pending_age, 'milliseconds');
  assert.equal(metricConcepts.integration_pending_count, 'count');
  assert.equal(metricConcepts.integration_ready_count, 'count');
  assert.equal(metricConcepts.integration_ambiguous_count, 'count');
  for (const key of Object.keys(metricConcepts))
    assert.doesNotMatch(key, /threshold|maximum_pending|expiry/);
});

test('worker health has four distinct closed vocabularies within the existing healthSignal dimension', () => {
  assert.deepEqual(workerHealthStates, {
    worker_liveness: ['alive', 'not_alive', 'unknown'],
    worker_readiness: ['ready', 'not_ready', 'unknown'],
    worker_draining: ['draining', 'not_draining', 'unknown'],
    worker_progress: ['progressing', 'idle', 'stalled', 'unknown'],
  });
  assert.deepEqual(metricDimensions.healthSignal, [
    'liveness',
    'database_readiness',
    'hostname_readiness',
    'worker_liveness',
    'worker_readiness',
    'worker_draining',
    'worker_progress',
  ]);
  assert.ok(Object.isFrozen(workerHealthStates));
  for (const states of Object.values(workerHealthStates)) {
    assert.ok(Object.isFrozen(states));
    assert.equal(new Set(states).size, states.length);
  }
  const idle: WorkerHealthObservation = {
    signal: 'worker_progress',
    state: 'idle',
  };
  assert.equal(idle.state, 'idle');
  // @ts-expect-error Progress states cannot masquerade as liveness.
  const invalid: WorkerHealthObservation = {
    signal: 'worker_liveness',
    state: 'stalled',
  };
  void invalid;
  const connector: WorkerHealthObservation = {
    // @ts-expect-error Connector health is not a worker process observation.
    signal: 'integration_connector_health',
    state: 'ready',
  };
  void connector;
});

test('worker, destination and API health remain independent, with drain and backlog separated from restart', () => {
  assert.deepEqual(workerHealthSeparation, {
    workerHealthIsConnectorHealth: false,
    workerHealthDeterminesApiReadiness: false,
    connectorHealthDeterminesApiReadiness: false,
    destinationOutageFailsWorkerLiveness: false,
    stalledBacklogFailsWorkerLiveness: false,
    stalledBacklogRequiresRestart: false,
    drainingAllowsNewClaims: false,
    drainingAllowsBoundedInflightCompletion: true,
  });
  assert.ok(Object.isFrozen(workerHealthSeparation));
  assert.equal(metricConcepts.integration_connector_health, 'outcome');
  assert.equal(metricConcepts.readiness_result, 'outcome');
});

test('worker identifiers and private/vendor data remain refused as metric labels', () => {
  for (const key of [
    ...forbiddenAttributes,
    ...restrictedAttributes,
    ...metricOnlyForbiddenAttributes,
    'hostname',
    'outboxId',
    'outbox_id',
    'attemptId',
    'attempt_id',
    'integrationId',
    'aggregateId',
    'resourceId',
    'externalId',
    'workerInstanceId',
    'replicaId',
    'service.instance.id',
    'deployment',
    'instance',
    'vendorStatus',
    'vendorError',
    'workerState',
  ]) {
    assert.deepEqual(validateMetricLabels({ [key]: 'PRIVATE_SENTINEL' }), {
      ok: false,
      reason: 'unknown_attribute',
    });
  }
  for (const value of [
    'tenant.invalid',
    'worker-123',
    'PRIVATE_SENTINEL',
    'stalled',
  ])
    assert.deepEqual(validateMetricLabels({ healthSignal: value }), {
      ok: false,
      reason: 'invalid_value',
    });
});

test('no dimension keys or cardinality limits are added; expanded health vocabulary still uses the same budget', () => {
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
  assert.deepEqual(metricLabelBudget, {
    maxLabels: 4,
    maxSeriesPerLabelSet: 256,
  });
  for (const healthSignal of metricDimensions.healthSignal) {
    const labels = { component: 'integration', healthSignal };
    assert.deepEqual(validateMetricLabels(labels), { ok: true, labels });
  }
  // Seven health values * five components * eight operations = 280, not <= 256.
  assert.deepEqual(
    validateMetricLabels({
      component: 'integration',
      healthSignal: 'worker_progress',
      operation: 'deliver',
    }),
    { ok: false, reason: 'cardinality_budget' },
  );
});

test('contracts are literal data and types only: no imports, functions, SDKs, database or network', () => {
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
        ts.isImportTypeNode(node),
      false,
    );
    assert.equal(
      ts.isExportDeclaration(node) || ts.isNewExpression(node),
      false,
    );
    assert.equal(
      ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node),
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
          'setTimeout',
          'setInterval',
        ].includes(node.text),
      );
    ts.forEachChild(node, visit);
  };
  visit(ast);
  const concepts = ast.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (d) => d.name.getText(ast) === 'metricConcepts',
      ),
  );
  assert.ok(concepts);
  const names: string[] = [];
  const properties = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) names.push(node.name.getText(ast));
    ts.forEachChild(node, properties);
  };
  properties(concepts);
  assert.equal(
    names.length,
    new Set(names).size,
    'No overwritten duplicate concept keys',
  );
});

test('new worker concepts do not widen the existing HTTP-only no-network export gate', () => {
  const boundary = createTelemetryExportBoundary();
  for (const concept of Object.keys(additions))
    assert.deepEqual(
      boundary.submit({
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

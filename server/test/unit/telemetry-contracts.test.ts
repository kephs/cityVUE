import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import ts from 'typescript';
import {
  signalResponsibilities,
  correlationPolicy,
  metricDimensions,
  metricConcepts,
  forbiddenAttributes,
  metricOnlyForbiddenAttributes,
  restrictedAttributes,
  restrictedAttributePolicy,
  type TelemetryEvidence,
  type AuthoritativeAuditRequirement,
  type CorrelationReferences,
  type MetricLabels,
  type SliDefinition,
} from '../../src/observability/telemetry-contracts.js';
import { validateMetricLabels } from '../../src/observability/metric-label-policy.js';

test('every bounded dimension value is accepted, including a finite combined schema', () => {
  for (const [key, values] of Object.entries(metricDimensions)) {
    for (const value of values) {
      assert.deepEqual(validateMetricLabels({ [key]: value }), {
        ok: true,
        labels: { [key]: value },
      });
    }
  }
  const labels = {
    environment: 'production',
    service: 'cityvue-api',
    statusClass: '2xx',
    endpointClass: 'resident',
  };
  assert.deepEqual(validateMetricLabels(labels), { ok: true, labels });
});

test('PII, secrets, identifiers, restricted attributes and unknown names fail closed', () => {
  for (const key of [
    ...forbiddenAttributes,
    ...metricOnlyForbiddenAttributes,
    ...restrictedAttributes,
    'tenantId',
    'custom',
    'Environment',
    '__proto__',
    'constructor',
    'toString',
  ]) {
    assert.deepEqual(validateMetricLabels({ [key]: 'PRIVATE_SENTINEL' }), {
      ok: false,
      reason: 'unknown_attribute',
    });
  }
  assert.deepEqual(
    validateMetricLabels({ [Symbol('private')]: 'PRIVATE_SENTINEL' }),
    { ok: false, reason: 'unknown_attribute' },
  );
  assert.equal(restrictedAttributePolicy.metricLabels, 'forbidden');
  assert.equal(
    restrictedAttributePolicy.logsAndTraces,
    'explicit_privacy_and_operations_review_required',
  );
});

test('approved names cannot carry unbounded or structured payloads', () => {
  for (const value of [
    'resident@example.invalid',
    '/api/v1/service-requests/private-id',
    'https://example.invalid/?secret=value',
    '?tracking=private',
    'Error: private details',
    'Bearer PRIVATE',
    '',
    200,
    null,
    {},
    ['GET'],
  ]) {
    for (const key of Object.keys(metricDimensions)) {
      assert.deepEqual(validateMetricLabels({ [key]: value }), {
        ok: false,
        reason: 'invalid_value',
      });
    }
  }
});

test('non-data objects, hidden properties and getters are refused without evaluating getters', () => {
  for (const input of [
    null,
    undefined,
    'GET',
    1,
    [],
    new Date(),
    Object.create({ environment: 'test' }) as unknown,
  ]) {
    assert.deepEqual(validateMetricLabels(input), {
      ok: false,
      reason: 'invalid_shape',
    });
  }
  let calls = 0;
  const getter = Object.defineProperty({}, 'environment', {
    enumerable: true,
    get: () => {
      calls += 1;
      return 'test';
    },
  });
  assert.deepEqual(validateMetricLabels(getter), {
    ok: false,
    reason: 'invalid_shape',
  });
  assert.equal(calls, 0);
  assert.deepEqual(
    validateMetricLabels(
      Object.defineProperty({}, 'environment', { value: 'test' }),
    ),
    { ok: false, reason: 'invalid_shape' },
  );
  const hostile = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('PRIVATE_SENTINEL');
      },
    },
  );
  assert.deepEqual(validateMetricLabels(hostile), {
    ok: false,
    reason: 'invalid_shape',
  });
});

test('label count and Cartesian cardinality are independently bounded', () => {
  assert.deepEqual(
    validateMetricLabels({
      service: 'cityvue-api',
      environment: 'test',
      releaseCohort: 'current',
      healthSignal: 'liveness',
      outcome: 'succeeded',
    }),
    { ok: false, reason: 'cardinality_budget' },
  );
  assert.deepEqual(
    validateMetricLabels({
      method: 'GET',
      operation: 'read',
      outcome: 'succeeded',
    }),
    { ok: false, reason: 'cardinality_budget' },
  );
  assert.deepEqual(validateMetricLabels({}), { ok: true, labels: {} });
});

test('accepted labels are detached immutable snapshots and vocabularies are immutable', () => {
  const input = { environment: 'test' };
  const result = validateMetricLabels(input);
  assert.equal(result.ok, true);
  input.environment = 'PRIVATE_SENTINEL';
  assert.deepEqual(result.labels, { environment: 'test' });
  assert.ok(Object.isFrozen(result.labels));
  assert.ok(Object.isFrozen(metricDimensions));
  assert.ok(Object.values(metricDimensions).every(Object.isFrozen));
  assert.ok(Object.isFrozen(metricConcepts));
});

test('operational signals cannot satisfy authoritative audit and correlation fields stay distinct', () => {
  for (const kind of ['operational_log', 'trace', 'metric'] as const) {
    const evidence: TelemetryEvidence = {
      kind,
      satisfiesAuthoritativeAudit: false,
    };
    assert.equal(
      signalResponsibilities[evidence.kind].authoritativeAudit,
      false,
    );
  }
  const audit: AuthoritativeAuditRequirement = {
    kind: 'authoritative_audit',
    storage: 'reqro_audit_storage',
    telemetrySubstitution: 'forbidden',
  };
  assert.equal(signalResponsibilities[audit.kind].authoritativeAudit, true);
  assert.equal(signalResponsibilities.operational_log.owner, 'pino');
  assert.equal(signalResponsibilities.trace.owner, 'future_opentelemetry');
  assert.equal(signalResponsibilities.metric.owner, 'future_opentelemetry');
  // @ts-expect-error Authoritative audit is not a telemetry signal.
  const invalid: TelemetryEvidence = audit;
  void invalid;
  // @ts-expect-error Correlation cannot be a metric dimension.
  const labels: MetricLabels = { reqroCorrelationId: 'synthetic' };
  void labels;
  const refs: CorrelationReferences = {
    reqroCorrelationId: 'server-uuid',
    w3cTraceId: 'trace',
    w3cSpanId: 'span',
  };
  assert.equal(new Set(Object.values(refs)).size, 3);
  assert.equal(
    correlationPolicy.reqroCorrelationId,
    'existing_server_generated_uuid',
  );
  assert.equal(correlationPolicy.inboundContextAuthority, 'none');
  assert.equal(correlationPolicy.tenantAuthorityFromTrace, false);
  assert.equal(correlationPolicy.authenticationAuthorityFromTrace, false);
  assert.equal(correlationPolicy.traceIdReplacesCorrelationId, false);
  assert.equal(correlationPolicy.spanIdReplacesCorrelationId, false);
  assert.equal(correlationPolicy.auditIdentityFromTrace, false);
  assert.equal(correlationPolicy.metricLabels, 'forbidden');
});

test('SLI metadata uses neutral concepts without assigning a production target', () => {
  const definition = {
    identifier: 'request-success',
    description: 'Eligible successful requests',
    numerator: {
      concept: 'request_count',
      population: 'eligible successful requests',
    },
    denominator: {
      concept: 'request_count',
      population: 'all eligible requests',
    },
    window: 'rolling',
    scope: 'platform',
    maintenance: 'included',
    dependencyHandling: 'include_eligible_dependency_failures',
    owner: { status: 'unassigned' },
    target: { status: 'provisional' },
  } satisfies SliDefinition;
  assert.deepEqual(definition.target, { status: 'provisional' });
  assert.equal(metricConcepts.integration_delivery_latency, 'milliseconds');
  assert.equal(metricConcepts.integration_retry_count, 'count');
  assert.equal(metricConcepts.integration_dead_letter_count, 'count');
  assert.equal(metricConcepts.integration_reconciliation_failure, 'count');
});

test('AST boundary permits only local contracts and pure built-ins, with no runtime consumers', () => {
  const root = resolve(__dirname, '../../..');
  const area = join(root, 'src/observability');
  const files = readdirSync(area).sort();
  assert.deepEqual(files, ['metric-label-policy.ts', 'telemetry-contracts.ts']);
  const pureCalls = new Set([
    'Object.freeze',
    'Object.getPrototypeOf',
    'Object.hasOwn',
    'Object.getOwnPropertyDescriptor',
    'Reflect.ownKeys',
    'allowed.includes',
  ]);
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(area, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node)) {
        assert.ok(ts.isStringLiteral(node.moduleSpecifier));
        assert.equal(node.moduleSpecifier.text, './telemetry-contracts.js');
      }
      assert.equal(
        ts.isNewExpression(node),
        false,
        'No SDK/client/instrument construction',
      );
      assert.equal(ts.isExportDeclaration(node), false, 'No re-export escape');
      if (ts.isCallExpression(node))
        assert.ok(
          pureCalls.has(node.expression.getText(source)),
          'Only approved pure operations; no network, persistence, SDK or header parsing calls',
        );
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  const scan = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (path === area) continue;
      if (entry.isDirectory()) {
        scan(path);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      const source = ts.createSourceFile(
        path,
        readFileSync(path, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isStringLiteral(node) &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            ts.isCallExpression(node.parent))
        ) {
          assert.equal(
            node.text.includes('observability/'),
            false,
            `Unexpected runtime consumer: ${entry.name}`,
          );
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  scan(join(root, 'src'));
});

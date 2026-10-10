import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, relative, sep } from 'node:path';
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

/**
 * F061.1A. The closed reviewed-consumer allowlist.
 *
 * F061.1 shipped with **zero** runtime consumers, and the boundary test
 * asserted that absolutely. That was correct while nothing consumed the
 * policy, but zero-consumer status was always temporary: the point of a
 * provider-neutral telemetry policy is that application code defers to it
 * rather than inventing its own.
 *
 * F062.1 is the **first explicitly reviewed consumer**. It reached this
 * boundary because its own draft maintained a competing metric-label policy
 * that classified `connectorId` as permitted, which F061.1 forbids; deferring
 * to this module is the fix.
 *
 * The invariant is therefore now a **closed allowlist of exact paths**, not a
 * directory allowance. `src/integration/` as a whole is deliberately *not*
 * permitted: only the one integration module that owns the telemetry seam may
 * import the policy, so a future consumer requires another explicit review of
 * this list rather than inheriting access from its neighbours.
 */
const REVIEWED_TELEMETRY_CONSUMERS: readonly string[] = [
  'src/integration/integration-telemetry.ts',
];

/** Repo-relative, posix-normalized path of a scanned file. */
const relativePosix = (root: string, path: string): string =>
  relative(root, path).split(sep).join('/');

/** Pure predicate, so the allowlist mechanism can be exercised with synthetic
 * inputs rather than only against whatever files happen to exist. */
const isReviewedTelemetryConsumer = (relativePath: string): boolean =>
  REVIEWED_TELEMETRY_CONSUMERS.includes(relativePath);

test('the reviewed-consumer allowlist is closed and exact', () => {
  // F061.1A reviewed exactly one integration consumer; tracing edges are separate.
  assert.deepEqual(REVIEWED_TELEMETRY_CONSUMERS, [
    'src/integration/integration-telemetry.ts',
  ]);
  assert.ok(
    isReviewedTelemetryConsumer('src/integration/integration-telemetry.ts'),
  );
  // Exercised with synthetic paths because the mechanism must hold whether or
  // not the consumer is present in this working tree: F062.1 is still
  // unpublished, so the real file may be absent here.
  for (const refused of [
    // a sibling in the same directory inherits nothing
    'src/integration/connector-registry.ts',
    'src/integration/index.ts',
    // a directory allowance is not what was granted
    'src/integration/telemetry.ts',
    'src/integration/sub/integration-telemetry.ts',
    // a same-basename file elsewhere must not pass: the allowlist is a path,
    // not a filename
    'src/notifications/integration-telemetry.ts',
    'src/service-request/integration-telemetry.ts',
    // unrelated application areas
    'src/database/database.service.ts',
    'src/tenancy/tenant-context.ts',
    'src/main.ts',
  ])
    assert.equal(isReviewedTelemetryConsumer(refused), false, refused);
});

test('AST boundary permits only local contracts, pure built-ins and reviewed consumers', () => {
  const root = resolve(__dirname, '../../..');
  const area = join(root, 'src/observability');
  // Exact source -> target edges, including consumers INSIDE observability.
  // Directory membership never grants permission to consume the contracts.
  const allowedEdges = new Map<string, readonly string[]>([
    [
      'src/observability/request-metrics.module.ts',
      [
        'src/observability/request-metrics.ts',
        'src/observability/request-metrics.middleware.ts',
      ],
    ],
    [
      'src/observability/request-metrics.middleware.ts',
      ['src/observability/request-metrics.ts'],
    ],
    [
      'src/observability/request-metrics.ts',
      [
        'src/observability/telemetry-contracts.ts',
        'src/observability/metric-label-policy.ts',
      ],
    ],
    [
      'src/app.module.ts',
      [
        'src/observability/request-tracing.module.ts',
        'src/observability/request-metrics.module.ts',
        'src/observability/request-metrics.middleware.ts',
        'src/observability/request-tracing.middleware.ts',
      ],
    ],
    [
      'src/observability/request-tracing.module.ts',
      [
        'src/observability/request-tracing.ts',
        'src/observability/request-tracing.middleware.ts',
      ],
    ],
    [
      'src/observability/request-tracing.middleware.ts',
      ['src/observability/request-tracing.ts'],
    ],
    [
      'src/observability/request-tracing.ts',
      ['src/observability/telemetry-contracts.ts'],
    ],
    [
      'src/observability/metric-label-policy.ts',
      ['src/observability/telemetry-contracts.ts'],
    ],
  ]);
  const checkEdge = (path: string, specifier: string): void => {
    if (!specifier.startsWith('.')) return;
    const target = resolve(dirname(path), specifier).replace(/\.js$/, '.ts');
    if (target !== area && !target.startsWith(area + sep)) return;
    const importer = relativePosix(root, path);
    const destination = relativePosix(root, target);
    // F061.1A authorized this exact integration path against the two existing
    // policy modules. New tracing modules do not expand that target scope.
    const reviewedPolicyEdge =
      isReviewedTelemetryConsumer(importer) &&
      [
        'src/observability/telemetry-contracts.ts',
        'src/observability/metric-label-policy.ts',
      ].includes(destination);
    assert.ok(
      reviewedPolicyEdge || allowedEdges.get(importer)?.includes(destination),
      `Unapproved observability edge: ${importer} -> ${destination}`,
    );
  };
  for (const importer of [
    'src/observability/future.ts',
    'src/observability/nested/request-metrics.ts',
    'src/observability/request-metrics.middleware.ts',
    'src/observability/request-metrics.module.ts',
    'src/observability/request-tracing.module.ts',
    'src/integration/connector-registry.ts',
    'src/app.module.ts',
  ]) {
    assert.throws(() => {
      checkEdge(
        join(root, importer),
        importer === 'src/app.module.ts'
          ? './observability/telemetry-contracts.js'
          : '../observability/telemetry-contracts.js',
      );
    }, /Unapproved observability edge/);
  }
  assert.throws(() => {
    checkEdge(join(root, 'src/future.ts'), './observability');
  }, /Unapproved observability edge/);
  // Positive target checks do not require F062.1 implementation to exist.
  for (const target of ['telemetry-contracts', 'metric-label-policy']) {
    assert.doesNotThrow(() => {
      checkEdge(
        join(root, 'src/integration/integration-telemetry.ts'),
        `../observability/${target}.js`,
      );
    });
  }
  for (const target of [
    'request-tracing',
    'request-tracing.module',
    'request-tracing.middleware',
    'future',
  ]) {
    assert.throws(() => {
      checkEdge(
        join(root, 'src/integration/integration-telemetry.ts'),
        `../observability/${target}.js`,
      );
    }, /Unapproved observability edge/);
  }
  const files = ['metric-label-policy.ts', 'telemetry-contracts.ts'];
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
        // The only import the policy may have is its own sibling contract.
        // This single equality is what keeps the policy provider-neutral: a
        // monitoring vendor type cannot be referenced without importing it,
        // and it also prevents observability from depending on integration,
        // preserving the one-way direction integration -> observability.
        assert.equal(node.moduleSpecifier.text, './telemetry-contracts.js');
        assert.ok(
          !/integration|@azure|opentelemetry|applicationinsights|aws-sdk|@google-cloud/i.test(
            node.moduleSpecifier.text,
          ),
          'The provider-neutral contract must not import a consumer or a monitoring vendor',
        );
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
          checkEdge(path, node.text);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
  };
  scan(join(root, 'src'));
});

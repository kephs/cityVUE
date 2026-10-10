import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTelemetryExportBoundary,
  telemetryExportPolicy,
  noOpTelemetryExportSink,
  type ApprovedTelemetryExportRecord,
  type TelemetryExportRecord,
  type TelemetryExportSink,
} from '../../src/observability/telemetry-export.js';
import {
  forbiddenAttributes,
  restrictedAttributes,
  metricOnlyForbiddenAttributes,
} from '../../src/observability/telemetry-contracts.js';
import { createTestTelemetryExportSink } from '../helpers/telemetry-export-sink.js';

const metric = () => ({
  signal: 'metric',
  concept: 'request_duration',
  value: 12.5,
  timestampMs: 1000,
  resource: { service: 'cityvue-api', deployment: null, instance: null },
  labels: {
    method: 'GET',
    routeTemplate: '/api/v1/service-requests',
    statusClass: '2xx',
  },
});
const trace = () => ({
  signal: 'trace',
  operation: 'http_request',
  durationMs: 12.5,
  timestampMs: 1000,
  resource: { service: 'cityvue-api', deployment: null, instance: null },
  attributes: {
    'http.request.method': 'GET',
    'http.route': '/api/v1/service-requests',
    'http.response.status_code': 200,
    'reqro.outcome': 'succeeded',
    'reqro.reason': 'none',
  },
});
const rejected = { status: 'rejected', reason: 'privacy_policy' };

test('default boundary validates and intentionally discards both approved signals', () => {
  const boundary = createTelemetryExportBoundary();
  for (const input of [
    metric(),
    trace(),
    { ...metric(), concept: 'request_count', value: 1 },
  ])
    assert.deepEqual(boundary.submit(input), {
      status: 'accepted',
      disposition: 'discarded',
    });
});

test('all F061 forbidden/restricted names and arbitrary aliases are rejected before invocation', () => {
  let calls = 0;
  const boundary = createTelemetryExportBoundary({
    accept: () => {
      calls++;
      throw Error('unreachable');
    },
  });
  for (const key of [
    ...forbiddenAttributes,
    ...restrictedAttributes,
    ...metricOnlyForbiddenAttributes,
    'replicaId',
    'deployment',
    'instance',
    'vendorStatus',
    'vendorError',
    'arbitrary',
  ]) {
    for (const input of [
      {
        ...metric(),
        labels: { ...metric().labels, [key]: 'PRIVATE_SENTINEL' },
      },
      {
        ...trace(),
        attributes: { ...trace().attributes, [key]: 'PRIVATE_SENTINEL' },
      },
      { ...metric(), [key]: 'PRIVATE_SENTINEL' },
      {
        ...trace(),
        resource: { ...trace().resource, [key]: 'PRIVATE_SENTINEL' },
      },
    ])
      assert.deepEqual(boundary.submit(input), rejected);
  }
  assert.equal(calls, 0);
});

test('allowed names do not admit arbitrary payload values or raw route/host/query data', () => {
  const boundary = createTelemetryExportBoundary();
  for (const value of [
    'person@example.invalid',
    '+1-555-0100',
    '123 Private Street',
    'Bearer PRIVATE',
    'https://tenant.invalid/request/123?token=PRIVATE',
    '/api/v1/service-requests/123',
    'tenant.invalid, proxy.invalid',
    'Error: PRIVATE',
    {},
    [],
    null,
  ]) {
    for (const key of Object.keys(metric().labels))
      assert.deepEqual(
        boundary.submit({
          ...metric(),
          labels: { ...metric().labels, [key]: value },
        }),
        rejected,
      );
    for (const key of Object.keys(trace().attributes))
      assert.deepEqual(
        boundary.submit({
          ...trace(),
          attributes: { ...trace().attributes, [key]: value },
        }),
        rejected,
      );
  }
});

test('audit and operational logging cannot enter the export signal contract', () => {
  for (const signal of [
    'authoritative_audit',
    'operational_log',
    'log',
    'audit',
  ])
    assert.deepEqual(
      createTelemetryExportBoundary().submit({ ...metric(), signal }),
      rejected,
    );
  // @ts-expect-error Audit is not an export signal, even at compile time.
  const signal: TelemetryExportRecord['signal'] = 'authoritative_audit';
  void signal;
  assert.deepEqual(
    createTelemetryExportBoundary().submit({
      ...trace(),
      satisfiesAuthoritativeAudit: true,
    }),
    rejected,
  );
});

test('resource references are detached metadata, never ordinary business dimensions', () => {
  const sink = createTestTelemetryExportSink();
  const boundary = createTelemetryExportBoundary(sink.sink);
  for (const instance of [1, 2]) {
    assert.equal(
      boundary.submit({
        ...metric(),
        resource: { service: 'cityvue-api', deployment: 1, instance },
      }).status,
      'accepted',
    );
  }
  assert.notDeepEqual(
    sink.snapshot()[0]?.resource,
    sink.snapshot()[1]?.resource,
  );
  for (const key of [
    'service',
    'deployment',
    'instance',
    'service.instance.id',
  ])
    assert.deepEqual(
      boundary.submit({
        ...metric(),
        labels: { ...metric().labels, [key]: 1 },
      }),
      rejected,
    );
  for (const value of ['tenant.invalid', 'pod-1', -1, 65536, 1.5, Infinity, {}])
    for (const key of ['deployment', 'instance'])
      assert.deepEqual(
        boundary.submit({
          ...metric(),
          resource: { ...metric().resource, [key]: value },
        }),
        rejected,
      );
});

test('no-op and test sinks reject forged approval, copied tokens and raw SDK-like objects', () => {
  for (const input of [metric(), trace(), {}, null, { span: trace() }]) {
    assert.deepEqual(
      noOpTelemetryExportSink.accept(input as ApprovedTelemetryExportRecord),
      rejected,
    );
    assert.deepEqual(
      createTestTelemetryExportSink().sink.accept(
        input as ApprovedTelemetryExportRecord,
      ),
      rejected,
    );
  }
  const approved = telemetryExportPolicy.validate(metric());
  assert.ok(approved.ok);
  assert.deepEqual(noOpTelemetryExportSink.accept(approved.record), {
    status: 'accepted',
    disposition: 'discarded',
  });
  assert.deepEqual(
    noOpTelemetryExportSink.accept({ ...approved.record }),
    rejected,
  );
});

test('approved records are detached deeply frozen snapshots and cannot be poisoned later', () => {
  const input = metric();
  const sink = createTestTelemetryExportSink();
  createTelemetryExportBoundary(sink.sink).submit(input);
  input.labels.method = 'PRIVATE';
  input.resource.service = 'PRIVATE';
  input.value = -1;
  const record = sink.snapshot()[0];
  assert.ok(record?.signal === 'metric');
  assert.equal(record.labels.method, 'GET');
  assert.equal(record.resource.service, 'cityvue-api');
  assert.equal(record.value, 12.5);
  for (const object of [
    record,
    record.labels,
    record.resource,
    sink.snapshot(),
  ])
    assert.ok(Object.isFrozen(object));
});

test('malformed, inherited, hidden and getter properties fail without getter evaluation', () => {
  let calls = 0;
  for (const input of [
    null,
    undefined,
    [],
    new Date(),
    Object.create(metric()) as unknown,
    { ...metric(), labels: Object.create(metric().labels) as unknown },
    { ...metric(), [Symbol('private')]: 'PRIVATE' },
    Object.defineProperty(metric(), 'value', { enumerable: false }),
    Object.defineProperty(metric(), 'signal', {
      get: () => {
        calls++;
        return 'metric';
      },
    }),
    {
      ...metric(),
      resource: Object.defineProperty({}, 'service', {
        get: () => {
          calls++;
          return 'cityvue-api';
        },
      }),
    },
    new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw Error('PRIVATE');
        },
      },
    ),
  ])
    assert.deepEqual(createTelemetryExportBoundary().submit(input), rejected);
  assert.equal(calls, 0);
});

test('finite observation bounds and exact request metric/trace schemas fail closed', () => {
  const boundary = createTelemetryExportBoundary();
  for (const value of [NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1, '12']) {
    assert.deepEqual(boundary.submit({ ...metric(), value }), rejected);
    assert.deepEqual(
      boundary.submit({ ...trace(), durationMs: value }),
      rejected,
    );
    assert.deepEqual(
      boundary.submit({ ...metric(), timestampMs: value }),
      rejected,
    );
  }
  for (const input of [
    { ...metric(), timestampMs: 0.5 },
    { ...metric(), concept: 'integration_retry_count' },
    { ...metric(), concept: 'request_count', value: 2 },
    { ...trace(), operation: 'PRIVATE' },
    { ...metric(), labels: { method: 'GET' } },
    { ...trace(), attributes: {} },
    {
      ...trace(),
      attributes: { ...trace().attributes, 'reqro.outcome': 'failed' },
    },
    {
      ...trace(),
      attributes: {
        ...trace().attributes,
        'reqro.correlation_id': 'synthetic',
      },
    },
  ])
    assert.deepEqual(boundary.submit(input), rejected);
});

test('trace status projection preserves F061.2A outcomes and refuses invalid status codes', () => {
  const boundary = createTelemetryExportBoundary();
  for (const status of [0, 100, 200, 399, 400, 499, 500, 599]) {
    const outcome =
      status === 0 || status >= 500
        ? 'failed'
        : status >= 400
          ? 'refused'
          : 'succeeded';
    assert.equal(
      boundary.submit({
        ...trace(),
        attributes: {
          ...trace().attributes,
          'http.response.status_code': status,
          'reqro.outcome': outcome,
          'reqro.reason': outcome === 'failed' ? 'unknown' : 'none',
        },
      }).status,
      'accepted',
    );
  }
  for (const status of [-1, 99, 600, 200.5, NaN, '200'])
    assert.deepEqual(
      boundary.submit({
        ...trace(),
        attributes: {
          ...trace().attributes,
          'http.response.status_code': status,
        },
      }),
      rejected,
    );
});

test('test sink is deterministic, capped and drops newest without leaking storage', () => {
  const sink = createTestTelemetryExportSink(2);
  const boundary = createTelemetryExportBoundary(sink.sink);
  for (let i = 0; i < 10; i++)
    assert.deepEqual(
      boundary.submit({ ...metric(), value: i }),
      i < 2
        ? { status: 'accepted', disposition: 'consumed' }
        : { status: 'dropped', reason: 'capacity' },
    );
  assert.deepEqual(
    sink
      .snapshot()
      .map((record) => (record.signal === 'metric' ? record.value : -1)),
    [0, 1],
  );
  for (const limit of [0, -1, 65, 1.5, NaN, Infinity])
    assert.throws(() => createTestTelemetryExportSink(limit), RangeError);
});

test('sink throws and malformed results cannot escape or leak into business behavior', () => {
  const sinks: TelemetryExportSink[] = [
    {
      accept: () => {
        throw Error('PRIVATE');
      },
    },
    { accept: () => ({ status: 'accepted', disposition: 'PRIVATE' }) as never },
    {
      accept: () =>
        ({
          status: 'accepted',
          disposition: 'discarded',
          secret: 'PRIVATE',
        }) as never,
    },
    { accept: () => Promise.resolve('PRIVATE') as never },
    Object.defineProperty({}, 'accept', {
      get: () => {
        throw Error('PRIVATE');
      },
    }) as TelemetryExportSink,
  ];
  for (const sink of sinks) {
    const result = createTelemetryExportBoundary(sink).submit(metric());
    assert.deepEqual(result, { status: 'failed', reason: 'sink_failure' });
  }
});

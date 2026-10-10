import { validateMetricLabels } from './metric-label-policy.js';
import { metricDimensions, type MetricLabels } from './telemetry-contracts.js';

/** Process-local opaque references, never infrastructure identifiers or authority.
 * Null means unassigned. Assignment/lifetime and fleet writer identity are future gates.
 */
export interface TelemetryResourceIdentity {
  readonly service: 'cityvue-api';
  readonly deployment: number | null;
  readonly instance: number | null;
}
export type RequestExportLabels = Required<
  Pick<MetricLabels, 'method' | 'routeTemplate' | 'statusClass'>
>;
interface ExportMetadata {
  readonly timestampMs: number;
  readonly resource: TelemetryResourceIdentity;
}
export type TelemetryExportRecord = ExportMetadata &
  (
    | {
        readonly signal: 'metric';
        readonly concept: 'request_count' | 'request_duration';
        readonly value: number;
        readonly labels: RequestExportLabels;
      }
    | {
        readonly signal: 'trace';
        readonly operation: 'http_request';
        readonly durationMs: number;
        readonly attributes: Readonly<{
          'http.request.method': RequestExportLabels['method'];
          'http.route': RequestExportLabels['routeTemplate'];
          'http.response.status_code': number;
          'reqro.outcome': 'succeeded' | 'refused' | 'failed';
          'reqro.reason': 'none' | 'unknown';
        }>;
      }
  );

declare const approved: unique symbol;
export type ApprovedTelemetryExportRecord = TelemetryExportRecord & {
  readonly [approved]: true;
};
export type TelemetryExportResult =
  | {
      readonly status: 'accepted';
      readonly disposition: 'discarded' | 'consumed';
    }
  | { readonly status: 'rejected'; readonly reason: 'privacy_policy' }
  | { readonly status: 'dropped'; readonly reason: 'capacity' }
  | { readonly status: 'failed'; readonly reason: 'sink_failure' };
export interface TelemetryExportSink {
  accept(record: ApprovedTelemetryExportRecord): TelemetryExportResult;
}
export type TelemetryExportPolicyResult =
  | { readonly ok: true; readonly record: ApprovedTelemetryExportRecord }
  | { readonly ok: false; readonly reason: 'privacy_policy' };
export interface TelemetryExportPolicy {
  validate(input: unknown): TelemetryExportPolicyResult;
}

// Weak membership proves passage through this gate, without retaining records.
const approvals = new WeakSet<object>();
const refused = Object.freeze({ ok: false, reason: 'privacy_policy' } as const);
const rejected = Object.freeze({
  status: 'rejected',
  reason: 'privacy_policy',
} as const);
const discarded = Object.freeze({
  status: 'accepted',
  disposition: 'discarded',
} as const);
const consumed = Object.freeze({
  status: 'accepted',
  disposition: 'consumed',
} as const);
const capacity = Object.freeze({
  status: 'dropped',
  reason: 'capacity',
} as const);
const failed = Object.freeze({
  status: 'failed',
  reason: 'sink_failure',
} as const);

/** Exact own enumerable data properties only; no ordinary getter execution. */
const data = (
  input: unknown,
  keys: readonly string[],
): Record<string, unknown> | undefined => {
  if (input === null || typeof input !== 'object') return;
  const prototype: unknown = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) return;
  const actual = Reflect.ownKeys(input);
  if (actual.length !== keys.length) return;
  const result: Record<string, unknown> = {};
  for (const key of actual) {
    if (typeof key !== 'string' || !keys.includes(key)) return;
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      !descriptor ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable
    )
      return;
    result[key] = descriptor.value as unknown;
  }
  return result;
};
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= Number.MAX_SAFE_INTEGER;
const reference = (value: unknown): value is number | null =>
  value === null ||
  (nonnegative(value) && Number.isInteger(value) && value <= 65535);
const member = <T extends string>(
  value: unknown,
  values: readonly T[],
): value is T => typeof value === 'string' && values.includes(value as T);

const validate = (input: unknown): TelemetryExportPolicyResult => {
  try {
    // Inspect the discriminant as a data descriptor, never via a caller getter.
    if (input === null || typeof input !== 'object') return refused;
    const kind = Object.getOwnPropertyDescriptor(input, 'signal');
    const signal: unknown =
      kind && Object.hasOwn(kind, 'value') ? kind.value : undefined;
    if (signal !== 'trace' && signal !== 'metric') return refused;
    const record = data(
      input,
      signal === 'metric'
        ? ['signal', 'concept', 'value', 'labels', 'timestampMs', 'resource']
        : [
            'signal',
            'operation',
            'durationMs',
            'attributes',
            'timestampMs',
            'resource',
          ],
    );
    if (
      record?.signal !== signal ||
      !nonnegative(record.timestampMs) ||
      !Number.isInteger(record.timestampMs)
    )
      return refused;
    const identity = data(record.resource, [
      'service',
      'deployment',
      'instance',
    ]);
    if (
      identity?.service !== metricDimensions.service[0] ||
      !reference(identity.deployment) ||
      !reference(identity.instance)
    )
      return refused;
    const resource = Object.freeze({
      service: identity.service,
      deployment: identity.deployment,
      instance: identity.instance,
    });
    let snapshot: TelemetryExportRecord;
    if (signal === 'metric') {
      const labels = data(record.labels, [
        'method',
        'routeTemplate',
        'statusClass',
      ]);
      const policy = validateMetricLabels(labels);
      if (
        !labels ||
        !policy.ok ||
        !nonnegative(record.value) ||
        (record.concept !== 'request_count' &&
          record.concept !== 'request_duration') ||
        (record.concept === 'request_count' && record.value !== 1)
      )
        return refused;
      // The exact schema and F061.1 validator established all three required labels.
      snapshot = {
        signal,
        concept: record.concept,
        value: record.value,
        labels: policy.labels as RequestExportLabels,
        timestampMs: record.timestampMs,
        resource,
      };
    } else {
      const attributes = data(record.attributes, [
        'http.request.method',
        'http.route',
        'http.response.status_code',
        'reqro.outcome',
        'reqro.reason',
      ]);
      if (
        !attributes ||
        record.operation !== 'http_request' ||
        !nonnegative(record.durationMs)
      )
        return refused;
      const method = attributes['http.request.method'];
      const route = attributes['http.route'];
      const status = attributes['http.response.status_code'];
      if (
        !member(method, metricDimensions.method) ||
        !member(route, metricDimensions.routeTemplate) ||
        typeof status !== 'number' ||
        !Number.isInteger(status) ||
        (status !== 0 && (status < 100 || status > 599))
      )
        return refused;
      // Match F061.2A's existing closed outcome/reason projection; no error text.
      const outcome =
        status === 0 || status >= 500
          ? 'failed'
          : status >= 400
            ? 'refused'
            : 'succeeded';
      const reason = outcome === 'failed' ? 'unknown' : 'none';
      if (
        attributes['reqro.outcome'] !== outcome ||
        attributes['reqro.reason'] !== reason
      )
        return refused;
      snapshot = {
        signal,
        operation: 'http_request',
        durationMs: record.durationMs,
        timestampMs: record.timestampMs,
        resource,
        attributes: Object.freeze({
          'http.request.method': method,
          'http.route': route,
          'http.response.status_code': status,
          'reqro.outcome': outcome,
          'reqro.reason': reason,
        }),
      };
    }
    Object.freeze(snapshot);
    approvals.add(snapshot);
    return { ok: true, record: snapshot as ApprovedTelemetryExportRecord };
  } catch {
    // Reflection on hostile proxies can throw; never echo input or exceptions.
    return refused;
  }
};

export const telemetryExportPolicy: TelemetryExportPolicy = Object.freeze({
  validate,
});
export const isApprovedTelemetryExportRecord = (
  input: unknown,
): input is ApprovedTelemetryExportRecord =>
  typeof input === 'object' && input !== null && approvals.has(input);

/** No I/O, timers, retry, buffering or diagnostics. Reject forged approval casts. */
export const noOpTelemetryExportSink: TelemetryExportSink = Object.freeze({
  accept: (record: ApprovedTelemetryExportRecord): TelemetryExportResult =>
    isApprovedTelemetryExportRecord(record) ? discarded : rejected,
});

/** Injection is a reviewed extension/test seam, never configuration or discovery.
 * No production caller supplies a sink. Synchronous exceptions are contained;
 * arbitrary injected code is not sandboxed or made time-bounded by this wrapper.
 */
export const createTelemetryExportBoundary = (
  sink: TelemetryExportSink = noOpTelemetryExportSink,
) =>
  Object.freeze({
    submit: (input: unknown): TelemetryExportResult => {
      const policy = validate(input);
      if (!policy.ok) return rejected;
      try {
        const output: unknown = sink.accept(policy.record);
        const result = data(output, ['status', 'disposition']);
        if (result?.status === 'accepted') {
          if (result.disposition === 'discarded') return discarded;
          if (result.disposition === 'consumed') return consumed;
        }
        const refusal = data(output, ['status', 'reason']);
        if (refusal?.status === 'dropped' && refusal.reason === 'capacity')
          return capacity;
        if (
          refusal?.status === 'rejected' &&
          refusal.reason === 'privacy_policy'
        )
          return rejected;
        return failed;
      } catch {
        return failed;
      }
    },
  });

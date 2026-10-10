import { ROOT_CONTEXT } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { MeterProvider, type MetricReader } from '@opentelemetry/sdk-metrics';
import { validateMetricLabels } from './metric-label-policy.js';
import { metricDimensions } from './telemetry-contracts.js';

export interface RequestMetricObservation {
  readonly durationMs: number;
  readonly method: unknown;
  readonly routeTemplate: unknown;
  readonly statusCode: unknown;
  readonly aborted: boolean;
}
export interface MetricsRuntime {
  record(labels: unknown, durationMs: number): void;
  shutdown(): Promise<void>;
}
export type MetricsRuntimeFactory = () => MetricsRuntime;

/** Private provider, no global registration, detectors, timers or exporters.
 * Reader injection is exclusively for deterministic tests; runtime supplies none.
 */
export const createMetricsRuntime = (
  readers: MetricReader[] = [],
): MetricsRuntime => {
  const provider = new MeterProvider({
    resource: resourceFromAttributes({ 'service.name': 'cityvue-api' }),
    readers,
  });
  const meter = provider.getMeter('reqro.request-metrics');
  const requests = meter.createCounter('reqro.http.server.requests', {
    unit: '{request}',
  });
  const duration = meter.createHistogram('reqro.http.server.request.duration', {
    unit: 'ms',
    advice: {
      explicitBucketBoundaries: [
        5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000,
      ],
    },
  });
  return {
    record: (labels, durationMs) => {
      // The existing F061.1 validator is the only label policy authority.
      const result = validateMetricLabels(labels);
      if (!result.ok || !Number.isFinite(durationMs) || durationMs < 0) return;
      requests.add(1, result.labels, ROOT_CONTEXT);
      duration.record(durationMs, result.labels, ROOT_CONTEXT);
    },
    shutdown: () => provider.shutdown(),
  };
};

// Same exact health templates excluded by F061.2A; no raw URL fallback.
const healthTemplates: readonly string[] = [
  '/api/v1/health',
  '/api/v1/health/live',
  '/api/v1/health/ready',
];
const methods: readonly string[] = metricDimensions.method;
const routes: readonly string[] = metricDimensions.routeTemplate;

export class RequestMetrics {
  readonly enabled: boolean;
  private readonly runtime: MetricsRuntime | undefined;

  constructor(
    enabled: boolean,
    factory: MetricsRuntimeFactory = createMetricsRuntime,
  ) {
    try {
      this.runtime = enabled ? factory() : undefined;
    } catch {
      this.runtime = undefined;
    }
    this.enabled = this.runtime !== undefined;
  }

  observe(input: RequestMetricObservation): void {
    if (!this.runtime) return;
    try {
      if (
        typeof input.routeTemplate === 'string' &&
        healthTemplates.includes(input.routeTemplate)
      )
        return;
      const routeTemplate =
        typeof input.routeTemplate === 'string' &&
        routes.includes(input.routeTemplate)
          ? input.routeTemplate
          : 'unmatched';
      const method =
        typeof input.method === 'string' && methods.includes(input.method)
          ? input.method
          : 'other';
      const statusClass =
        !input.aborted &&
        typeof input.statusCode === 'number' &&
        Number.isInteger(input.statusCode) &&
        input.statusCode >= 100 &&
        input.statusCode <= 599
          ? `${String(Math.floor(input.statusCode / 100))}xx`
          : 'no_response';
      const result = validateMetricLabels({
        method,
        routeTemplate,
        statusClass,
      });
      if (
        !result.ok ||
        !Number.isFinite(input.durationMs) ||
        input.durationMs < 0
      )
        return;
      this.runtime.record(result.labels, input.durationMs);
    } catch {
      /* Metric failure must never affect requests or expose diagnostic payloads. */
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.runtime?.shutdown();
    } catch {
      /* Preserve application shutdown. */
    }
  }
}

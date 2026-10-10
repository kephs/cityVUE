import { ROOT_CONTEXT, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  AlwaysOnSampler,
  TracerProvider,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace';
import { metricDimensions } from './telemetry-contracts.js';

export interface RequestObservation {
  readonly startTime: Date;
  readonly endTime: Date;
  readonly method: unknown;
  readonly routeTemplate: unknown;
  readonly statusCode: unknown;
  readonly correlationId: unknown;
  readonly aborted: boolean;
}
export interface SafeRequestTrace {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string | number>>;
  readonly failed: boolean;
  readonly startTime: Date;
  readonly endTime: Date;
}
/** Adapter boundary: controllers/domain code never receive SDK/exporter types. */
export interface TraceRuntime {
  record(trace: SafeRequestTrace): void;
  shutdown(): Promise<void>;
}
export type TraceRuntimeFactory = () => TraceRuntime;

/** No global registration, context manager, propagator, detector or exporter.
 * Processor injection is for deterministic tests; the application supplies none.
 */
export const createTraceRuntime = (
  spanProcessors: SpanProcessor[] = [],
): TraceRuntime => {
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'cityvue-api' }),
    sampler: new AlwaysOnSampler(),
    spanProcessors,
    spanLimits: {
      attributeCountLimit: 8,
      attributeValueLengthLimit: 80,
      eventCountLimit: 0,
      linkCountLimit: 0,
    },
  });
  const tracer = provider.getTracer('reqro.request-tracing');
  return {
    record: (observation) => {
      const span = tracer.startSpan(
        observation.name,
        {
          kind: SpanKind.SERVER,
          startTime: observation.startTime,
          attributes: observation.attributes,
        },
        ROOT_CONTEXT,
      );
      try {
        span.setStatus({
          code: observation.failed
            ? SpanStatusCode.ERROR
            : SpanStatusCode.UNSET,
        });
      } finally {
        span.end(observation.endTime);
      }
    },
    shutdown: () => provider.shutdown(),
  };
};

const healthTemplates: readonly string[] = [
  '/api/v1/health',
  '/api/v1/health/live',
  '/api/v1/health/ready',
];
const methods: readonly string[] = metricDimensions.method;
const routes: readonly string[] = metricDimensions.routeTemplate;
const serverUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class RequestTracing {
  readonly enabled: boolean;
  private readonly runtime: TraceRuntime | undefined;

  constructor(
    enabled: boolean,
    factory: TraceRuntimeFactory = createTraceRuntime,
  ) {
    try {
      this.runtime = enabled ? factory() : undefined;
    } catch {
      this.runtime = undefined;
    }
    this.enabled = this.runtime !== undefined;
  }

  observe(input: RequestObservation): void {
    if (!this.runtime) return;
    try {
      if (
        typeof input.routeTemplate === 'string' &&
        healthTemplates.includes(input.routeTemplate)
      )
        return;
      const route =
        typeof input.routeTemplate === 'string' &&
        routes.includes(input.routeTemplate)
          ? input.routeTemplate
          : 'unmatched';
      const method =
        typeof input.method === 'string' && methods.includes(input.method)
          ? input.method
          : 'other';
      const status =
        !input.aborted &&
        typeof input.statusCode === 'number' &&
        Number.isInteger(input.statusCode) &&
        input.statusCode >= 100 &&
        input.statusCode <= 599
          ? input.statusCode
          : 0;
      const outcome =
        status === 0 || status >= 500
          ? 'failed'
          : status >= 400
            ? 'refused'
            : 'succeeded';
      const attributes: Record<string, string | number> = {
        'http.request.method': method,
        'http.route': route,
        'http.response.status_code': status,
        'reqro.outcome': outcome,
        'reqro.reason': outcome === 'failed' ? 'unknown' : 'none',
      };
      if (
        typeof input.correlationId === 'string' &&
        serverUuid.test(input.correlationId)
      )
        attributes['reqro.correlation_id'] = input.correlationId;
      this.runtime.record({
        name: `${method} ${route}`,
        attributes: Object.freeze(attributes),
        failed: outcome === 'failed',
        startTime: input.startTime,
        endTime: input.endTime,
      });
    } catch {
      /* No diagnostic payloads; telemetry failure cannot escape. */
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.runtime?.shutdown();
    } catch {
      /* Preserve application shutdown even if telemetry fails. */
    }
  }
}

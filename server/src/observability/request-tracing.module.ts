import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import {
  RequestTracing,
  createTraceRuntime,
  type TraceRuntimeFactory,
} from './request-tracing.js';
import { RequestTracingMiddleware } from './request-tracing.middleware.js';

export const TRACE_RUNTIME_FACTORY = Symbol('TRACE_RUNTIME_FACTORY');

@Module({
  providers: [
    { provide: TRACE_RUNTIME_FACTORY, useValue: createTraceRuntime },
    {
      provide: RequestTracing,
      inject: [ConfigService, TRACE_RUNTIME_FACTORY],
      useFactory: (
        config: ConfigService<AppConfiguration, true>,
        factory: TraceRuntimeFactory,
      ) => {
        try {
          return new RequestTracing(
            config.get('telemetry.requestTracingEnabled', { infer: true }) ===
              true,
            factory,
          );
        } catch {
          return new RequestTracing(false);
        }
      },
    },
    RequestTracingMiddleware,
  ],
  exports: [RequestTracing, RequestTracingMiddleware],
})
export class RequestTracingModule {}

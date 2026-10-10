import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../config/configuration.js';
import {
  RequestMetrics,
  createMetricsRuntime,
  type MetricsRuntimeFactory,
} from './request-metrics.js';
import { RequestMetricsMiddleware } from './request-metrics.middleware.js';

export const METRICS_RUNTIME_FACTORY = Symbol('METRICS_RUNTIME_FACTORY');

@Module({
  providers: [
    { provide: METRICS_RUNTIME_FACTORY, useValue: createMetricsRuntime },
    {
      provide: RequestMetrics,
      inject: [ConfigService, METRICS_RUNTIME_FACTORY],
      useFactory: (
        config: ConfigService<AppConfiguration, true>,
        factory: MetricsRuntimeFactory,
      ) => {
        try {
          return new RequestMetrics(
            config.get('telemetry.requestMetricsEnabled', { infer: true }) ===
              true,
            factory,
          );
        } catch {
          return new RequestMetrics(false);
        }
      },
    },
    RequestMetricsMiddleware,
  ],
  exports: [RequestMetrics, RequestMetricsMiddleware],
})
export class RequestMetricsModule {}

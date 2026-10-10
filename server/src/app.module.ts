import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import {
  configuration,
  type AppConfiguration,
} from './config/configuration.js';
import { validateServingEnvironment } from './config/serving-environment.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { RequestLoggingMiddleware } from './common/logging/request-logging.middleware.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ServiceRequestModule } from './service-request/service-request.module.js';
import { LocationEligibilityModule } from './location-eligibility/location-eligibility.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AlertsModule } from './alerts/alerts.module.js';
import { AiModule } from './ai/ai.module.js';
import { GeospatialModule } from './geospatial/geospatial.module.js';
import { AdminModule } from './admin/admin.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ResidentExperienceModule } from './resident-experience/resident-experience.module.js';
import { TenancyModule } from './tenancy/tenancy.module.js';
import { TenantResolutionMiddleware } from './tenancy/tenant-resolution.middleware.js';
import { RequestTracingModule } from './observability/request-tracing.module.js';
import { RequestTracingMiddleware } from './observability/request-tracing.middleware.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateServingEnvironment,
    }),
    LoggingModule,
    RequestTracingModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>) => [
        {
          ttl: config.get('rateLimit.ttlMs', { infer: true }),
          limit: config.get('rateLimit.max', { infer: true }),
        },
      ],
    }),
    DatabaseModule,
    TenancyModule,
    AuthModule,
    AiModule,
    GeospatialModule,
    AdminModule,
    HealthModule,
    CatalogModule,
    AlertsModule,
    NotificationsModule,
    ResidentExperienceModule,
    LocationEligibilityModule,
    ServiceRequestModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Order matters: request logging assigns the server-owned correlation id
    // that tenant resolution records against. Tenant resolution only attaches
    // state and never terminates a request, so staff and admin routes are
    // unaffected and keep deriving Organization from verified identity.
    consumer
      .apply(
        RequestLoggingMiddleware,
        RequestTracingMiddleware,
        TenantResolutionMiddleware,
      )
      .forRoutes('*');
  }
}

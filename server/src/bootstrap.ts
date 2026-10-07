import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { AppConfiguration } from './config/configuration.js';
import {
  parseCorsOrigins,
  type TenantResolutionStrategy,
} from './config/environment.js';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import {
  parseTrustedProxyCidrs,
  type TenantHostSource,
} from './tenancy/tenant-host-source.js';
import { TenantResolutionMiddleware } from './tenancy/tenant-resolution.middleware.js';

/** What `registry` serving needs beyond what environment validation already
 * guarantees. Everything here is runtime wiring or a value the environment
 * schema accepts but registry mode cannot serve without. */
export interface TenantServingReadiness {
  /** The resolution middleware is wired, so a request can acquire context. */
  readonly tenancyWired: boolean;
  readonly hostSource: TenantHostSource;
  readonly trustedProxyCidrs: string;
  readonly corsOrigins: string;
}

/**
 * ADR-025 serving gate.
 *
 * The `development` strategy is unchanged and remains constrained by
 * environment validation to a development `NODE_ENV` and profile with an
 * explicit Organization.
 *
 * `registry` now boots, but only when the runtime can actually resolve a
 * tenant. These checks deliberately do **not** repeat what `environment.ts`
 * already enforces — absence of `DEVELOPMENT_ORGANIZATION_ID`, a valid
 * deployment profile, and a parseable proxy allowlist are refused there and
 * would fail before this runs.
 *
 * There is intentionally **no database probe**. Registry mode is allowed to
 * start with zero active bindings and simply resolve nothing; readiness owns
 * database availability, and coupling boot to it would turn a transient
 * outage into a failed start.
 */
export function assertServableTenantStrategy(
  strategy: TenantResolutionStrategy,
  readiness?: TenantServingReadiness,
): void {
  if (strategy !== 'registry') return;
  if (!readiness)
    throw new Error(
      'Invalid server configuration: registry tenant resolution requires runtime tenancy readiness',
    );
  if (!readiness.tenancyWired)
    throw new Error(
      'Invalid server configuration: registry tenant resolution requires the tenancy module to be wired',
    );
  if (!['direct', 'forwarded'].includes(readiness.hostSource))
    throw new Error(
      'Invalid server configuration: registry tenant resolution requires a valid TENANT_HOST_SOURCE',
    );
  if (
    readiness.hostSource === 'forwarded' &&
    parseTrustedProxyCidrs(readiness.trustedProxyCidrs).length === 0
  )
    throw new Error(
      'Invalid server configuration: forwarded tenant host source requires trusted proxy CIDRs',
    );
  // Resident surfaces are browser facing, so an empty allowlist would serve a
  // tenant no browser could call. The registry is never consulted here.
  if (parseCorsOrigins(readiness.corsOrigins).filter(Boolean).length === 0)
    throw new Error(
      'Invalid server configuration: registry tenant resolution requires CORS_ORIGINS',
    );
}

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfiguration, true>);
  const logger = app.get(PinoLoggerService);

  // Resolving the middleware from the container is the wiring proof: if
  // TenancyModule were absent, no request could acquire tenant context.
  // Nest throws when the provider is absent, so a successful resolve is the
  // wiring proof: without TenancyModule no request could acquire context.
  let tenancyWired = true;
  try {
    app.get(TenantResolutionMiddleware, { strict: false });
  } catch {
    tenancyWired = false;
  }
  assertServableTenantStrategy(
    config.get('tenancy.resolutionStrategy', { infer: true }),
    {
      tenancyWired,
      hostSource: config.get('tenancy.hostSource', { infer: true }),
      trustedProxyCidrs: config.get('tenancy.trustedProxyCidrs', {
        infer: true,
      }),
      corsOrigins: config.get('app.corsOrigins', { infer: true }),
    },
  );

  app.useLogger(logger);
  app.use(helmet());
  app.enableCors({
    origin: parseCorsOrigins(config.get('app.corsOrigins', { infer: true })),
    credentials: false,
    methods: ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.enableShutdownHooks();

  const openApiConfig = new DocumentBuilder()
    .setTitle('CityVUE API')
    .setDescription(
      'CityVUE platform health, readiness, and resident service catalog API',
    )
    .setVersion('1')
    .addBearerAuth({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'Microsoft Entra delegated CityVUE API access token',
    })
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });
}

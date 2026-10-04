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

/** ADR-025. The verified tenant-domain registry and hostname resolver are a
 * later slice. Refuse to serve HTTP under `registry` rather than starting with
 * no Organization authority; migration and operator CLIs are unaffected. */
export function assertServableTenantStrategy(
  strategy: TenantResolutionStrategy,
): void {
  if (strategy === 'registry')
    throw new Error(
      'Invalid server configuration: registry tenant resolution is not implemented; the API cannot serve requests under it',
    );
}

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfiguration, true>);
  const logger = app.get(PinoLoggerService);

  assertServableTenantStrategy(
    config.get('tenancy.resolutionStrategy', { infer: true }),
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

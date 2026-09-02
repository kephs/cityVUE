import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { AppConfiguration } from './config/configuration.js';
import { parseCorsOrigins } from './config/environment.js';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService<AppConfiguration, true>);
  const logger = app.get(PinoLoggerService);

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
    .setDescription('CityVUE platform health and readiness API')
    .setVersion('1')
    .build();
  const document = SwaggerModule.createDocument(app, openApiConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });
}

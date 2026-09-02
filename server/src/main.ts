import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { AppConfiguration } from './config/configuration.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApplication(app);

  const config = app.get(ConfigService<AppConfiguration, true>);
  const logger = app.get(PinoLoggerService);
  const port = config.get('app.port', { infer: true });
  await app.listen(port);
  logger.logger.info({ port }, 'CityVUE API started');
}

void bootstrap();

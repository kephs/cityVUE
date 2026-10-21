import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { AppConfiguration } from './config/configuration.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import { servingStartupFailure } from './config/serving-environment.js';
import { listenApplication } from './config/listen-address.js';

async function bootstrap(): Promise<void> {
  // Configuration can fail before the DI logger exists. Route that failure
  // through the same safe policy instead of Nest's default console logger.
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  configureApplication(app);

  const config = app.get(ConfigService<AppConfiguration, true>);
  const logger = app.get(PinoLoggerService);
  const listening = await listenApplication(app, {
    port: config.get('app.port', { infer: true }),
    environment: config.get('app.environment', { infer: true }),
  });
  logger.logger.info(listening, 'CityVUE API started');
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(servingStartupFailure(error));
  process.exitCode = 1;
});

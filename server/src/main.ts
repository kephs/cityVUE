import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { AppConfiguration } from './config/configuration.js';
import { PinoLoggerService } from './common/logging/pino-logger.service.js';
import { commandFailure } from './common/logging/log-sanitization.js';

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
  const port = config.get('app.port', { infer: true });
  await app.listen(port);
  logger.logger.info({ port }, 'CityVUE API started');
}

void bootstrap().catch((error: unknown) => {
  process.stderr.write(commandFailure('API startup failed', error));
  process.exitCode = 1;
});

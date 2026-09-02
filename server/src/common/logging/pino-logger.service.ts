import { Injectable, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { type Logger } from 'pino';
import type { AppConfiguration } from '../../config/configuration.js';

@Injectable()
export class PinoLoggerService implements LoggerService {
  readonly logger: Logger;

  constructor(config: ConfigService<AppConfiguration, true>) {
    this.logger = pino({
      name: String(config.get('app.name', { infer: true })),
      level: String(config.get('logging.level', { infer: true })),
      base: {
        service: String(config.get('app.name', { infer: true })),
        version: String(config.get('app.version', { infer: true })),
        environment: String(config.get('app.environment', { infer: true })),
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'headers.authorization',
          'headers.cookie',
          '*.password',
          '*.token',
          '*.secret',
        ],
        censor: '[Redacted]',
      },
    });
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info({ context: optionalParams }, this.toMessage(message));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error({ context: optionalParams }, this.toMessage(message));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn({ context: optionalParams }, this.toMessage(message));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug({ context: optionalParams }, this.toMessage(message));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace({ context: optionalParams }, this.toMessage(message));
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.fatal({ context: optionalParams }, this.toMessage(message));
  }

  private toMessage(message: unknown): string {
    return typeof message === 'string' ? message : JSON.stringify(message);
  }
}

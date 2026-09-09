import { Injectable, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { type DestinationStream, type Logger } from 'pino';
import type { AppConfiguration } from '../../config/configuration.js';
import {
  safeLogMessage,
  sanitizeLogContext,
  safeServiceMetadata,
  trustedHttpRoute,
} from './log-sanitization.js';

export function createOperationalLogger(
  level: string,
  metadata: { service: string; version: string; environment: string },
  destination?: DestinationStream,
): Logger {
  const safeMetadata = safeServiceMetadata(metadata);
  let activeRoute: string | undefined;
  return pino(
    {
      level,
      base: safeMetadata,
      hooks: {
        logMethod(args, method) {
          const context = sanitizeLogContext(args[0]);
          const message = typeof args[0] === 'string' ? args[0] : args[1];
          // Do not interpolate arbitrary strings or stringify object messages.
          // Pino invokes streamWrite synchronously. Only this direct HTTP
          // context may supply a route, never a serialized child binding.
          const previousRoute = activeRoute;
          activeRoute = trustedHttpRoute(args[0]);
          try {
            method.call(this, context, safeLogMessage(message));
          } finally {
            activeRoute = previousRoute;
          }
        },
        streamWrite(line) {
          // Pino child bindings are serialized separately and do not inherit the
          // parent's bindings formatter. Enforce the policy at the output too.
          const parsed = JSON.parse(line) as Record<string, unknown>;
          return (
            JSON.stringify({
              ...sanitizeLogContext(parsed),
              ...safeMetadata,
              ...(activeRoute === undefined ? {} : { route: activeRoute }),
              level: typeof parsed.level === 'number' ? parsed.level : 30,
              time: typeof parsed.time === 'number' ? parsed.time : Date.now(),
              msg: safeLogMessage(parsed.msg),
            }) + '\n'
          );
        },
      },
    },
    destination,
  );
}

@Injectable()
export class PinoLoggerService implements LoggerService {
  readonly logger: Logger;

  constructor(config: ConfigService<AppConfiguration, true>) {
    this.logger = createOperationalLogger(
      String(config.get('logging.level', { infer: true })),
      {
        service: String(config.get('app.name', { infer: true })),
        version: String(config.get('app.version', { infer: true })),
        environment: String(config.get('app.environment', { infer: true })),
      },
    );
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.info(
      this.context(message, optionalParams),
      safeLogMessage(message),
    );
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.error(
      this.context(message, optionalParams),
      safeLogMessage(message),
    );
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.warn(
      this.context(message, optionalParams),
      safeLogMessage(message),
    );
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.debug(
      this.context(message, optionalParams),
      safeLogMessage(message),
    );
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.trace(
      this.context(message, optionalParams),
      safeLogMessage(message),
    );
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.logger.fatal(
      this.context(message, optionalParams),
      safeLogMessage(message),
    );
  }

  private context(
    message: unknown,
    params: unknown[],
  ): Record<string, unknown> {
    return Object.assign(
      { component: 'nest' },
      sanitizeLogContext(message),
      ...params.map(sanitizeLogContext),
    ) as Record<string, unknown>;
  }
}

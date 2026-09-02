import { Global, Module } from '@nestjs/common';
import { PinoLoggerService } from './pino-logger.service.js';
import { RequestLoggingMiddleware } from './request-logging.middleware.js';

@Global()
@Module({
  providers: [PinoLoggerService, RequestLoggingMiddleware],
  exports: [PinoLoggerService, RequestLoggingMiddleware],
})
export class LoggingModule {}

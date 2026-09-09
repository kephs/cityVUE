import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import pinoHttp, { type HttpLogger } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { PinoLoggerService } from './pino-logger.service.js';
import {
  requestLogContext,
  safeErrorContext,
  safeContentType,
} from './log-sanitization.js';

const CORRELATION_HEADER = 'x-correlation-id';

export interface RequestWithId extends Request {
  id: string;
}

export function selectRequestId(value: string | undefined): string {
  // Even UUID-shaped client IDs are untrusted. Keep the response/log contract
  // by returning a fresh server-owned ID, without echoing the inbound value.
  void value;
  return randomUUID();
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly handler: HttpLogger<Request, Response>;

  constructor(logger: PinoLoggerService) {
    this.handler = pinoHttp<Request, Response>({
      logger: logger.logger,
      wrapSerializers: false,
      // Pino-http creates a full request child even in quiet mode. Never
      // serialize that request (or a response/error) as a general object.
      serializers: {
        req: () => undefined,
        res: () => undefined,
        err: safeErrorContext,
      },
      quietReqLogger: true,
      quietResLogger: true,
      genReqId: (request, response) => {
        const requestId = selectRequestId(undefined);
        response.setHeader(CORRELATION_HEADER, requestId);
        return requestId;
      },
      customProps: (request) => ({ requestId: request.id }),
      customSuccessObject: (
        request,
        response,
        value: { responseTime?: unknown },
      ) =>
        requestLogContext(request, {
          statusCode: response.statusCode,
          responseContentType: safeContentType(
            response.getHeader('content-type'),
          ),
          durationMs: value.responseTime,
        }),
      customErrorObject: (
        request,
        response,
        error,
        value: { responseTime?: unknown },
      ) =>
        requestLogContext(request, {
          ...safeErrorContext(error),
          statusCode: response.statusCode,
          responseContentType: safeContentType(
            response.getHeader('content-type'),
          ),
          durationMs: value.responseTime,
        }),
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= 500) return 'error';
        if (response.statusCode >= 400) return 'warn';
        return 'info';
      },
    });
  }

  use(request: Request, response: Response, next: NextFunction): void {
    // Pino-http otherwise accepts an already populated request.id unchanged.
    request.id = selectRequestId(undefined);
    response.setHeader(CORRELATION_HEADER, request.id);
    this.handler(request, response, next);
  }
}

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import pinoHttp, { type HttpLogger } from 'pino-http';
import { randomUUID } from 'node:crypto';
import { PinoLoggerService } from './pino-logger.service.js';

const CORRELATION_HEADER = 'x-correlation-id';
const SAFE_CORRELATION_ID = /^[A-Za-z0-9._-]{8,128}$/;

export interface RequestWithId extends Request {
  id: string;
}

export function selectRequestId(value: string | undefined): string {
  return value && SAFE_CORRELATION_ID.test(value) ? value : randomUUID();
}

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly handler: HttpLogger<Request, Response>;

  constructor(logger: PinoLoggerService) {
    this.handler = pinoHttp<Request, Response>({
      logger: logger.logger,
      genReqId: (request, response) => {
        const inbound = request.headers[CORRELATION_HEADER];
        const requestId = selectRequestId(
          Array.isArray(inbound) ? inbound[0] : inbound,
        );
        response.setHeader(CORRELATION_HEADER, requestId);
        return requestId;
      },
      customProps: (request) => ({ requestId: request.id }),
      customLogLevel: (_request, response, error) => {
        if (error || response.statusCode >= 500) return 'error';
        if (response.statusCode >= 400) return 'warn';
        return 'info';
      },
    });
  }

  use(request: Request, response: Response, next: NextFunction): void {
    this.handler(request, response, next);
  }
}

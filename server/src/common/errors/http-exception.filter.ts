import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { RequestWithId } from '../logging/request-logging.middleware.js';
import { PinoLoggerService } from '../logging/pino-logger.service.js';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  requestId: string;
}

export function buildErrorResponse(
  exception: unknown,
  requestId: string,
): ErrorResponse {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const response = exception.getResponse();
    const error =
      typeof response === 'object' && 'error' in response
        ? String(response.error)
        : exception.name.replace(/Exception$/, '');

    return { statusCode, error, requestId };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
    requestId,
  };
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & RequestWithId>();
    const response = context.getResponse<Response>();
    const requestId = request.id;
    const body = buildErrorResponse(exception, requestId);

    if (body.statusCode >= 500) {
      this.logger.logger.error(
        {
          err: exception,
          requestId,
          method: request.method,
          path: request.path,
        },
        'Unhandled request error',
      );
    }

    response.status(body.statusCode).json(body);
  }
}

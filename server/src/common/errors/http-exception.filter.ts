import { permissions } from '../../auth/auth.types.js';
import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  accessErrorMessages,
  type AccessErrorCode,
} from '../../access/access-errors.js';
import type { RequestWithId } from '../logging/request-logging.middleware.js';
import { PinoLoggerService } from '../logging/pino-logger.service.js';
import {
  requestLogContext,
  safeErrorContext,
} from '../logging/log-sanitization.js';

export interface ErrorResponse {
  statusCode: number;
  error: string;
  requestId: string;
  code?: string;
  message?: string;
  violations?: { key: string; required: string }[];
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

    const candidateCode =
      typeof response === 'object' &&
      'code' in response &&
      typeof response.code === 'string'
        ? response.code
        : undefined;
    const allowedCodes = new Set([
      'LOCATION_INELIGIBLE',
      'LOCATION_ELIGIBILITY_UNDETERMINED',
      'LOCATION_ELIGIBILITY_UNAVAILABLE',
    ]);
    if (
      candidateCode &&
      Object.hasOwn(accessErrorMessages, candidateCode) &&
      [400, 403, 404, 409].includes(statusCode)
    ) {
      const raw =
        typeof response === 'object' && 'violations' in response
          ? response.violations
          : undefined;
      const violations: { key: string; required: string }[] = [];
      if (candidateCode === 'ACCESS_DEPENDENCY_INVALID' && Array.isArray(raw)) {
        for (const value of raw.slice(0, 64) as unknown[]) {
          if (
            value &&
            typeof value === 'object' &&
            'key' in value &&
            'required' in value &&
            typeof value.key === 'string' &&
            typeof value.required === 'string' &&
            permissions.some((p) => p === value.key) &&
            permissions.some((p) => p === value.required)
          )
            violations.push({ key: value.key, required: value.required });
        }
      }
      return {
        statusCode,
        error,
        requestId,
        code: candidateCode,
        message: accessErrorMessages[candidateCode as AccessErrorCode],
        ...(violations.length ? { violations } : {}),
      };
    }
    const code =
      candidateCode && allowedCodes.has(candidateCode)
        ? candidateCode
        : undefined;
    const areaMessages: Record<string, string> = {
      QUESTION_CONFIGURATION_INVALID:
        'Check follow-up question text, options and unique order numbers.',
      QUESTION_DEPENDENCY:
        'This change would break inherited conditional behavior.',
      ISSUE_DUPLICATE: 'An Issue with this name already exists.',
      PARTICIPATION_AREA_DUPLICATE:
        'A Participation Area with this name already exists.',
      PARTICIPATION_AREA_LAST_ACTIVE:
        'At least one active Participation Area is required while Service Participation collection is enabled. First disable collection in Intake Settings.',
    };
    if (
      statusCode === 400 &&
      candidateCode &&
      Object.hasOwn(areaMessages, candidateCode)
    )
      return {
        statusCode,
        error,
        requestId,
        code: candidateCode,
        message:
          areaMessages[candidateCode] ?? 'Invalid Participation Area change.',
      };
    const message =
      code &&
      typeof response === 'object' &&
      'message' in response &&
      typeof response.message === 'string'
        ? response.message
        : undefined;
    return {
      statusCode,
      error,
      requestId,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
    };
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
        requestLogContext(request, {
          ...safeErrorContext(exception),
          statusCode: body.statusCode,
        }),
        'Unhandled request error',
      );
    }

    response.status(body.statusCode).json(body);
  }
}

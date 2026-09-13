import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AiFailureCategory } from './ai-governance.types.js';
const knownFailures = new WeakMap<object, AiFailureCategory>();
export function aiFailure(category: AiFailureCategory): HttpException {
  const exception =
    category === 'malformed_request'
      ? new BadRequestException()
      : category === 'quota_exceeded'
        ? new HttpException({ error: 'Too Many Requests' }, 429)
        : [
              'permission_denied',
              'unknown_model',
              'model_disabled',
              'model_policy_denied',
            ].includes(category)
          ? new ForbiddenException()
          : new ServiceUnavailableException();
  knownFailures.set(exception, category);
  return exception;
}
export function failureCategory(error: unknown): AiFailureCategory {
  // Only server-created classifications are accepted; exception properties are untrusted.
  return error !== null && typeof error === 'object'
    ? (knownFailures.get(error) ?? 'internal_failure')
    : 'internal_failure';
}

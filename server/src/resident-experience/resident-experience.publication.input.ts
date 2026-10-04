import { BadRequestException } from '@nestjs/common';
import { requestUuid } from '../service-request/staff-request-scope.js';

export interface ResidentPublicationInput {
  readonly reviewRequestId: string;
  readonly expectedResourceRevision: number;
}

export function parseResidentPublicationInput(
  input: unknown,
): ResidentPublicationInput {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid publication input');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'reviewRequestId') ||
    !Object.hasOwn(value, 'expectedResourceRevision') ||
    typeof value.reviewRequestId !== 'string' ||
    !requestUuid.test(value.reviewRequestId) ||
    !Number.isSafeInteger(value.expectedResourceRevision) ||
    Number(value.expectedResourceRevision) < 1
  )
    throw new BadRequestException('Invalid publication input');
  return {
    reviewRequestId: value.reviewRequestId.toLowerCase(),
    expectedResourceRevision: value.expectedResourceRevision as number,
  };
}

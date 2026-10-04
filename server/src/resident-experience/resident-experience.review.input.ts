import { BadRequestException, NotFoundException } from '@nestjs/common';
import { requestUuid } from '../service-request/staff-request-scope.js';
import type {
  ReviewOutcome,
  ReviewPurpose,
} from './resident-experience.review.js';

export function residentReviewId(value: string): string {
  if (!requestUuid.test(value)) throw new NotFoundException();
  return value.toLowerCase();
}

function object(input: unknown, keys: readonly string[]) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Invalid review input');
  const value = input as Record<string, unknown>;
  if (
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new BadRequestException('Invalid review input');
  if (
    !Number.isSafeInteger(value.expectedRevision) ||
    Number(value.expectedRevision) < 1
  )
    throw new BadRequestException('Invalid resource revision');
  return value;
}
function uuid(value: unknown) {
  if (typeof value !== 'string' || !requestUuid.test(value))
    throw new BadRequestException('Invalid review identifier');
  return value.toLowerCase();
}
export function parseResidentReviewRequest(input: unknown): {
  targetRevisionId: string;
  expectedRevision: number;
  purpose: ReviewPurpose;
  supersedesRequestId: string | null;
} {
  const value = object(input, [
    'targetRevisionId',
    'expectedRevision',
    'purpose',
    'supersedesRequestId',
  ]);
  if (value.purpose !== 'draft' && value.purpose !== 'historical')
    throw new BadRequestException('Invalid review purpose');
  return {
    targetRevisionId: uuid(value.targetRevisionId),
    expectedRevision: value.expectedRevision as number,
    purpose: value.purpose,
    supersedesRequestId:
      value.supersedesRequestId === null
        ? null
        : uuid(value.supersedesRequestId),
  };
}
export function parseResidentReviewDecision(input: unknown): {
  expectedRevision: number;
  outcome: ReviewOutcome;
} {
  const value = object(input, ['expectedRevision', 'outcome']);
  if (value.outcome !== 'approved' && value.outcome !== 'rejected')
    throw new BadRequestException('Invalid review outcome');
  return {
    expectedRevision: value.expectedRevision as number,
    outcome: value.outcome,
  };
}

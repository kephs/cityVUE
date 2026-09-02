import { BadRequestException } from '@nestjs/common';

export type SupportedQuestionType =
  'short_text' | 'long_text' | 'number' | 'yes_no' | 'single_select';
export type CanonicalAnswerValue = string | number | boolean;

export function periodKeyFor(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    if (!year || !month) throw new Error('Missing date part');
    return `${year}${month}`;
  } catch {
    throw new Error(`Invalid Organization business timezone: ${timeZone}`);
  }
}

export function formatReferenceNumber(
  periodKey: string,
  value: number,
): string {
  if (
    !/^\d{6}$/.test(periodKey) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 999999
  ) {
    throw new Error('Invalid service request reference components');
  }
  return `SR-${periodKey}-${String(value).padStart(6, '0')}`;
}

export function conditionMatches(
  actual: CanonicalAnswerValue | undefined,
  expected: unknown,
): boolean {
  if (typeof actual === 'boolean' && (expected === 'yes' || expected === 'no'))
    return actual === (expected === 'yes');
  return actual === expected;
}

export function normalizeAnswer(
  type: SupportedQuestionType,
  value: unknown,
): CanonicalAnswerValue {
  if (
    type === 'short_text' ||
    type === 'long_text' ||
    type === 'single_select'
  ) {
    if (typeof value !== 'string' || value.trim() === '')
      throw new BadRequestException('Answer has an invalid value');
    return value.trim();
  }
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new BadRequestException('Answer must be a finite number');
    return value;
  }
  if (typeof value !== 'boolean')
    throw new BadRequestException('Answer must be true or false');
  return value;
}

export function validateRequesterPolicy(
  identity: string,
  anonymousPolicy: string,
  hasContact: boolean,
): void {
  if (identity === 'anonymous' && anonymousPolicy === 'not_allowed')
    throw new BadRequestException(
      'Anonymous reporting is not allowed for this service',
    );
  if (identity === 'identified' && !hasContact)
    throw new BadRequestException(
      'Contact name is required for identified reporting',
    );
  if (identity === 'anonymous' && hasContact)
    throw new BadRequestException(
      'Anonymous requests must not include contact information',
    );
}

export function validateLocationPolicy(
  policy: string,
  hasLocation: boolean,
): void {
  if (policy === 'required' && !hasLocation)
    throw new BadRequestException('Location is required for this service');
  if (policy === 'not_applicable' && hasLocation)
    throw new BadRequestException(
      'Location is not applicable for this service',
    );
}

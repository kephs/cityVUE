import { BadRequestException, ConflictException } from '@nestjs/common';

export type WorkflowAction =
  'start_work' | 'hold' | 'resume' | 'close' | 'reopen';
export type WorkflowStatus = 'open' | 'in_progress' | 'on_hold' | 'closed';
const transitions: Partial<
  Record<string, Partial<Record<WorkflowAction, WorkflowStatus>>>
> = {
  open: { start_work: 'in_progress', close: 'closed' },
  in_progress: { hold: 'on_hold', close: 'closed' },
  on_hold: { resume: 'in_progress', close: 'closed' },
  closed: { reopen: 'open' },
};

export function resolveWorkflowTransition(
  status: string,
  action: WorkflowAction,
): WorkflowStatus {
  const allowed = transitions[status];
  const next = allowed ? allowed[action] : undefined;
  if (!next)
    throw new ConflictException(
      'Workflow action is not valid for the current status',
    );
  return next;
}

export function validateWorkflowInput(
  action: WorkflowAction,
  reason?: string,
  resolution?: string,
): void {
  const cleanReason = reason?.trim();
  const cleanResolution = resolution?.trim();
  if (action === 'hold' && !cleanReason)
    throw new BadRequestException('Hold reason is required');
  if (action === 'reopen' && !cleanReason)
    throw new BadRequestException('Reopen reason is required');
  if (action === 'close' && !cleanResolution)
    throw new BadRequestException('Resolution summary is required');
}

export type SupportedQuestionType =
  | 'short_text'
  | 'long_text'
  | 'number'
  | 'yes_no'
  | 'single_select'
  | 'multi_select'
  | 'date'
  | 'information';
export type CanonicalAnswerValue = string | number | boolean | string[];

/** Calendar components only: no Date constructor, timezone, locale or instant. */
export function validCalendarDate(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    value.length !== 10 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  )
    return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const limit =
    [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ??
    0;
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= limit;
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
  if (type === 'information')
    throw new BadRequestException('Information does not accept an answer');
  if (type === 'date') {
    if (!validCalendarDate(value))
      throw new BadRequestException('Enter a valid calendar date');
    return value;
  }
  if (type === 'multi_select') {
    if (
      !Array.isArray(value) ||
      value.length > 25 ||
      value.some(
        (key: unknown) => typeof key !== 'string' || !key || key.length > 100,
      ) ||
      new Set(value).size !== value.length
    )
      throw new BadRequestException('Selected options are invalid');
    return value as string[];
  }
  if (
    type === 'short_text' ||
    type === 'long_text' ||
    type === 'single_select'
  ) {
    if (typeof value !== 'string' || value.trim() === '')
      throw new BadRequestException('Answer has an invalid value');
    if (
      type !== 'single_select' &&
      Array.from(value.trim()).length > (type === 'short_text' ? 300 : 2000)
    )
      throw new BadRequestException('Text answer is too long');
    return value.trim();
  }
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new BadRequestException('Answer must be a finite number');
    const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
    const decimals = (mantissa?.split('.')[1]?.length ?? 0) - Number(exponent);
    if (Math.abs(value) > 1_000_000_000 || decimals > 6)
      throw new BadRequestException('Numeric answer is outside allowed bounds');
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

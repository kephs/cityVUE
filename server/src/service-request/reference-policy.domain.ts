import { BadRequestException } from '@nestjs/common';
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

export interface ReferencePolicy {
  prefix: string;
  dateComponent: string;
  sequenceWidth: number;
  resetPolicy: string;
  separator: string;
}
export const defaultReferencePolicy: ReferencePolicy = {
  prefix: 'SR',
  dateComponent: 'year_month',
  sequenceWidth: 6,
  resetPolicy: 'monthly',
  separator: '-',
};
export function validateReferencePolicy(
  input: ReferencePolicy,
): ReferencePolicy {
  if (
    !/^[A-Za-z0-9]{0,12}$/.test(input.prefix) ||
    !['-', ''].includes(input.separator) ||
    !Number.isInteger(input.sequenceWidth) ||
    input.sequenceWidth < 4 ||
    input.sequenceWidth > 12 ||
    !['none:never', 'year:yearly', 'year_month:monthly'].includes(
      `${input.dateComponent}:${input.resetPolicy}`,
    )
  )
    throw new BadRequestException('Invalid reference configuration');
  return {
    prefix: input.prefix.toUpperCase(),
    dateComponent: input.dateComponent,
    sequenceWidth: input.sequenceWidth,
    resetPolicy: input.resetPolicy,
    separator: input.separator,
  };
}
export function referencePeriod(
  policy: ReferencePolicy,
  date: Date,
  zone: string,
): string {
  const month = periodKeyFor(date, zone);
  return policy.resetPolicy === 'never'
    ? 'never'
    : policy.resetPolicy === 'yearly'
      ? month.slice(0, 4)
      : month;
}
export function formatReferenceNumber(
  policy: ReferencePolicy,
  period: string,
  value: bigint,
): string {
  if (
    (policy.dateComponent === 'year_month' &&
      !/^[0-9]{4}(0[1-9]|1[0-2])$/.test(period)) ||
    (policy.dateComponent === 'year' && !/^[0-9]{4}$/.test(period)) ||
    (policy.dateComponent === 'none' && period !== 'never')
  )
    throw new Error('Invalid reference period');
  if (value < 1n || value > 9223372036854775807n)
    throw new Error('Reference capacity exhausted');
  const date = policy.dateComponent === 'none' ? '' : period;
  return [
    policy.prefix,
    date,
    value.toString().padStart(policy.sequenceWidth, '0'),
  ]
    .filter(Boolean)
    .join(policy.separator);
}
// Used only during administrative changes, never to allocate a request number.
export function historicalComponents(
  policy: ReferencePolicy,
  reference: string,
): { period: string; value: bigint } | null {
  const start = policy.prefix ? `${policy.prefix}${policy.separator}` : '';
  const date =
    policy.dateComponent === 'none'
      ? ''
      : `([0-9]{${policy.dateComponent === 'year' ? '4' : '6'}})${policy.separator}`;
  const match = new RegExp(
    `^${start}${date}([0-9]{${String(policy.sequenceWidth)},19})$`,
  ).exec(reference);
  if (!match) return null;
  const period = policy.dateComponent === 'none' ? 'never' : match[1];
  const digits = match[policy.dateComponent === 'none' ? 1 : 2];
  if (!period || !digits) return null;
  if (
    policy.dateComponent === 'year_month' &&
    !/^[0-9]{4}(0[1-9]|1[0-2])$/.test(period)
  )
    return null;
  const value = BigInt(digits);
  if (
    value < 1n ||
    value > 9223372036854775807n ||
    formatReferenceNumber(policy, period, value) !== reference
  )
    return null;
  return { period, value };
}

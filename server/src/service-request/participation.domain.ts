import { BadRequestException } from '@nestjs/common';
import type { Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { requestUuid } from './staff-request-scope.js';

export interface ParticipationInput {
  state: 'PROVIDED' | 'DECLINED';
  areaId?: string;
}
export function validateParticipation(
  input: ParticipationInput | undefined | null,
  audience: string,
): void {
  if (input === undefined) return;
  if (
    !input ||
    audience !== 'public' ||
    !['PROVIDED', 'DECLINED'].includes(input.state) ||
    (input.state === 'PROVIDED'
      ? !requestUuid.test(input.areaId ?? '')
      : input.areaId !== undefined)
  )
    throw new BadRequestException('Invalid participation selection');
}
export async function validateParticipationArea(
  trx: Transaction<DatabaseSchema>,
  org: string,
  input?: ParticipationInput,
) {
  if (input?.state !== 'PROVIDED') return;
  if (!input.areaId)
    throw new BadRequestException('Participation area is required');
  const area = await trx
    .selectFrom('participation_area')
    .select('id')
    .where('organization_id', '=', org)
    .where('id', '=', input.areaId)
    .where('active', '=', true)
    .forShare()
    .executeTakeFirst();
  if (!area) throw new BadRequestException('Participation area is unavailable');
}
export function participationPeriod(
  start: string,
  end: string,
  now = new Date(),
) {
  const parse = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      throw new BadRequestException('Invalid participation period');
    const ms = Date.parse(`${value}T00:00:00Z`);
    if (
      !Number.isFinite(ms) ||
      new Date(ms).toISOString().slice(0, 10) !== value
    )
      throw new BadRequestException('Invalid participation period');
    return ms;
  };
  const from = parse(start),
    through = parse(end),
    days = (through - from) / 86400000 + 1;
  if (days < 28 || days > 366 || end > now.toISOString().slice(0, 10))
    throw new BadRequestException(
      'Use a UTC period of 28 to 366 days ending no later than today',
    );
  return { from: new Date(from), until: new Date(through + 86400000) };
}
export function participationThreshold(value: number) {
  if (!Number.isInteger(value) || value < 5 || value > 1000)
    throw new Error('Invalid participation privacy threshold');
  return value;
}
export function suppressParticipation(count: number, threshold: number) {
  participationThreshold(threshold);
  if (!Number.isSafeInteger(count) || count < 0)
    throw new Error('Invalid participation aggregate');
  return count > 0 && count < threshold
    ? { suppressed: true, count: null }
    : { suppressed: false, count };
}

import { BadRequestException } from '@nestjs/common';
import { sql } from 'kysely';

export const staffSearchMaxLength = 160;

// Keep the predicate and displayed value identical: hidden address alternatives
// must not become an additional searchable field.
export const staffServiceLocation = sql<
  string | null
>`(select coalesce(nullif(btrim(l.normalized_address), ''), nullif(btrim(l.entered_address), '')) from location l where l.organization_id=request.organization_id and l.service_request_id=request.id limit 1)`;

export function normalizeStaffSearch(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > staffSearchMaxLength)
    throw new BadRequestException('Invalid request search');
  const query = value.trim();
  if (query.length === 1)
    throw new BadRequestException(
      'Request search requires at least 2 characters',
    );
  return query;
}

export function staffSearchPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, '\\$&')}%`;
}

export function staffLiveSearch(query: string) {
  const pattern = staffSearchPattern(query);
  return sql<boolean>`(request.reference_number ilike ${pattern} escape '\\' or version.name ilike ${pattern} escape '\\' or ${staffServiceLocation} ilike ${pattern} escape '\\')`;
}

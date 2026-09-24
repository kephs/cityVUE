import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from './database.types.js';
export const brandingLogoKey = 'example-organization';
export interface BrandingInput {
  displayName: string | null;
  tagline: string | null;
  logoKey: string | null;
}
export function brandingInput(value: BrandingInput | undefined): BrandingInput {
  if (
    !value ||
    Object.keys(value).some(
      (k) => !['displayName', 'tagline', 'logoKey'].includes(k),
    )
  )
    throw new BadRequestException('Invalid branding');
  for (const [field, max] of [
    ['displayName', 100],
    ['tagline', 140],
  ] as const) {
    const s = value[field];
    if (
      s !== null &&
      (typeof s !== 'string' ||
        !s.trim() ||
        s !== s.trim() ||
        s.length > max ||
        Array.from(s).some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ))
    )
      throw new BadRequestException('Invalid branding text');
  }
  if (value.logoKey !== null && value.logoKey !== brandingLogoKey)
    throw new BadRequestException('Unsupported branding asset');
  if (
    value.displayName === null &&
    (value.tagline !== null || value.logoKey !== null)
  )
    throw new BadRequestException('Organization display name required');
  return value;
}
export function brandingProjection(row: {
  display_name: string | null;
  tagline: string | null;
  logo_key: string | null;
  revision: number;
}) {
  return {
    mode: row.display_name
      ? ('ORGANIZATION' as const)
      : ('REQRO_DEFAULT' as const),
    displayName: row.display_name,
    tagline: row.tagline,
    logoKey: row.logo_key === brandingLogoKey ? brandingLogoKey : null,
    revision: row.revision,
  };
}
/** Development caller validates personal target/profile. Transaction owns revision comparison and update. */
export async function provisionBranding(
  db: Kysely<DatabaseSchema>,
  org: string,
  input: BrandingInput,
  expectedRevision: number,
  dryRun = false,
) {
  brandingInput(input);
  if (
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 1 ||
    expectedRevision > 2147483647
  )
    throw new BadRequestException('Invalid branding revision');
  return db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('organization_branding')
      .innerJoin(
        'organization',
        'organization.id',
        'organization_branding.organization_id',
      )
      .select([
        'display_name',
        'tagline',
        'logo_key',
        'organization_branding.revision',
      ])
      .where('organization_branding.organization_id', '=', org)
      .where('organization.status', '=', 'active')
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new ForbiddenException('Branding unavailable');
    if (row.revision !== expectedRevision)
      throw new ConflictException(
        'Branding changed; read current revision before provisioning',
      );
    const changed =
      row.display_name !== input.displayName ||
      row.tagline !== input.tagline ||
      row.logo_key !== input.logoKey;
    if (!changed || dryRun) return { revision: row.revision, changed, dryRun };
    const result = await trx
      .updateTable('organization_branding')
      .set({
        display_name: input.displayName,
        tagline: input.tagline,
        logo_key: input.logoKey,
      })
      .where('organization_id', '=', org)
      .returning('revision')
      .executeTakeFirstOrThrow();
    return { revision: result.revision, changed: true, dryRun: false };
  });
}

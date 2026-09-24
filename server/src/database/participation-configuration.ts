import type { Kysely } from 'kysely';
import { BadRequestException } from '@nestjs/common';
import type { DatabaseSchema } from './database.types.js';

/** Internal provisioning helper; caller establishes the explicit development target.
 * The database advances only this resource's revision for a meaningful change. */
export async function validateCollectionEnable(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  lock = true,
) {
  let query = db
    .selectFrom('participation_area')
    .select('id')
    .where('organization_id', '=', organizationId)
    .where('active', '=', true)
    .limit(1);
  if (lock) query = query.forShare();
  const area = await query.executeTakeFirst();
  if (!area)
    throw new BadRequestException(
      'Service Participation cannot be enabled because no active Participation Areas are configured. Manage areas in Participation Areas with the required write permission.',
    );
}

export async function setParticipationCollection(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  enabled: boolean,
) {
  // Match Admin/request-intake Organization-first locking before area admission.
  // Callers perform configuration changes inside a transaction.
  await db
    .selectFrom('organization')
    .select('id')
    .where('id', '=', organizationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  if (enabled) await validateCollectionEnable(db, organizationId);
  return db
    .updateTable('organization')
    .set({ service_participation_collection_enabled: enabled })
    .where('id', '=', organizationId)
    .returning([
      'service_participation_collection_enabled',
      'participation_collection_revision',
    ])
    .executeTakeFirstOrThrow();
}

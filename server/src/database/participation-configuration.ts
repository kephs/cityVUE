import type { Kysely } from 'kysely';
import type { DatabaseSchema } from './database.types.js';

/** Internal provisioning helper; caller establishes the explicit development target.
 * The database advances only this resource's revision for a meaningful change. */
export function setParticipationCollection(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  enabled: boolean,
) {
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

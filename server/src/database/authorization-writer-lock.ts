import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from './database.types.js';

/** Old-schema compatibility is needed by historical migration fixtures.
 * On Migration 38 schemas every supported writer locks the access state before DML. */
export async function lockAuthorizationWriter(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
) {
  await db
    .selectFrom('organization')
    .select('id')
    .where('id', '=', organizationId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const present = (
    await sql<{
      present: boolean;
    }>`select exists(select 1 from information_schema.tables where table_schema=current_schema() and table_name='organization_access_state') as present`.execute(
      db,
    )
  ).rows[0]?.present;
  if (present)
    await sql`select organization_id from organization_access_state where organization_id=${organizationId} for update`.execute(
      db,
    );
}

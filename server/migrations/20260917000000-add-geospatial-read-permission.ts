import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  // Catalog only. No role or staff assignment receives this permission.
  await db
    .insertInto('permission')
    .values({ permission_key: 'geospatial.read' })
    .onConflict((oc) => oc.column('permission_key').doNothing())
    .execute();
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // Existing role grants block removal through the role_permission FK.
  await db
    .deleteFrom('permission')
    .where('permission_key', '=', 'geospatial.read')
    .execute();
}

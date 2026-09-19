import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`insert into permission(permission_key) values ('service_request.internal.read') on conflict do nothing`.execute(
    db,
  );
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // Existing FK refuses rollback when grants depend on the permission.
  await sql`delete from permission where permission_key='service_request.internal.read'`.execute(
    db,
  );
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`create index service_request_org_status_created_idx on service_request(organization_id, status, created_at desc);
    create index service_request_org_priority_created_idx on service_request(organization_id, priority, created_at desc);`.execute(
    db,
  );
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`drop index if exists service_request_org_priority_created_idx; drop index if exists service_request_org_status_created_idx;`.execute(
    db,
  );
}

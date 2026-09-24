import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`alter table organization add column service_participation_collection_enabled boolean not null default false`.execute(
    db,
  );
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization,participation_area in access exclusive mode;
    do $$ begin
      if exists(select 1 from organization where service_participation_collection_enabled)
      or exists(select 1 from participation_area) then
        raise exception 'Retained participation configuration prevents rollback';
      end if;
    end $$;
    alter table organization drop column service_participation_collection_enabled;
  `.execute(db);
}

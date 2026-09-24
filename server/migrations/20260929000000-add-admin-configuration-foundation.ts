import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    insert into permission(permission_key) values('admin.configuration.read');
    alter table organization add column participation_collection_revision integer not null default 1 check(participation_collection_revision > 0);
    alter table participation_area add column revision integer not null default 1 check(revision > 0);
    create function advance_participation_collection_revision() returns trigger language plpgsql as $$ begin
      NEW.participation_collection_revision := OLD.participation_collection_revision;
      if NEW.service_participation_collection_enabled is distinct from OLD.service_participation_collection_enabled then
        NEW.participation_collection_revision := OLD.participation_collection_revision + 1;
      end if;
      return NEW;
    end $$;
    create trigger participation_collection_revision before update on organization for each row execute function advance_participation_collection_revision();
    create function advance_participation_area_revision() returns trigger language plpgsql as $$ begin
      if NEW.organization_id is distinct from OLD.organization_id or NEW.id is distinct from OLD.id then
        raise exception 'Participation Area ownership is immutable';
      end if;
      NEW.revision := OLD.revision;
      if row(NEW.display_name,NEW.active,NEW.display_order) is distinct from row(OLD.display_name,OLD.active,OLD.display_order) then
        NEW.revision := OLD.revision + 1;
        NEW.updated_at := clock_timestamp();
      end if;
      return NEW;
    end $$;
    create trigger participation_area_revision before update on participation_area for each row execute function advance_participation_area_revision();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization,participation_area,role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from organization where participation_collection_revision > 1)
        or exists(select 1 from participation_area where revision > 1)
        or exists(select 1 from role_permission where permission_key='admin.configuration.read') then
        raise exception 'Retained administrative revision or grant prevents rollback';
      end if;
    end $$;
    drop trigger participation_area_revision on participation_area;
    drop function advance_participation_area_revision();
    drop trigger participation_collection_revision on organization;
    drop function advance_participation_collection_revision();
    alter table participation_area drop column revision;
    alter table organization drop column participation_collection_revision;
    delete from permission where permission_key='admin.configuration.read';
  `.execute(db);
}

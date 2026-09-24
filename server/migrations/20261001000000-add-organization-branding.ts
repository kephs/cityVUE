import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table organization_branding (
      organization_id uuid primary key references organization(id),
      display_name varchar(100), tagline varchar(140), logo_key varchar(48),
      revision integer not null default 1 check(revision>0),
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      check(display_name is null or length(btrim(display_name))>0),
      check(tagline is null or length(btrim(tagline))>0),
      check(display_name is not null or (tagline is null and logo_key is null)),
      check(logo_key is null or logo_key='example-organization')
    );
    insert into organization_branding(organization_id) select id from organization;
    create function initialize_organization_branding() returns trigger language plpgsql as $$ begin
      insert into organization_branding(organization_id) values (NEW.id); return NEW;
    end $$;
    create trigger organization_branding_default after insert on organization for each row execute function initialize_organization_branding();
    create function advance_organization_branding_revision() returns trigger language plpgsql as $$ begin
      if NEW.organization_id is distinct from OLD.organization_id then raise exception 'Branding ownership is immutable'; end if;
      NEW.revision := OLD.revision; NEW.created_at := OLD.created_at; NEW.updated_at := OLD.updated_at;
      if row(NEW.display_name,NEW.tagline,NEW.logo_key) is distinct from row(OLD.display_name,OLD.tagline,OLD.logo_key) then
        NEW.revision := OLD.revision+1; NEW.updated_at := clock_timestamp();
      end if; return NEW;
    end $$;
    create trigger organization_branding_revision before update on organization_branding for each row execute function advance_organization_branding_revision();
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization,organization_branding in access exclusive mode;
    do $$ begin if exists(select 1 from organization_branding where revision>1 or display_name is not null) then
      raise exception 'Retained branding prevents rollback'; end if; end $$;
    drop trigger organization_branding_default on organization;
    drop function initialize_organization_branding();
    drop table organization_branding;
    drop function advance_organization_branding_revision();
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create function participation_area_name_key(value text) returns text
      language sql immutable strict parallel safe as $$
      select lower(btrim(value, E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)))
      $$;
    create unique index participation_area_name_unique on participation_area(organization_id, participation_area_name_key(display_name));
    insert into permission(permission_key) values ('admin.participation_areas.write');
    create table participation_area_audit (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      staff_identity_id uuid not null,
      area_id uuid not null,
      action text not null check(action in ('created','renamed','activated','deactivated','reordered')),
      prior_name text, name text not null,
      prior_active boolean, active boolean not null,
      prior_display_order integer, display_order integer not null,
      prior_revision integer, revision integer not null check(revision > 0),
      correlation_id uuid not null,
      occurred_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key(organization_id,area_id) references participation_area(organization_id,id),
      check ((action='created' and prior_revision is null and prior_name is null and prior_active is null and prior_display_order is null and revision=1)
        or (action<>'created' and prior_revision is not null and prior_revision > 0 and revision=prior_revision+1 and prior_name is not null and prior_active is not null and prior_display_order is not null))
    );
    create function protect_area_audit() returns trigger language plpgsql as $$ begin
      raise exception 'Participation Area audit is append-only'; end $$;
    create trigger area_audit_immutable before update or delete on participation_area_audit for each row execute function protect_area_audit();
    create trigger area_audit_no_truncate before truncate on participation_area_audit for each statement execute function protect_area_audit();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table participation_area,participation_area_audit,role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from participation_area_audit) or exists(select 1 from role_permission where permission_key='admin.participation_areas.write') then
        raise exception 'Retained Participation Area audit or grant prevents rollback';
      end if;
    end $$;
    drop table participation_area_audit;
    drop function protect_area_audit();
    delete from permission where permission_key='admin.participation_areas.write';
    drop index participation_area_name_unique;
    drop function participation_area_name_key(text);
  `.execute(db);
}

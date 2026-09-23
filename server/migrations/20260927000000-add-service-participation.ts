import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table participation_area (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      display_name text not null check(length(trim(display_name)) between 1 and 120),
      active boolean not null default true,
      display_order integer not null default 0,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp(),
      unique(organization_id,id), unique(organization_id,display_name)
    );
    create index participation_area_active_order on participation_area(organization_id,active,display_order,display_name,id);
    alter table service_request
      add column requester_geography_state text not null default 'NOT_COLLECTED',
      add column participation_area_id uuid,
      add constraint request_geography_consistent check(
        (requester_geography_state='PROVIDED' and participation_area_id is not null and audience='public')
        or (requester_geography_state='DECLINED' and participation_area_id is null and audience='public')
        or (requester_geography_state='NOT_COLLECTED' and participation_area_id is null)),
      add constraint request_geography_org foreign key(organization_id,participation_area_id) references participation_area(organization_id,id);
    create index request_participation_period on service_request(organization_id,created_at,participation_area_id) where audience='public';
    create function protect_request_geography() returns trigger language plpgsql as $$ begin
      if NEW.requester_geography_state is distinct from OLD.requester_geography_state or NEW.participation_area_id is distinct from OLD.participation_area_id then
        raise exception 'Request participation geography is immutable';
      end if; return NEW; end $$;
    create trigger request_geography_immutable before update on service_request for each row execute function protect_request_geography();
    create table service_participation_audit (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      staff_identity_id uuid not null,
      action text not null check(action='participation_read'),
      start_date date not null, end_date date not null,
      threshold integer not null check(threshold>=5),
      correlation_id uuid not null,
      created_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create function protect_participation_audit() returns trigger language plpgsql as $$ begin
      raise exception 'Participation audit is append-only'; end $$;
    create trigger participation_audit_immutable before update or delete on service_participation_audit for each row execute function protect_participation_audit();
    create trigger participation_audit_no_truncate before truncate on service_participation_audit for each statement execute function protect_participation_audit();
    insert into permission(permission_key) values('analytics.service_participation.read');
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table participation_area,service_request,service_participation_audit in access exclusive mode;
    do $$ begin
      if exists(select 1 from participation_area) or exists(select 1 from service_participation_audit)
      or exists(select 1 from service_request where requester_geography_state<>'NOT_COLLECTED') then
        raise exception 'Retained participation data prevents rollback'; end if; end $$;
    delete from permission where permission_key='analytics.service_participation.read';
    drop table service_participation_audit;
    drop function protect_participation_audit();
    drop trigger request_geography_immutable on service_request;
    drop function protect_request_geography();
    alter table service_request drop column participation_area_id, drop column requester_geography_state;
    drop table participation_area;
  `.execute(db);
}

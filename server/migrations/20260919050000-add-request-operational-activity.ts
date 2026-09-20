import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_request in share row exclusive mode;
    create table request_operational_activity (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      service_request_id uuid not null,
      activity_type varchar(32) not null check (activity_type in ('request_created','work_started','placed_on_hold','work_resumed','request_closed','request_reopened','request_routed')),
      actor_type varchar(24) not null check (actor_type in ('staff','resident','anonymous_resident','system')),
      staff_identity_id uuid,
      occurred_at timestamptz not null default clock_timestamp(),
      request_revision integer check (request_revision > 0),
      is_baseline boolean not null default false,
      from_status varchar(24), to_status varchar(24),
      from_department_id uuid, from_division_id uuid,
      to_department_id uuid, to_division_id uuid,
      from_department_name text, from_division_name text,
      to_department_name text, to_division_name text,
      narrative text,
      intake_channel varchar(24),
      foreign key (organization_id,service_request_id) references service_request(organization_id,id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key (organization_id,from_department_id) references department(organization_id,id),
      foreign key (organization_id,to_department_id) references department(organization_id,id),
      foreign key (organization_id,from_department_id,from_division_id) references division(organization_id,department_id,id),
      foreign key (organization_id,to_department_id,to_division_id) references division(organization_id,department_id,id),
      check ((actor_type='staff') = (staff_identity_id is not null)),
      check (not is_baseline or (activity_type='request_created' and actor_type='system' and request_revision is null)),
      check (is_baseline or request_revision is not null),
      check (from_status is null or from_status in ('open','in_progress','on_hold','closed','cancelled')),
      check (to_status is null or to_status in ('open','in_progress','on_hold','closed','cancelled')),
      check ((activity_type in ('placed_on_hold','request_closed','request_reopened') and narrative is not null and length(btrim(narrative)) between 1 and case when activity_type='request_closed' then 2000 else 500 end)
        or (activity_type not in ('placed_on_hold','request_closed','request_reopened') and narrative is null)),
      check ((activity_type='request_routed' and from_department_id is not null and to_department_id is not null and from_department_name is not null and to_department_name is not null)
        or (activity_type<>'request_routed' and from_department_id is null and to_department_id is null and from_division_id is null and to_division_id is null and from_department_name is null and to_department_name is null and from_division_name is null and to_division_name is null)),
      check (from_division_id is null or from_department_id is not null),
      check (to_division_id is null or to_department_id is not null),
      check (activity_type='request_created' or intake_channel is null),
      check (intake_channel is null or intake_channel in ('web','phone','walk_in','staff','api')),
      check ((activity_type in ('request_created','request_routed') and from_status is null and to_status is null)
        or (activity_type not in ('request_created','request_routed') and from_status is not null and to_status is not null)),
      unique (organization_id,service_request_id,request_revision)
    );
    create unique index request_operational_created_unique on request_operational_activity(organization_id,service_request_id) where activity_type='request_created';
    create index request_operational_timeline_idx on request_operational_activity(organization_id,service_request_id,occurred_at desc,id desc);
    insert into request_operational_activity(organization_id,service_request_id,activity_type,actor_type,occurred_at,is_baseline,intake_channel)
      select organization_id,id,'request_created','system',created_at,true,intake_channel from service_request;
    create function prevent_request_operational_mutation() returns trigger language plpgsql as $$ begin raise exception 'operational activity is append-only'; end $$;
    create trigger request_operational_immutable before update or delete on request_operational_activity for each row execute function prevent_request_operational_mutation();
    create trigger request_operational_no_truncate before truncate on request_operational_activity for each statement execute function prevent_request_operational_mutation();
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table request_operational_activity in access exclusive mode;
    do $$ begin
      if exists(select 1 from request_operational_activity where not is_baseline)
      then raise exception 'F035 rollback would discard operational history'; end if;
    end $$;
    drop table request_operational_activity;
    drop function prevent_request_operational_mutation();
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check(activity_type in ('service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned','work_started','work_held','work_resumed','service_request_closed','service_request_reopened','watcher_added','watcher_removed'));
    create table operational_role (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null,
      department_id uuid not null, division_id uuid,
      name varchar(200) not null check (length(btrim(name)) > 0),
      active boolean not null default true, created_at timestamptz not null default now(),
      unique(organization_id,id), unique(organization_id,department_id,name),
      foreign key(organization_id,department_id) references department(organization_id,id),
      foreign key(organization_id,department_id,division_id) references division(organization_id,department_id,id)
    );
    create table operational_role_membership (
      organization_id uuid not null, operational_role_id uuid not null, staff_identity_id uuid not null,
      active boolean not null default true, created_at timestamptz not null default now(),
      primary key(operational_role_id,staff_identity_id),
      foreign key(organization_id,operational_role_id) references operational_role(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create index operational_role_member_staff_idx on operational_role_membership(organization_id,staff_identity_id,operational_role_id) where active;
    create index work_group_member_staff_idx on work_group_membership(organization_id,staff_identity_id,work_group_id) where active;
    create index operational_role_scope_idx on operational_role(organization_id,department_id,division_id) where active;
    create index work_group_scope_idx on work_group(organization_id,department_id,division_id) where active;

    alter table service_request_assignment add column operational_role_id uuid;
    alter table service_request_assignment add constraint assignment_operational_role_fk foreign key(organization_id,operational_role_id) references operational_role(organization_id,id);
    alter table service_request_assignment drop constraint service_request_assignment_assignment_type_check;
    alter table service_request_assignment drop constraint service_request_assignment_assigned_by_actor_type_check;
    alter table service_request_assignment drop constraint service_request_assignment_check;
    alter table service_request_assignment add constraint assignment_type_allowed check(assignment_type in ('unassigned','department','individual','group','role'));
    alter table service_request_assignment add constraint assignment_actor_allowed check(assigned_by_actor_type in ('development_staff','staff'));
    alter table service_request_assignment add constraint assignment_target_shape check (
      (assignment_type='unassigned' and num_nonnulls(staff_identity_id,work_group_id,department_id,operational_role_id)=0)
      or (num_nonnulls(staff_identity_id,work_group_id,department_id,operational_role_id)=1 and (
        (assignment_type='individual' and staff_identity_id is not null)
        or (assignment_type='group' and work_group_id is not null)
        or (assignment_type='role' and operational_role_id is not null)
        or (assignment_type='department' and department_id is not null)))
    );
    create index assignment_staff_current_idx on service_request_assignment(organization_id,staff_identity_id,service_request_id) where ended_at is null;
    create index assignment_group_current_idx on service_request_assignment(organization_id,work_group_id,service_request_id) where ended_at is null;
    create index assignment_role_current_idx on service_request_assignment(organization_id,operational_role_id,service_request_id) where ended_at is null;

    create table service_request_watcher (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_request_id uuid not null,
      target_type varchar(10) not null check(target_type in ('staff','role','group')),
      staff_identity_id uuid, operational_role_id uuid, work_group_id uuid,
      created_by_staff_identity_id uuid not null, created_at timestamptz not null default now(),
      foreign key(organization_id,service_request_id) references service_request(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key(organization_id,operational_role_id) references operational_role(organization_id,id),
      foreign key(organization_id,work_group_id) references work_group(organization_id,id),
      foreign key(organization_id,created_by_staff_identity_id) references staff_identity(organization_id,id),
      check(num_nonnulls(staff_identity_id,operational_role_id,work_group_id)=1 and (
        (target_type='staff' and staff_identity_id is not null) or
        (target_type='role' and operational_role_id is not null) or
        (target_type='group' and work_group_id is not null)))
    );
    create unique index watcher_staff_unique on service_request_watcher(organization_id,service_request_id,staff_identity_id) where staff_identity_id is not null;
    create unique index watcher_role_unique on service_request_watcher(organization_id,service_request_id,operational_role_id) where operational_role_id is not null;
    create unique index watcher_group_unique on service_request_watcher(organization_id,service_request_id,work_group_id) where work_group_id is not null;
    create index watcher_request_idx on service_request_watcher(organization_id,service_request_id,created_at,id);
    create index watcher_staff_idx on service_request_watcher(organization_id,staff_identity_id,service_request_id);
    create index watcher_role_idx on service_request_watcher(organization_id,operational_role_id,service_request_id);
    create index watcher_group_idx on service_request_watcher(organization_id,work_group_id,service_request_id);

    alter table request_operational_activity add column from_target_type varchar(10), add column from_target_name varchar(200),
      add column to_target_type varchar(10), add column to_target_name varchar(200), add column event_index smallint not null default 0;
    alter table request_operational_activity drop constraint request_operational_activity_activity_type_check;
    alter table request_operational_activity add constraint operational_activity_types check(activity_type in (
      'request_created','work_started','placed_on_hold','work_resumed','request_closed','request_reopened','request_routed',
      'request_assigned','request_reassigned','request_unassigned','watcher_added','watcher_removed'));
    do $$ declare c record; begin
      for c in select conname from pg_constraint where conrelid='request_operational_activity'::regclass
        and ((contype='u' and pg_get_constraintdef(oid) like '%request_revision%')
          or (contype='c' and pg_get_constraintdef(oid) like '%from_status IS NULL%'))
      loop execute format('alter table request_operational_activity drop constraint %I',c.conname); end loop;
    end $$;
    alter table request_operational_activity add constraint operational_status_shape check (
      (activity_type in ('work_started','placed_on_hold','work_resumed','request_closed','request_reopened') and from_status is not null and to_status is not null)
      or (activity_type not in ('work_started','placed_on_hold','work_resumed','request_closed','request_reopened') and from_status is null and to_status is null));
    alter table request_operational_activity add constraint operational_target_shape check (
      ((from_target_type is null and from_target_name is null) or (from_target_type is not null and from_target_type in ('staff','role','group') and from_target_name is not null and length(btrim(from_target_name))>0))
      and ((to_target_type is null and to_target_name is null) or (to_target_type is not null and to_target_type in ('staff','role','group') and to_target_name is not null and length(btrim(to_target_name))>0))
      and (case activity_type
        when 'request_assigned' then from_target_type is null and to_target_type is not null
        when 'request_reassigned' then from_target_type is not null and to_target_type is not null
        when 'request_unassigned' then from_target_type is not null and to_target_type is null
        when 'watcher_added' then from_target_type is null and to_target_type is not null
        when 'watcher_removed' then from_target_type is not null and to_target_type is null
        else from_target_type is null and to_target_type is null end));
    alter table request_operational_activity add constraint operational_event_slot check(event_index=0 or (event_index=1 and activity_type='request_unassigned'));
    alter table request_operational_activity add constraint operational_revision_slot_unique unique(organization_id,service_request_id,request_revision,event_index);
    create function check_operational_routing_companion() returns trigger language plpgsql as $$ begin
      if new.event_index=1 and not exists(select 1 from request_operational_activity a where
        a.organization_id=new.organization_id and a.service_request_id=new.service_request_id
        and a.request_revision=new.request_revision and a.event_index=0 and a.activity_type='request_routed'
        and a.staff_identity_id=new.staff_identity_id) then raise exception 'missing routing companion'; end if;
      return new;
    end $$;
    create constraint trigger operational_routing_companion after insert on request_operational_activity
      deferrable initially deferred for each row execute function check_operational_routing_companion();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_request_assignment,service_request_watcher,operational_role,operational_role_membership,request_operational_activity in access exclusive mode;
    do $$ begin
      if exists(select 1 from service_request_watcher) or exists(select 1 from operational_role)
        or exists(select 1 from service_request_assignment where assigned_by_actor_type='staff' or operational_role_id is not null)
        or exists(select 1 from request_operational_activity where activity_type in ('request_assigned','request_reassigned','request_unassigned','watcher_added','watcher_removed'))
      then raise exception 'F037 rollback would discard operational state'; end if;
    end $$;
    drop trigger operational_routing_companion on request_operational_activity;
    drop function check_operational_routing_companion();
    alter table request_operational_activity drop constraint operational_revision_slot_unique, drop constraint operational_event_slot,
      drop constraint operational_target_shape, drop constraint operational_status_shape, drop constraint operational_activity_types;
    alter table request_operational_activity drop column from_target_type, drop column from_target_name, drop column to_target_type, drop column to_target_name, drop column event_index;
    alter table request_operational_activity add unique(organization_id,service_request_id,request_revision);
    alter table request_operational_activity add constraint request_operational_activity_activity_type_check check(activity_type in ('request_created','work_started','placed_on_hold','work_resumed','request_closed','request_reopened','request_routed'));
    alter table request_operational_activity add constraint operational_status_shape check (
      (activity_type in ('request_created','request_routed') and from_status is null and to_status is null)
      or (activity_type not in ('request_created','request_routed') and from_status is not null and to_status is not null));
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check(activity_type in ('service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned','work_started','work_held','work_resumed','service_request_closed','service_request_reopened'));
    drop table service_request_watcher;
    drop index assignment_staff_current_idx,assignment_group_current_idx,assignment_role_current_idx;
    alter table service_request_assignment drop constraint assignment_target_shape, drop constraint assignment_type_allowed, drop constraint assignment_actor_allowed;
    alter table service_request_assignment drop column operational_role_id;
    alter table service_request_assignment add constraint service_request_assignment_assignment_type_check check(assignment_type in ('unassigned','department','individual','group'));
    alter table service_request_assignment add constraint service_request_assignment_assigned_by_actor_type_check check(assigned_by_actor_type='development_staff');
    alter table service_request_assignment add constraint service_request_assignment_check check (
      (assignment_type='unassigned' and num_nonnulls(staff_identity_id,work_group_id,department_id)=0)
      or (num_nonnulls(staff_identity_id,work_group_id,department_id)=1 and (
        (assignment_type='individual' and staff_identity_id is not null) or (assignment_type='group' and work_group_id is not null) or (assignment_type='department' and department_id is not null))));
    drop table operational_role_membership,operational_role;
    drop index work_group_member_staff_idx,work_group_scope_idx;
  `.execute(db);
}

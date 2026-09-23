import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

// Configuration is deliberately empty on migration; historical requests are untouched.
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table issue_default_assignment (
      organization_id uuid not null, service_definition_id uuid not null,
      target_type varchar(10), staff_identity_id uuid, operational_role_id uuid, work_group_id uuid,
      revision integer not null check(revision > 0), updated_at timestamptz not null default clock_timestamp(),
      primary key(organization_id,service_definition_id),
      foreign key(organization_id,service_definition_id) references service_definition(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key(organization_id,operational_role_id) references operational_role(organization_id,id),
      foreign key(organization_id,work_group_id) references work_group(organization_id,id),
      check ((target_type is null and num_nonnulls(staff_identity_id,operational_role_id,work_group_id)=0)
        or (target_type is not null and num_nonnulls(staff_identity_id,operational_role_id,work_group_id)=1 and (
          (target_type='staff' and staff_identity_id is not null) or
          (target_type='role' and operational_role_id is not null) or
          (target_type='group' and work_group_id is not null))))
    );
    create table issue_default_assignment_audit (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_definition_id uuid not null,
      staff_identity_id uuid not null, revision integer not null check(revision > 0),
      action varchar(10) not null check(action in ('set','clear')), occurred_at timestamptz not null default clock_timestamp(),
      target_type varchar(10) check(target_type in ('staff','role','group')), target_id uuid,
      unique(organization_id,service_definition_id,revision),
      foreign key(organization_id,service_definition_id) references service_definition(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      check ((action='clear' and target_type is null and target_id is null) or (action='set' and target_type is not null and target_id is not null))
    );
    create trigger issue_default_audit_immutable before update or delete on issue_default_assignment_audit
      for each row execute function prevent_request_operational_mutation();
    create trigger issue_default_audit_no_truncate before truncate on issue_default_assignment_audit
      for each statement execute function prevent_request_operational_mutation();
    alter table service_request_assignment alter column assigned_by_staff_identity_id drop not null;
    alter table service_request_assignment drop constraint assignment_actor_allowed;
    alter table service_request_assignment add constraint assignment_actor_allowed check(
      (assigned_by_actor_type in ('staff','development_staff') and assigned_by_staff_identity_id is not null)
      or (assigned_by_actor_type='system' and assigned_by_staff_identity_id is null));
    alter table request_operational_activity drop constraint operational_activity_types;
    alter table request_operational_activity add constraint operational_activity_types check(activity_type in (
      'request_created','work_started','placed_on_hold','work_resumed','request_closed','request_reopened','request_routed',
      'request_assigned','request_reassigned','request_unassigned','watcher_added','watcher_removed','request_auto_assigned'));
    alter table request_operational_activity drop constraint operational_target_shape;
    alter table request_operational_activity add constraint operational_target_shape check (
      ((from_target_type is null and from_target_name is null) or (from_target_type is not null and from_target_type in ('staff','role','group') and from_target_name is not null and length(btrim(from_target_name))>0))
      and ((to_target_type is null and to_target_name is null) or (to_target_type is not null and to_target_type in ('staff','role','group') and to_target_name is not null and length(btrim(to_target_name))>0))
      and (case activity_type
        when 'request_assigned' then from_target_type is null and to_target_type is not null
        when 'request_auto_assigned' then from_target_type is null and to_target_type is not null and actor_type='system'
        when 'request_reassigned' then from_target_type is not null and to_target_type is not null
        when 'request_unassigned' then from_target_type is not null and to_target_type is null
        when 'watcher_added' then from_target_type is null and to_target_type is not null
        when 'watcher_removed' then from_target_type is not null and to_target_type is null
        else from_target_type is null and to_target_type is null end));
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table issue_default_assignment,issue_default_assignment_audit,service_request_assignment,request_operational_activity in access exclusive mode;
    do $$ begin
      if exists(select 1 from issue_default_assignment) or exists(select 1 from issue_default_assignment_audit)
        or exists(select 1 from service_request_assignment where assigned_by_actor_type='system')
        or exists(select 1 from request_operational_activity where activity_type='request_auto_assigned')
        then raise exception 'F048 rollback would discard configuration or history'; end if;
    end $$;
    drop table issue_default_assignment_audit,issue_default_assignment;
    alter table service_request_assignment drop constraint assignment_actor_allowed;
    alter table service_request_assignment alter column assigned_by_staff_identity_id set not null;
    alter table service_request_assignment add constraint assignment_actor_allowed check(assigned_by_actor_type in ('development_staff','staff'));
    alter table request_operational_activity drop constraint operational_activity_types;
    alter table request_operational_activity add constraint operational_activity_types check(activity_type in (
      'request_created','work_started','placed_on_hold','work_resumed','request_closed','request_reopened','request_routed',
      'request_assigned','request_reassigned','request_unassigned','watcher_added','watcher_removed'));
    alter table request_operational_activity drop constraint operational_target_shape;
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
  `.execute(db);
}

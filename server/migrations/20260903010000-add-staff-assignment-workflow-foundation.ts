import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table service_request drop constraint service_request_status_check;
    alter table service_request add constraint service_request_status_check check (status in ('open','in_progress','on_hold','closed','cancelled'));
    create table staff_identity (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
      entra_object_id uuid, display_name varchar(200) not null check (length(btrim(display_name)) > 0), email varchar(320),
      active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id,id), unique (organization_id,entra_object_id)
    );
    create table staff_department_membership (
      organization_id uuid not null, staff_identity_id uuid not null, department_id uuid not null, active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (staff_identity_id,department_id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key (organization_id,department_id) references department(organization_id,id)
    );
    create table staff_division_membership (
      organization_id uuid not null, staff_identity_id uuid not null, department_id uuid not null, division_id uuid not null, active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (staff_identity_id,division_id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key (organization_id,department_id,division_id) references division(organization_id,department_id,id)
    );
    create table work_group (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, department_id uuid not null, division_id uuid,
      name varchar(200) not null check (length(btrim(name)) > 0), description text, active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id,id),
      unique (organization_id,department_id,name), foreign key (organization_id,department_id) references department(organization_id,id),
      foreign key (organization_id,department_id,division_id) references division(organization_id,department_id,id)
    );
    create table work_group_membership (
      organization_id uuid not null, work_group_id uuid not null, staff_identity_id uuid not null, active boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (work_group_id,staff_identity_id),
      foreign key (organization_id,work_group_id) references work_group(organization_id,id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create table service_request_assignment (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_request_id uuid not null,
      assignment_type varchar(20) not null check (assignment_type in ('unassigned','department','group','individual')),
      staff_identity_id uuid, work_group_id uuid, department_id uuid, assigned_at timestamptz not null default now(), ended_at timestamptz,
      assigned_by_actor_type varchar(30) not null check (assigned_by_actor_type='development_staff'), assigned_by_staff_identity_id uuid not null,
      reason varchar(500), created_at timestamptz not null default now(),
      foreign key (organization_id,service_request_id) references service_request(organization_id,id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key (organization_id,work_group_id) references work_group(organization_id,id),
      foreign key (organization_id,department_id) references department(organization_id,id),
      foreign key (organization_id,assigned_by_staff_identity_id) references staff_identity(organization_id,id),
      check ((assignment_type='unassigned' and staff_identity_id is null and work_group_id is null and department_id is null)
        or (assignment_type='department' and department_id is not null and staff_identity_id is null and work_group_id is null)
        or (assignment_type='group' and work_group_id is not null and staff_identity_id is null and department_id is null)
        or (assignment_type='individual' and staff_identity_id is not null and work_group_id is null and department_id is null))
    );
    create unique index service_request_one_current_assignment_idx on service_request_assignment(organization_id,service_request_id) where ended_at is null;
    create index service_request_assignment_history_idx on service_request_assignment(organization_id,service_request_id,assigned_at,id);
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check (activity_type in ('service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned','work_started','work_held','work_resumed','service_request_closed','service_request_reopened'));
    alter table activity drop constraint activity_actor_type_check;
    alter table activity add constraint activity_actor_type_check check (actor_type in ('anonymous_resident','identified_resident','system','development_staff'));
    alter table activity add column staff_identity_id uuid;
    alter table activity add constraint activity_staff_actor_fk foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id);
    alter table activity add constraint activity_staff_actor_check check (
      (actor_type='development_staff' and staff_identity_id is not null)
      or (actor_type<>'development_staff' and staff_identity_id is null)
    );
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table activity drop constraint if exists activity_staff_actor_check;
    alter table activity drop constraint if exists activity_staff_actor_fk;
    alter table activity drop column if exists staff_identity_id;
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check (activity_type in ('service_request_created'));
    alter table activity drop constraint activity_actor_type_check;
    alter table activity add constraint activity_actor_type_check check (actor_type in ('anonymous_resident','identified_resident','system'));
    drop table if exists service_request_assignment, work_group_membership, work_group, staff_division_membership, staff_department_membership, staff_identity cascade;
    alter table service_request drop constraint service_request_status_check;
    alter table service_request add constraint service_request_status_check check (status in ('open','closed','cancelled'));
  `.execute(db);
}

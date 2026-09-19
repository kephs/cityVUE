import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table service_request
      add column audience varchar(20) not null default 'public' check (audience in ('public','internal')),
      add column intake_channel varchar(20) not null default 'web' check (intake_channel in ('web','phone','walk_in','staff','api')),
      add column submitted_by_staff_identity_id uuid,
      add column requester_staff_identity_id uuid,
      add constraint request_submitter_staff_fk foreign key (organization_id,submitted_by_staff_identity_id) references staff_identity(organization_id,id),
      add constraint request_requester_staff_fk foreign key (organization_id,requester_staff_identity_id) references staff_identity(organization_id,id),
      add constraint request_internal_staff_check check (audience <> 'internal' or (submitted_by_staff_identity_id is not null and requester_staff_identity_id is not null and requester_staff_identity_id = submitted_by_staff_identity_id and reporting_identity = 'identified')),
      add constraint request_public_requester_check check (audience <> 'public' or requester_staff_identity_id is null);
    alter table activity drop constraint activity_actor_type_check;
    alter table activity add constraint activity_actor_type_check check (actor_type in ('anonymous_resident','identified_resident','system','development_staff','staff'));
    alter table activity drop constraint activity_staff_actor_check;
    alter table activity add constraint activity_staff_actor_check check (
      (actor_type in ('development_staff','staff') and staff_identity_id is not null)
      or (actor_type not in ('development_staff','staff') and staff_identity_id is null)
    );
    insert into permission(permission_key) values ('service_request.create'),('service_request.create_internal') on conflict do nothing;
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // Never erase classification/attribution or expose INTERNAL rows through old code.
  await sql`
    lock table service_request, activity, role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from service_request where audience <> 'public' or intake_channel <> 'web' or submitted_by_staff_identity_id is not null or requester_staff_identity_id is not null)
        or exists(select 1 from activity where actor_type='staff')
        or exists(select 1 from role_permission where permission_key in ('service_request.create','service_request.create_internal'))
      then raise exception 'F029 rollback requires removal of dependent intake data and grants through an approved data-retention process'; end if;
    end $$;
    delete from permission where permission_key in ('service_request.create','service_request.create_internal');
    alter table activity drop constraint activity_staff_actor_check;
    alter table activity drop constraint activity_actor_type_check;
    alter table activity add constraint activity_actor_type_check check (actor_type in ('anonymous_resident','identified_resident','system','development_staff'));
    alter table activity add constraint activity_staff_actor_check check ((actor_type='development_staff' and staff_identity_id is not null) or (actor_type<>'development_staff' and staff_identity_id is null));
    alter table service_request drop column requester_staff_identity_id, drop column submitted_by_staff_identity_id, drop column intake_channel, drop column audience;
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    insert into permission(permission_key) values
      ('service_request.communication.read'),('service_request.communication.create');
    create table request_communication (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      service_request_id uuid not null,
      author_staff_identity_id uuid not null,
      author_display_name text not null check(length(btrim(author_display_name)) between 1 and 200),
      direction text not null default 'outbound' check(direction = 'outbound'),
      channel text not null default 'portal' check(channel = 'portal'),
      delivery_state text not null default 'recorded' check(delivery_state = 'recorded'),
      submission_key uuid not null,
      body text not null check(length(body) between 1 and 4000 and body ~ '[^[:space:]]'),
      created_at timestamptz not null default clock_timestamp(),
      foreign key (organization_id,service_request_id) references service_request(organization_id,id),
      foreign key (organization_id,author_staff_identity_id) references staff_identity(organization_id,id),
      unique(organization_id,service_request_id,author_staff_identity_id,submission_key)
    );
    create index request_communication_page_idx on request_communication(organization_id,service_request_id,created_at desc,id desc);
    create function prevent_request_communication_mutation() returns trigger language plpgsql as $$ begin raise exception 'communications are append-only'; end $$;
    create trigger request_communication_immutable before update or delete on request_communication for each row execute function prevent_request_communication_mutation();
    create trigger request_communication_no_truncate before truncate on request_communication for each statement execute function prevent_request_communication_mutation();
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check(activity_type in (
      'service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned',
      'work_started','work_held','work_resumed','service_request_closed','service_request_reopened',
      'watcher_added','watcher_removed','service_request_contact_viewed','service_request_internal_note_created','service_request_communication_created'));
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table request_communication, activity, role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from request_communication)
        or exists(select 1 from activity where activity_type='service_request_communication_created')
        or exists(select 1 from role_permission where permission_key in ('service_request.communication.read','service_request.communication.create'))
      then raise exception 'Communications, audit or grants prevent safe rollback'; end if;
    end $$;
    drop table request_communication;
    drop function prevent_request_communication_mutation();
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check(activity_type in (
      'service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned',
      'work_started','work_held','work_resumed','service_request_closed','service_request_reopened',
      'watcher_added','watcher_removed','service_request_contact_viewed','service_request_internal_note_created'));
    delete from permission where permission_key in ('service_request.communication.read','service_request.communication.create');
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    insert into permission(permission_key) values ('service_request.contact.read');
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check(activity_type in (
      'service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned',
      'work_started','work_held','work_resumed','service_request_closed','service_request_reopened',
      'watcher_added','watcher_removed','service_request_contact_viewed'));
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table activity, role_permission in share row exclusive mode;
    do $$ begin
      if exists(select 1 from activity where activity_type='service_request_contact_viewed')
        or exists(select 1 from role_permission where permission_key='service_request.contact.read')
      then raise exception 'Contact access audit or grants prevent safe rollback'; end if;
    end $$;
    alter table activity drop constraint activity_activity_type_check;
    alter table activity add constraint activity_activity_type_check check(activity_type in (
      'service_request_created','service_request_assigned','service_request_reassigned','service_request_unassigned',
      'work_started','work_held','work_resumed','service_request_closed','service_request_reopened',
      'watcher_added','watcher_removed'));
    delete from permission where permission_key='service_request.contact.read';
  `.execute(db);
}

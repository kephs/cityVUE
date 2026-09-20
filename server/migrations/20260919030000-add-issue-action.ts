import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`alter table service_definition
    add column action_type varchar(30) not null default 'internal_intake' check (action_type in ('internal_intake','external_redirect')),
    add column redirect_url varchar(2048), add column redirect_message varchar(500), add column redirect_label varchar(80),
    add column action_revision integer not null default 1 check (action_revision > 0),
    add constraint issue_action_consistency check (
      (action_type='internal_intake' and redirect_url is null and redirect_message is null and redirect_label is null) or
      (action_type='external_redirect' and redirect_url is not null and length(redirect_url)>0 and redirect_message is not null and length(btrim(redirect_message))>0 and redirect_label is not null and length(btrim(redirect_label))>0));
    insert into permission(permission_key) values ('catalog.issue_action.manage');`.execute(
    db,
  );
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`lock table service_definition, role_permission in access exclusive mode;
    do $$ begin if exists(select 1 from service_definition where action_type<>'internal_intake' or action_revision<>1)
      or exists(select 1 from role_permission where permission_key='catalog.issue_action.manage')
    then raise exception 'F032 rollback refuses to discard configured Issue actions or grants'; end if; end $$;
    delete from permission where permission_key='catalog.issue_action.manage';
    alter table service_definition drop column action_type, drop column redirect_url, drop column redirect_message, drop column redirect_label, drop column action_revision;`.execute(
    db,
  );
}

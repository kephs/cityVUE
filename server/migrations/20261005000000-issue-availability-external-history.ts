import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';
import { approvedDestination } from '../src/catalog/issue-action.domain.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`lock table service_definition in access exclusive mode`.execute(db);
  const actions = await db
    .selectFrom('service_definition')
    .select([
      'action_type',
      'redirect_url',
      'redirect_message',
      'redirect_label',
    ])
    .execute();
  for (const row of actions) {
    if (row.action_type === 'external_redirect') {
      if (
        !row.redirect_url ||
        !row.redirect_message?.trim() ||
        !row.redirect_label?.trim()
      )
        throw new Error('Existing redirect configuration prevents migration');
      approvedDestination(row.redirect_url);
    } else if (
      row.action_type !== 'internal_intake' ||
      row.redirect_url !== null ||
      row.redirect_message !== null ||
      row.redirect_label !== null
    )
      throw new Error('Existing Issue action prevents migration');
  }
  await sql`
    alter table service_definition add column availability text;
    update service_definition set availability=case when action_type='external_redirect' then 'EXTERNAL_ONLY' else 'INTERNAL_AND_EXTERNAL' end;
    alter table service_definition alter column availability set not null,
      add constraint issue_availability_valid check(availability in ('INTERNAL_ONLY','EXTERNAL_ONLY','INTERNAL_AND_EXTERNAL')),
      add constraint issue_availability_handling check(action_type='internal_intake' or availability='EXTERNAL_ONLY');
    create function protect_issue_availability() returns trigger language plpgsql as $$ begin
      if new.availability is distinct from old.availability then raise exception 'Issue availability is fixed after creation'; end if;
      return new; end $$;
    create trigger issue_availability_immutable before update on service_definition for each row execute function protect_issue_availability();
    create table issue_action_history(
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, issue_id uuid not null,
      action_revision integer not null check(action_revision>0), action_type text not null,
      redirect_url varchar(2048),redirect_message varchar(500),redirect_label varchar(80),
      staff_identity_id uuid,correlation_id uuid,baseline boolean not null default false,
      occurred_at timestamptz not null default clock_timestamp(),
      unique(organization_id,issue_id,action_revision),
      foreign key(organization_id,issue_id) references service_definition(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      check((baseline and staff_identity_id is null and correlation_id is null) or (not baseline and staff_identity_id is not null and correlation_id is not null)),
      check((action_type='internal_intake' and redirect_url is null and redirect_message is null and redirect_label is null) or
        (action_type='external_redirect' and length(redirect_url)>0 and length(btrim(redirect_message))>0 and length(btrim(redirect_label))>0 and redirect_url is not null and redirect_message is not null and redirect_label is not null)));
    insert into issue_action_history(organization_id,issue_id,action_revision,action_type,redirect_url,redirect_message,redirect_label,baseline)
      select organization_id,id,action_revision,action_type,redirect_url,redirect_message,redirect_label,true from service_definition where action_type='external_redirect';
    create function protect_issue_action_history() returns trigger language plpgsql as $$ begin raise exception 'Issue action history is immutable'; end $$;
    create trigger issue_action_history_immutable before update or delete on issue_action_history for each row execute function protect_issue_action_history();
    create trigger issue_action_history_no_truncate before truncate on issue_action_history for each statement execute function protect_issue_action_history();
    alter table issue_configuration_audit add column availability text;
    create table issue_action_audit(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,issue_id uuid not null,staff_identity_id uuid not null,
      prior_action text not null,action text not null,prior_revision integer not null,revision integer not null,
      destination_hostname text,correlation_id uuid not null,occurred_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,issue_id) references service_definition(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key(organization_id,issue_id,revision) references issue_action_history(organization_id,issue_id,action_revision));
    create trigger issue_action_audit_immutable before update or delete on issue_action_audit for each row execute function protect_issue_action_history();
    create trigger issue_action_audit_no_truncate before truncate on issue_action_audit for each statement execute function protect_issue_action_history();
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`lock table service_definition,issue_action_history,issue_action_audit,issue_configuration_audit in access exclusive mode;
    do $$ begin if exists(select 1 from issue_action_history) or exists(select 1 from issue_action_audit)
      or exists(select 1 from issue_configuration_audit where availability is not null)
      or exists(select 1 from service_definition where availability<>'INTERNAL_AND_EXTERNAL')
      then raise exception 'Retained availability or action history prevents rollback'; end if; end $$;
    drop table issue_action_audit; drop table issue_action_history;
    drop function protect_issue_action_history();
    alter table issue_configuration_audit drop column availability;
    drop trigger issue_availability_immutable on service_definition; drop function protect_issue_availability();
    alter table service_definition drop column availability;
  `.execute(db);
}

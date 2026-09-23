import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    do $$ begin
      if exists(select 1 from requester_contact c join service_request r on r.organization_id=c.organization_id and r.id=c.service_request_id where r.reporting_identity='anonymous')
      then raise exception 'F049 requires review of contradictory historical Contact'; end if;
    end $$;
    create table issue_requester_identity_policy (
      organization_id uuid not null, service_definition_id uuid not null,
      policy varchar(32) not null check(policy in ('IDENTIFIED_REQUIRED','ANONYMOUS_ALLOWED')),
      revision integer not null check(revision>0), updated_at timestamptz not null default clock_timestamp(),
      primary key(organization_id,service_definition_id),
      foreign key(organization_id,service_definition_id) references service_definition(organization_id,id)
    );
    insert into issue_requester_identity_policy(organization_id,service_definition_id,policy,revision)
      select i.organization_id,i.id,case when v.anonymous_reporting_policy in ('allowed','allowed_with_limitations') then 'ANONYMOUS_ALLOWED' else 'IDENTIFIED_REQUIRED' end,1
      from service_definition i left join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id;
    create table issue_requester_identity_audit (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_definition_id uuid not null,
      staff_identity_id uuid not null, revision integer not null check(revision>0),
      prior_policy varchar(32) not null check(prior_policy in ('IDENTIFIED_REQUIRED','ANONYMOUS_ALLOWED')),
      policy varchar(32) not null check(policy in ('IDENTIFIED_REQUIRED','ANONYMOUS_ALLOWED')),
      occurred_at timestamptz not null default clock_timestamp(),
      unique(organization_id,service_definition_id,revision),
      foreign key(organization_id,service_definition_id) references service_definition(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create function prevent_identity_policy_audit_mutation() returns trigger language plpgsql as $$ begin
      raise exception 'Requester identity policy audit is immutable'; end $$;
    create trigger identity_policy_audit_immutable before update or delete on issue_requester_identity_audit for each row execute function prevent_identity_policy_audit_mutation();
    create trigger identity_policy_audit_no_truncate before truncate on issue_requester_identity_audit for each statement execute function prevent_identity_policy_audit_mutation();
    create function preserve_request_identity() returns trigger language plpgsql as $$ begin
      if new.reporting_identity is distinct from old.reporting_identity then raise exception 'Request identity is immutable'; end if;
      return new; end $$;
    create trigger request_identity_immutable before update on service_request for each row execute function preserve_request_identity();
    create function reject_anonymous_contact() returns trigger language plpgsql as $$ begin
      if exists(select 1 from service_request where organization_id=new.organization_id and id=new.service_request_id and reporting_identity='anonymous')
      then raise exception 'Anonymous request cannot have Contact'; end if;
      return new; end $$;
    create trigger anonymous_contact_forbidden before insert or update on requester_contact for each row execute function reject_anonymous_contact();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table issue_requester_identity_policy,issue_requester_identity_audit,service_definition,service_request,requester_contact in access exclusive mode;
    do $$ begin
      if exists(select 1 from issue_requester_identity_audit) or exists(
        select 1 from issue_requester_identity_policy p join service_definition i on i.organization_id=p.organization_id and i.id=p.service_definition_id
        left join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
        where p.policy <> case when v.anonymous_reporting_policy in ('allowed','allowed_with_limitations') then 'ANONYMOUS_ALLOWED' else 'IDENTIFIED_REQUIRED' end)
      then raise exception 'F049 rollback would discard policy or audit'; end if;
    end $$;
    drop trigger anonymous_contact_forbidden on requester_contact;
    drop function reject_anonymous_contact();
    drop trigger request_identity_immutable on service_request;
    drop function preserve_request_identity();
    drop table issue_requester_identity_audit,issue_requester_identity_policy;
    drop function prevent_identity_policy_audit_mutation();
  `.execute(db);
}

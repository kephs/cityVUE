import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_definition, issue_configuration_audit in access exclusive mode;
    alter table issue_configuration_audit
      add column prior_availability text,
      add column prior_handling text,
      add column handling text,
      add column prior_action_revision integer,
      add column action_revision integer,
      add column mutation_txid bigint,
      add constraint availability_transition_metadata check (
        (prior_availability is null and prior_handling is null and handling is null
          and prior_action_revision is null and action_revision is null and mutation_txid is null)
        or (prior_availability is not null and availability is not null
          and prior_availability in ('INTERNAL_ONLY','EXTERNAL_ONLY','INTERNAL_AND_EXTERNAL')
          and availability in ('INTERNAL_ONLY','EXTERNAL_ONLY','INTERNAL_AND_EXTERNAL')
          and prior_availability <> availability
          and prior_handling is not null and handling is not null
          and prior_handling in ('internal_intake','external_redirect')
          and handling in ('internal_intake','external_redirect')
          and (prior_handling='internal_intake' or prior_availability='EXTERNAL_ONLY')
          and (handling='internal_intake' or availability='EXTERNAL_ONLY')
          and prior_action_revision is not null and prior_action_revision > 0
          and action_revision is not null and action_revision between prior_action_revision and prior_action_revision+1
          and (handling=prior_handling or action_revision=prior_action_revision+1)
          and prior_core_revision is not null and core_revision=prior_core_revision+1
          and mutation_txid is not null and action <> 'created'
          and 'availability'=any(changed_fields)));
    create unique index issue_availability_transition_revision
      on issue_configuration_audit(organization_id,issue_id,core_revision)
      where prior_availability is not null;

    create function stamp_issue_availability_transition() returns trigger language plpgsql as $$
    declare i service_definition%rowtype;
    begin
      if new.prior_availability is null then return new; end if;
      select * into i from service_definition where organization_id=new.organization_id and id=new.issue_id for update;
      if not found or (i.availability,i.action_type,i.core_revision,i.action_revision)
        is distinct from (new.prior_availability,new.prior_handling,new.prior_core_revision,new.prior_action_revision)
        then raise exception 'Availability transition does not match current Issue'; end if;
      new.mutation_txid=txid_current();
      return new;
    end $$;
    create trigger issue_availability_transition_stamp before insert on issue_configuration_audit
      for each row execute function stamp_issue_availability_transition();

    create or replace function protect_issue_availability() returns trigger language plpgsql as $$ begin
      if new.availability is distinct from old.availability then
        if (new.organization_id,new.id) is distinct from (old.organization_id,old.id)
          or not exists(select 1 from issue_configuration_audit a
            where a.organization_id=old.organization_id and a.issue_id=old.id
              and a.mutation_txid=txid_current()
              and a.prior_availability=old.availability and a.availability=new.availability
              and a.prior_handling=old.action_type and a.handling=new.action_type
              and a.prior_core_revision=old.core_revision and a.core_revision=old.core_revision+1
              and a.prior_action_revision=old.action_revision and a.action_revision=new.action_revision)
          then raise exception 'Availability change requires matching transaction audit'; end if;
      end if;
      return new;
    end $$;

    create or replace function maintain_issue_core() returns trigger language plpgsql as $$ begin
      select v.name into new.current_display_name from service_definition_version v
        where v.organization_id=new.organization_id and v.service_definition_id=new.id and v.id=new.current_published_version_id;
      if TG_OP='UPDATE' then
        if (new.status,new.display_order,new.current_published_version_id,new.availability)
          is distinct from (old.status,old.display_order,old.current_published_version_id,old.availability) then
          new.core_revision=old.core_revision+1; new.updated_at=clock_timestamp();
        else new.core_revision=old.core_revision; end if;
      end if;
      return new;
    end $$;

    create function verify_issue_availability_transition() returns trigger language plpgsql as $$ begin
      if new.prior_availability is not null and not exists (
        select 1 from service_definition i where i.organization_id=new.organization_id and i.id=new.issue_id
          and i.availability=new.availability and i.action_type=new.handling
          and i.core_revision=new.core_revision and i.action_revision=new.action_revision
          and (new.action_revision=new.prior_action_revision or exists (
            select 1 from issue_action_history h join issue_action_audit a
              on a.organization_id=h.organization_id and a.issue_id=h.issue_id and a.revision=h.action_revision
            where h.organization_id=new.organization_id and h.issue_id=new.issue_id
              and h.action_revision=new.action_revision and h.action_type=new.handling
              and h.staff_identity_id=new.staff_identity_id and h.correlation_id=new.correlation_id
              and a.staff_identity_id=new.staff_identity_id and a.correlation_id=new.correlation_id
              and a.prior_revision=new.prior_action_revision and a.prior_action=new.prior_handling)))
        then raise exception 'Availability transition was not completed atomically'; end if;
      return null;
    end $$;
    create constraint trigger issue_availability_transition_complete after insert on issue_configuration_audit
      deferrable initially deferred for each row execute function verify_issue_availability_transition();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_definition,issue_configuration_audit in access exclusive mode;
    do $$ begin if exists(select 1 from issue_configuration_audit where prior_availability is not null)
      then raise exception 'Retained Availability transitions prevent rollback'; end if; end $$;
    drop trigger issue_availability_transition_complete on issue_configuration_audit;
    drop trigger issue_availability_transition_stamp on issue_configuration_audit;
    drop function verify_issue_availability_transition();
    drop function stamp_issue_availability_transition();
    drop index issue_availability_transition_revision;
    alter table issue_configuration_audit drop constraint availability_transition_metadata,
      drop column prior_availability,drop column prior_handling,drop column handling,
      drop column prior_action_revision,drop column action_revision,drop column mutation_txid;
    create or replace function protect_issue_availability() returns trigger language plpgsql as $$ begin
      if new.availability is distinct from old.availability then raise exception 'Issue availability is fixed after creation'; end if;
      return new;
    end $$;
    create or replace function maintain_issue_core() returns trigger language plpgsql as $$ begin
      select v.name into new.current_display_name from service_definition_version v
        where v.organization_id=new.organization_id and v.service_definition_id=new.id and v.id=new.current_published_version_id;
      if TG_OP='UPDATE' then
        if (new.status,new.display_order,new.current_published_version_id) is distinct from (old.status,old.display_order,old.current_published_version_id) then
          new.core_revision=old.core_revision+1; new.updated_at=clock_timestamp();
        else new.core_revision=old.core_revision; end if;
      end if;
      return new;
    end $$;
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

// Maintenance operation: the migrator runs PostgreSQL DDL transactionally.
// Preserve the existing trigger bindings and every non-communication guard.
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`set local lock_timeout = '5s';
    lock table attachment_batch in share row exclusive mode;
    create or replace function protect_attachment_batch() returns trigger language plpgsql as $$ begin
      if TG_OP='TRUNCATE' then raise exception 'Attachment lifecycle is protected'; end if;
      if TG_OP='DELETE' then if OLD.state='FINALIZED' then raise exception 'Finalized attachments are immutable'; end if; return OLD; end if;
      if OLD.state='FINALIZED' or NEW.state <> 'FINALIZED' or
        (to_jsonb(NEW) - array['state','service_request_id','note_id','communication_id','finalized_at','submission_digest']) is distinct from
        (to_jsonb(OLD) - array['state','service_request_id','note_id','communication_id','finalized_at','submission_digest']) or
        (OLD.service_request_id is not null and OLD.service_request_id <> NEW.service_request_id) or
        exists(select 1 from attachment where batch_id=OLD.id and scan_state <> 'CLEAN')
      then raise exception 'Invalid attachment finalization'; end if;
      if NEW.context='REQUESTER_COMMUNICATION' and not exists(select 1 from service_request where id=NEW.service_request_id and organization_id=NEW.organization_id and audience in ('public','internal')) then raise exception 'Invalid communication parent'; end if;
      if NEW.context='REQUEST_EVIDENCE' and not exists(select 1 from service_request where id=NEW.service_request_id and organization_id=NEW.organization_id and audience='public' and service_definition_id=NEW.service_definition_id and service_definition_version_id=NEW.service_definition_version_id) then raise exception 'Invalid evidence parent'; end if;
      return NEW;
    end $$;
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`set local lock_timeout = '5s';
    lock table service_request in share row exclusive mode;
    lock table attachment_batch in share row exclusive mode;
    do $$ begin
      if exists(select 1 from attachment_batch b
        join service_request r on r.organization_id=b.organization_id and r.id=b.service_request_id
        where b.context='REQUESTER_COMMUNICATION' and r.audience='internal')
      then raise exception 'Retained INTERNAL communication attachment batches prevent safe rollback'; end if;
    end $$;
    create or replace function protect_attachment_batch() returns trigger language plpgsql as $$ begin
      if TG_OP='TRUNCATE' then raise exception 'Attachment lifecycle is protected'; end if;
      if TG_OP='DELETE' then if OLD.state='FINALIZED' then raise exception 'Finalized attachments are immutable'; end if; return OLD; end if;
      if OLD.state='FINALIZED' or NEW.state <> 'FINALIZED' or
        (to_jsonb(NEW) - array['state','service_request_id','note_id','communication_id','finalized_at','submission_digest']) is distinct from
        (to_jsonb(OLD) - array['state','service_request_id','note_id','communication_id','finalized_at','submission_digest']) or
        (OLD.service_request_id is not null and OLD.service_request_id <> NEW.service_request_id) or
        exists(select 1 from attachment where batch_id=OLD.id and scan_state <> 'CLEAN')
      then raise exception 'Invalid attachment finalization'; end if;
      if NEW.context='REQUESTER_COMMUNICATION' and not exists(select 1 from service_request where id=NEW.service_request_id and audience='public') then raise exception 'Invalid communication parent'; end if;
      if NEW.context='REQUEST_EVIDENCE' and not exists(select 1 from service_request where id=NEW.service_request_id and organization_id=NEW.organization_id and audience='public' and service_definition_id=NEW.service_definition_id and service_definition_version_id=NEW.service_definition_version_id) then raise exception 'Invalid evidence parent'; end if;
      return NEW;
    end $$;
  `.execute(db);
}

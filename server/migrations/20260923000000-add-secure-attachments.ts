import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table request_internal_note add constraint note_attachment_parent unique(organization_id,service_request_id,id);
    alter table request_communication add constraint communication_attachment_parent unique(organization_id,service_request_id,id);
    create table attachment_batch (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
      context text not null check(context in ('REQUEST_EVIDENCE','INTERNAL_NOTE','REQUESTER_COMMUNICATION')),
      token_digest text not null check(token_digest ~ '^[0-9a-f]{64}$'),
      staff_identity_id uuid, service_definition_id uuid, service_definition_version_id uuid,
      service_request_id uuid, note_id uuid, communication_id uuid,
      state text not null default 'STAGED' check(state in ('STAGED','FINALIZED')),
      submission_digest text check(submission_digest ~ '^[0-9a-f]{64}$'),
      created_at timestamptz not null default clock_timestamp(), expires_at timestamptz not null,
      finalized_at timestamptz,
      unique(organization_id,id,context),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key(organization_id,service_definition_id,service_definition_version_id) references service_definition_version(organization_id,service_definition_id,id),
      foreign key(organization_id,service_request_id) references service_request(organization_id,id),
      foreign key(organization_id,service_request_id,note_id) references request_internal_note(organization_id,service_request_id,id),
      foreign key(organization_id,service_request_id,communication_id) references request_communication(organization_id,service_request_id,id),
      check(expires_at > created_at and expires_at <= created_at + interval '31 minutes'),
      check((context='REQUEST_EVIDENCE' and staff_identity_id is null and service_definition_id is not null and service_definition_version_id is not null and note_id is null and communication_id is null)
        or (context='INTERNAL_NOTE' and staff_identity_id is not null and service_request_id is not null and service_definition_id is null and service_definition_version_id is null and communication_id is null)
        or (context='REQUESTER_COMMUNICATION' and staff_identity_id is not null and service_request_id is not null and service_definition_id is null and service_definition_version_id is null and note_id is null)),
      check((state='STAGED' and finalized_at is null and submission_digest is null and note_id is null and communication_id is null and (context <> 'REQUEST_EVIDENCE' or service_request_id is null))
        or (state='FINALIZED' and finalized_at is not null and submission_digest is not null and service_request_id is not null
          and (context <> 'INTERNAL_NOTE' or note_id is not null) and (context <> 'REQUESTER_COMMUNICATION' or communication_id is not null)))
    );
    create unique index attachment_one_note_batch on attachment_batch(note_id) where note_id is not null;
    create unique index attachment_one_communication_batch on attachment_batch(communication_id) where communication_id is not null;
    create unique index attachment_one_evidence_batch on attachment_batch(service_request_id) where context='REQUEST_EVIDENCE' and state='FINALIZED';
    create index attachment_batch_expiry on attachment_batch(expires_at) where state='STAGED';
    create index attachment_batch_parent on attachment_batch(organization_id,service_request_id,context);
    create table attachment (
      id uuid primary key, organization_id uuid not null, batch_id uuid not null, context text not null,
      storage_key uuid not null unique, filename text not null check(length(filename) between 1 and 120 and filename ~ '^[a-zA-Z0-9._ -]+$'),
      media_type text not null check(media_type in ('image/jpeg','image/png','image/webp')),
      byte_size integer not null check(byte_size between 1 and 5242880),
      source_byte_size integer not null check(source_byte_size between 1 and 5242880),
      content_checksum text not null check(content_checksum ~ '^[0-9a-f]{64}$'),
      scan_state text not null check(scan_state in ('PENDING_SCAN','CLEAN','REJECTED')),
      created_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,batch_id,context) references attachment_batch(organization_id,id,context)
    );
    create index attachment_batch_files on attachment(organization_id,batch_id);
    create table attachment_audit (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
      context text not null check(context in ('REQUEST_EVIDENCE','INTERNAL_NOTE','REQUESTER_COMMUNICATION')),
      action text not null check(action in ('opened','staged','removed','finalized','downloaded','expired')),
      batch_id uuid not null, attachment_id uuid, service_request_id uuid, staff_identity_id uuid,
      created_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,service_request_id) references service_request(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create function protect_attachment_batch() returns trigger language plpgsql as $$ begin
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
    create trigger attachment_batch_guard before update or delete on attachment_batch for each row execute function protect_attachment_batch();
    create trigger attachment_batch_no_truncate before truncate on attachment_batch for each statement execute function protect_attachment_batch();
    create function protect_attachment_file() returns trigger language plpgsql as $$ declare b attachment_batch; begin
      if TG_OP='TRUNCATE' then raise exception 'Attachment lifecycle is protected'; end if;
      select * into b from attachment_batch where id=case when TG_OP='DELETE' then OLD.batch_id else NEW.batch_id end for update;
      if b.state <> 'STAGED' or (TG_OP <> 'DELETE' and b.expires_at <= clock_timestamp()) then raise exception 'Attachment batch is unavailable'; end if;
      if TG_OP='DELETE' then return OLD; end if;
      if TG_OP='UPDATE' and ((to_jsonb(NEW)-'scan_state') is distinct from (to_jsonb(OLD)-'scan_state') or OLD.scan_state <> 'PENDING_SCAN' or NEW.scan_state not in ('CLEAN','REJECTED')) then raise exception 'Invalid attachment transition'; end if;
      if TG_OP='INSERT' and ((select count(*) from attachment where batch_id=NEW.batch_id)>=5 or (select coalesce(sum(greatest(byte_size,source_byte_size)),0) from attachment where batch_id=NEW.batch_id)+greatest(NEW.byte_size,NEW.source_byte_size)>15728640) then raise exception 'Attachment limits exceeded'; end if;
      return NEW;
    end $$;
    create trigger attachment_file_guard before insert or update or delete on attachment for each row execute function protect_attachment_file();
    create trigger attachment_file_no_truncate before truncate on attachment for each statement execute function protect_attachment_file();
    create trigger attachment_audit_immutable before update or delete on attachment_audit for each row execute function prevent_request_communication_mutation();
    create trigger attachment_audit_no_truncate before truncate on attachment_audit for each statement execute function prevent_request_communication_mutation();
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`lock table attachment_batch,attachment,attachment_audit in access exclusive mode;
    do $$ begin if exists(select 1 from attachment_batch) or exists(select 1 from attachment) or exists(select 1 from attachment_audit) then raise exception 'Attachment data prevents safe rollback'; end if; end $$;
    drop table attachment_audit,attachment,attachment_batch;
    drop function protect_attachment_file(),protect_attachment_batch();
    alter table request_internal_note drop constraint note_attachment_parent;
    alter table request_communication drop constraint communication_attachment_parent;
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table requester (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      identity_source text not null check(identity_source in ('DEVELOPMENT_SYNTHETIC')),
      identity_subject text not null check(identity_subject ~ '^fictional-[a-z0-9][a-z0-9-]{0,99}$'),
      created_at timestamptz not null default clock_timestamp(),
      unique(organization_id,id),
      unique(organization_id,identity_source,identity_subject)
    );
    alter table service_request add column requester_id uuid,
      add constraint service_request_requester_org foreign key(organization_id,requester_id) references requester(organization_id,id),
      add constraint service_request_requester_eligible check(requester_id is null or (audience='public' and reporting_identity='identified'));
    create index service_request_requester_history on service_request(organization_id,requester_id,created_at desc,id desc) where requester_id is not null;
    create function protect_requester_link() returns trigger language plpgsql as $$
    begin
      if NEW.requester_id is distinct from OLD.requester_id then
        raise exception 'Requester linkage is immutable';
      end if;
      return NEW;
    end $$;
    create trigger service_request_requester_immutable before update on service_request for each row execute function protect_requester_link();
    create function protect_requester_history_identity() returns trigger language plpgsql as $$
    begin raise exception 'Requester identity and history audit are immutable'; end $$;
    create trigger requester_immutable before update or delete on requester for each row execute function protect_requester_history_identity();
    create trigger requester_no_truncate before truncate on requester for each statement execute function protect_requester_history_identity();
    create table requester_history_audit (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      service_request_id uuid not null,
      staff_identity_id uuid not null,
      action text not null check(action='history_viewed'),
      correlation_id uuid not null,
      created_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,service_request_id) references service_request(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create trigger requester_history_audit_immutable before update or delete on requester_history_audit for each row execute function protect_requester_history_identity();
    create trigger requester_history_audit_no_truncate before truncate on requester_history_audit for each statement execute function protect_requester_history_identity();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table requester, service_request, requester_history_audit in access exclusive mode;
    do $$ begin
      if exists(select 1 from requester) or exists(select 1 from service_request where requester_id is not null)
        or exists(select 1 from requester_history_audit) then raise exception 'Retained identity or audit prevents rollback'; end if;
    end $$;
    drop table requester_history_audit;
    drop trigger service_request_requester_immutable on service_request;
    drop function protect_requester_link();
    alter table service_request drop column requester_id;
    drop table requester;
    drop function protect_requester_history_identity();
  `.execute(db);
}

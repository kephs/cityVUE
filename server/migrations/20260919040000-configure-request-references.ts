import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization, service_request, service_request_reference_sequence in access exclusive mode;
    do $$ begin
      if exists(select 1 from service_request where reference_number !~ '^SR-[0-9]{4}(0[1-9]|1[0-2])-[0-9]{6}$' or right(reference_number,6)::integer < 1)
      then raise exception 'F033 migration requires valid legacy references'; end if;
    end $$;
    create table service_request_reference_config (
      organization_id uuid primary key references organization(id),
      prefix varchar(12) not null default 'SR' check(prefix ~ '^[A-Z0-9]{0,12}$'),
      date_component varchar(10) not null default 'year_month',
      sequence_width integer not null default 6 check(sequence_width between 4 and 12),
      reset_policy varchar(10) not null default 'monthly',
      separator varchar(1) not null default '-' check(separator in ('-','')),
      revision integer not null default 1 check(revision > 0),
      updated_at timestamptz not null default now(),
      check ((date_component='none' and reset_policy='never') or (date_component='year' and reset_policy='yearly') or (date_component='year_month' and reset_policy='monthly'))
    );
    insert into service_request_reference_config(organization_id) select id from organization;
    alter table service_request_reference_sequence rename to legacy_reference_sequence;
    create table service_request_reference_sequence (
      organization_id uuid not null references organization(id),
      period_key varchar(6) not null check(period_key='never' or period_key ~ '^[0-9]{4}$' or period_key ~ '^[0-9]{4}(0[1-9]|1[0-2])$'),
      last_value bigint not null check(last_value > 0), updated_at timestamptz not null default now(),
      primary key (organization_id, period_key)
    );
    insert into service_request_reference_sequence(organization_id,period_key,last_value)
      select o.id,s.period_key,s.last_value from organization o cross join legacy_reference_sequence s;
    -- Legacy schema guarantees this exact format. Reconcile manually seeded history as well as authoritative counters.
    insert into service_request_reference_sequence(organization_id,period_key,last_value)
      select organization_id,substring(reference_number from 4 for 6),max(right(reference_number,6)::bigint)
      from service_request group by organization_id,substring(reference_number from 4 for 6)
      on conflict(organization_id,period_key) do update set last_value=greatest(service_request_reference_sequence.last_value,excluded.last_value);
    drop table legacy_reference_sequence;
    alter table service_request drop constraint service_request_reference_number_key, drop constraint service_request_reference_number_check;
    alter table service_request alter column reference_number type varchar(48);
    alter table service_request add constraint service_request_org_reference_unique unique(organization_id,reference_number),
      add constraint service_request_reference_safe check(reference_number ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$');
    create function preserve_request_reference() returns trigger language plpgsql as $$ begin
      if new.reference_number is distinct from old.reference_number or new.organization_id is distinct from old.organization_id or new.id is distinct from old.id
      then raise exception 'Service Request identity and reference are immutable'; end if; return new; end $$;
    create trigger immutable_request_reference before update on service_request for each row execute function preserve_request_reference();
    insert into permission(permission_key) values ('service_request.reference.manage');
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_request,service_request_reference_config,service_request_reference_sequence,role_permission in access exclusive mode;
    do $$ begin if exists(select 1 from service_request) or exists(select 1 from service_request_reference_sequence)
      or exists(select 1 from service_request_reference_config where revision<>1)
      or exists(select 1 from role_permission where permission_key='service_request.reference.manage')
      then raise exception 'F033 rollback refuses to discard operational reference state'; end if; end $$;
    delete from permission where permission_key='service_request.reference.manage';
    drop trigger immutable_request_reference on service_request;
    drop function preserve_request_reference();
    alter table service_request drop constraint service_request_org_reference_unique, drop constraint service_request_reference_safe;
    alter table service_request alter column reference_number type varchar(16);
    alter table service_request add constraint service_request_reference_number_key unique(reference_number),
      add constraint service_request_reference_number_check check(reference_number ~ '^SR-[0-9]{6}-[0-9]{6}$');
    drop table service_request_reference_sequence,service_request_reference_config;
    create table service_request_reference_sequence(period_key char(6) primary key check(period_key ~ '^[0-9]{6}$'),
      last_value integer not null check(last_value between 1 and 999999),updated_at timestamptz not null default now());
  `.execute(db);
}

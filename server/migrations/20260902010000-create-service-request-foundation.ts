import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table service_definition add constraint service_definition_category_identity_unique unique (organization_id, category_id, id);
    create table service_request_reference_sequence (
      period_key char(6) primary key check (period_key ~ '^[0-9]{6}$'),
      last_value integer not null check (last_value between 1 and 999999), updated_at timestamptz not null default now()
    );
    create table service_request (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
      reference_number varchar(16) not null unique check (reference_number ~ '^SR-[0-9]{6}-[0-9]{6}$'),
      service_definition_id uuid not null, service_definition_version_id uuid not null, category_id uuid not null,
      status varchar(20) not null check (status in ('open','closed','cancelled')),
      priority varchar(20) not null check (priority in ('low','medium','high','urgent')),
      description text not null check (length(btrim(description)) between 1 and 10000),
      reporting_identity varchar(20) not null check (reporting_identity in ('anonymous','identified')),
      revision integer not null default 1 check (revision > 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id, id),
      foreign key (organization_id, category_id, service_definition_id) references service_definition(organization_id, category_id, id),
      foreign key (organization_id, service_definition_id, service_definition_version_id) references service_definition_version(organization_id, service_definition_id, id)
    );
    create table requester_contact (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_request_id uuid not null,
      name varchar(200) not null check (length(btrim(name)) > 0), email varchar(320),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (service_request_id),
      foreign key (organization_id, service_request_id) references service_request(organization_id, id)
    );
    create table location (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_request_id uuid not null,
      entered_address text not null check (length(btrim(entered_address)) > 0), normalized_address text,
      latitude numeric(9,6) check (latitude between -90 and 90), longitude numeric(9,6) check (longitude between -180 and 180),
      location_type varchar(30) not null default 'entered_address' check (location_type in ('entered_address','intersection','facility','park','parcel','gis_asset','other')),
      facility_reference text, park_reference text, parcel_reference text, gis_asset_reference text,
      eligibility_result varchar(30) check (eligibility_result in ('eligible','ineligible','unable_to_determine')),
      validated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (service_request_id),
      foreign key (organization_id, service_request_id) references service_request(organization_id, id)
    );
    create table answer (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_request_id uuid not null, question_id uuid not null,
      question_key varchar(100) not null, question_label text not null, question_type varchar(30) not null check (question_type in ('short_text','long_text','number','yes_no','single_select')),
      display_order integer not null check (display_order >= 0), text_value text, number_value numeric, boolean_value boolean,
      option_key varchar(100), display_value text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (service_request_id, question_id),
      check ((question_type in ('short_text','long_text') and text_value is not null and number_value is null and boolean_value is null and option_key is null)
        or (question_type='number' and number_value is not null and text_value is null and boolean_value is null and option_key is null)
        or (question_type='yes_no' and boolean_value is not null and text_value is null and number_value is null and option_key is null)
        or (question_type='single_select' and option_key is not null and display_value is not null and text_value is null and number_value is null and boolean_value is null)),
      foreign key (organization_id, service_request_id) references service_request(organization_id, id),
      foreign key (organization_id, question_id) references question(organization_id, id)
    );
    create table activity (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, service_request_id uuid not null,
      activity_type varchar(40) not null check (activity_type in ('service_request_created')),
      actor_type varchar(30) not null check (actor_type in ('anonymous_resident','identified_resident','system')),
      actor_reference uuid, metadata jsonb not null default '{}', occurred_at timestamptz not null default now(),
      foreign key (organization_id, service_request_id) references service_request(organization_id, id)
    );
    create index service_request_org_created_idx on service_request(organization_id, created_at desc);
    create index service_request_catalog_idx on service_request(organization_id, service_definition_id, service_definition_version_id);
    create index answer_request_order_idx on answer(organization_id, service_request_id, display_order);
    create index activity_request_time_idx on activity(organization_id, service_request_id, occurred_at);
    create function prevent_activity_mutation() returns trigger language plpgsql as $$ begin raise exception 'activity is append-only'; end $$;
    create trigger append_only_activity before update or delete on activity for each row execute function prevent_activity_mutation();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`drop table if exists activity, answer, location, requester_contact, service_request, service_request_reference_sequence cascade`.execute(
    db,
  );
  await sql`drop function if exists prevent_activity_mutation()`.execute(db);
  await sql`alter table service_definition drop constraint if exists service_definition_category_identity_unique`.execute(
    db,
  );
}

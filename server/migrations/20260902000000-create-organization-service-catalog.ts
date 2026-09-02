import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`create extension if not exists pgcrypto`.execute(db);
  await sql`
    create table organization (
      id uuid primary key default gen_random_uuid(), name varchar(200) not null,
      short_name varchar(80) not null, slug varchar(100) not null unique,
      status varchar(20) not null default 'active' check (status in ('active','inactive')),
      default_business_timezone varchar(100) not null,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now()
    );
    create table department (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
      name varchar(200) not null, description text, status varchar(20) not null default 'active' check (status in ('active','inactive','archived')),
      display_order integer not null default 0 check (display_order >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id, id), unique (organization_id, name)
    );
    create table division (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), department_id uuid not null,
      name varchar(200) not null, description text, status varchar(20) not null default 'active' check (status in ('active','inactive','archived')),
      display_order integer not null default 0 check (display_order >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id, id), unique (organization_id, department_id, id), unique (organization_id, department_id, name),
      foreign key (organization_id, department_id) references department(organization_id, id)
    );
    create table category (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), department_id uuid not null, division_id uuid,
      name varchar(200) not null, description text not null default '', icon_key varchar(80) not null,
      aliases text[] not null default '{}', keywords text[] not null default '{}',
      status varchar(20) not null default 'active' check (status in ('active','inactive','archived')),
      display_order integer not null default 0 check (display_order >= 0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      check (icon_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'), unique (organization_id, id), unique (organization_id, department_id, name),
      foreign key (organization_id, department_id) references department(organization_id, id),
      foreign key (organization_id, department_id, division_id) references division(organization_id, department_id, id)
    );
    create table service_definition (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), category_id uuid not null,
      service_key varchar(100) not null, status varchar(20) not null default 'active' check (status in ('active','inactive','archived')),
      current_published_version_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id, id), unique (organization_id, service_key),
      foreign key (organization_id, category_id) references category(organization_id, id)
    );
    create table service_definition_version (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), service_definition_id uuid not null,
      version_number integer not null check (version_number > 0), name varchar(200) not null, resident_description text not null default '',
      icon_key varchar(80) not null check (icon_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'), aliases text[] not null default '{}', keywords text[] not null default '{}',
      default_priority varchar(20) not null check (default_priority in ('low','medium','high','urgent')),
      location_policy varchar(30) not null check (location_policy in ('required','optional','not_applicable')),
      geographic_eligibility_mode varchar(40) not null check (geographic_eligibility_mode in ('city_boundary','service_area','city_maintained_roadway','city_owned_property','facility','park','gis_asset','utility_service_area','no_geographic_restriction')),
      anonymous_reporting_policy varchar(40) not null check (anonymous_reporting_policy in ('allowed','not_allowed','allowed_with_limitations')),
      status varchar(20) not null check (status in ('draft','published','inactive','archived')),
      published_at timestamptz, routing_metadata jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      check ((status = 'published' and published_at is not null) or status <> 'published'),
      unique (organization_id, id), unique (organization_id, service_definition_id, id), unique (organization_id, service_definition_id, version_number),
      foreign key (organization_id, service_definition_id) references service_definition(organization_id, id)
    );
    alter table service_definition add constraint service_definition_published_version_fk
      foreign key (organization_id, id, current_published_version_id)
      references service_definition_version(organization_id, service_definition_id, id);
    create table question (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), service_definition_version_id uuid not null,
      question_key varchar(100) not null, label text not null, help_text text,
      question_type varchar(30) not null check (question_type in ('short_text','long_text','number','yes_no','single_select','date','timestamp','multi_select','attachment_reference')),
      is_required boolean not null default false, display_order integer not null check (display_order >= 0),
      validation_metadata jsonb, visibility_condition jsonb, status varchar(20) not null default 'active' check (status in ('active','inactive','archived')),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      check (visibility_condition is null or (jsonb_typeof(visibility_condition) = 'object' and visibility_condition ?& array['questionKey','operator','value'] and visibility_condition->>'operator' = 'equals')),
      unique (organization_id, id), unique (organization_id, service_definition_version_id, question_key), unique (service_definition_version_id, display_order),
      foreign key (organization_id, service_definition_version_id) references service_definition_version(organization_id, id)
    );
    create table question_option (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id), question_id uuid not null,
      option_key varchar(100) not null, label text not null, display_order integer not null check (display_order >= 0),
      status varchar(20) not null default 'active' check (status in ('active','deprecated','archived')),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id, question_id, option_key), unique (question_id, display_order),
      foreign key (organization_id, question_id) references question(organization_id, id)
    );
    create index category_active_order_idx on category(organization_id, status, display_order);
    create index service_definition_category_idx on service_definition(organization_id, category_id, status);
    create index version_published_idx on service_definition_version(organization_id, service_definition_id, status);
    create index question_version_order_idx on question(organization_id, service_definition_version_id, display_order);
    create index option_question_order_idx on question_option(organization_id, question_id, display_order);
  `.execute(db);
  await sql`
    create function prevent_published_catalog_mutation() returns trigger language plpgsql as $$
    begin
      if old.status = 'published' then raise exception 'published service definition versions are immutable'; end if;
      return new;
    end $$;
    create trigger immutable_published_version before update or delete on service_definition_version
      for each row execute function prevent_published_catalog_mutation();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`drop table if exists question_option, question cascade`.execute(db);
  await sql`alter table if exists service_definition drop constraint if exists service_definition_published_version_fk`.execute(
    db,
  );
  await sql`drop table if exists service_definition_version, service_definition, category, division, department, organization cascade`.execute(
    db,
  );
  await sql`drop function if exists prevent_published_catalog_mutation()`.execute(
    db,
  );
}

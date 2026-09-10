import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table resident_alert (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      type varchar(30) not null check (type in ('notice','service_disruption','utility','closure','emergency')),
      severity varchar(20) not null check (severity in ('info','advisory','warning','critical')),
      title varchar(160) not null check (length(trim(title)) > 0 and title !~ '[<>]'),
      message varchar(4000) not null check (length(trim(message)) > 0 and message !~ '[<>]'),
      image_url varchar(2048) check (image_url is null or image_url ~ '^https://[^[:space:]]+$'),
      link_url varchar(2048) check (link_url is null or link_url ~ '^https://[^[:space:]]+$'),
      link_label varchar(100) check (link_label is null or (length(trim(link_label)) > 0 and link_label !~ '[<>]')),
      starts_at timestamptz not null,
      expires_at timestamptz check (expires_at is null or expires_at > starts_at),
      is_active boolean not null default false,
      published_at timestamptz,
      deactivated_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      created_by uuid, updated_by uuid, published_by uuid, deactivated_by uuid,
      check (link_label is null or link_url is not null),
      check (not is_active or (published_at is not null and deactivated_at is null)),
      foreign key (organization_id,created_by) references staff_identity(organization_id,id),
      foreign key (organization_id,updated_by) references staff_identity(organization_id,id),
      foreign key (organization_id,published_by) references staff_identity(organization_id,id),
      foreign key (organization_id,deactivated_by) references staff_identity(organization_id,id)
    );
    create index resident_alert_active_idx on resident_alert(organization_id, starts_at, expires_at) where is_active = true;
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await db.schema.dropTable('resident_alert').execute();
}

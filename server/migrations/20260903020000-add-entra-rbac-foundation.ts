import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table staff_identity add column entra_tenant_id uuid;
    alter table staff_identity add constraint staff_entra_identity_pair check ((entra_tenant_id is null) = (entra_object_id is null));
    alter table staff_identity drop constraint staff_identity_organization_id_entra_object_id_key;
    alter table staff_identity add constraint staff_entra_identity_unique unique (entra_tenant_id,entra_object_id);
    create table permission (permission_key varchar(100) primary key);
    create table role (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, name varchar(150) not null,
      description text, active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      unique (organization_id,id), unique (organization_id,name), foreign key (organization_id) references organization(id)
    );
    create table role_permission (
      organization_id uuid not null, role_id uuid not null, permission_key varchar(100) not null,
      primary key (role_id,permission_key), foreign key (organization_id,role_id) references role(organization_id,id),
      foreign key (permission_key) references permission(permission_key)
    );
    create table staff_role_assignment (
      organization_id uuid not null, staff_identity_id uuid not null, role_id uuid not null, active boolean not null default true,
      created_at timestamptz not null default now(), primary key (staff_identity_id,role_id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key (organization_id,role_id) references role(organization_id,id)
    );
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`drop table if exists staff_role_assignment, role_permission, role, permission cascade;
    alter table staff_identity drop constraint if exists staff_entra_identity_unique;
    alter table staff_identity drop constraint if exists staff_entra_identity_pair;
    alter table staff_identity drop column if exists entra_tenant_id;
    alter table staff_identity add constraint staff_identity_organization_id_entra_object_id_key unique (organization_id,entra_object_id);`.execute(
    db,
  );
}

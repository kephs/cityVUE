import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    insert into permission(permission_key) values ('admin.intake_settings.write');
    create table participation_collection_audit (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null references organization(id),
      staff_identity_id uuid not null,
      action varchar(64) not null check(action='service_participation_collection_changed'),
      prior_enabled boolean not null, enabled boolean not null,
      prior_revision integer not null check(prior_revision>0),
      revision integer not null check(revision>0),
      correlation_id uuid not null,
      occurred_at timestamptz not null default clock_timestamp(),
      check(prior_enabled<>enabled), check(revision::bigint=prior_revision::bigint+1),
      unique(organization_id,revision),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create function prevent_collection_audit_mutation() returns trigger language plpgsql as $$ begin
      raise exception 'Participation collection audit is immutable'; end $$;
    create trigger collection_audit_immutable before update or delete on participation_collection_audit
      for each row execute function prevent_collection_audit_mutation();
    create trigger collection_audit_no_truncate before truncate on participation_collection_audit
      for each statement execute function prevent_collection_audit_mutation();
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table participation_collection_audit,role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from participation_collection_audit)
        or exists(select 1 from role_permission where permission_key='admin.intake_settings.write')
      then raise exception 'Retained intake audit or grant prevents rollback'; end if;
    end $$;
    drop table participation_collection_audit;
    drop function prevent_collection_audit_mutation();
    delete from permission where permission_key='admin.intake_settings.write';
  `.execute(db);
}

import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table service_definition
      add column display_order integer not null default 0 check(display_order >= 0),
      add column core_revision integer not null default 1 check(core_revision > 0),
      add column current_display_name varchar(200);
    update service_definition i set current_display_name=v.name
      from service_definition_version v where v.organization_id=i.organization_id and v.id=i.current_published_version_id;
    create function issue_name_key(value text) returns text language sql immutable strict parallel safe as $$
      select lower(btrim(value, E' \t\n\r\f' || chr(11) || chr(160) || chr(5760) || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196) || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202) || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279)))
    $$;
    create unique index issue_current_name_unique on service_definition(organization_id,issue_name_key(current_display_name));
    create function maintain_issue_core() returns trigger language plpgsql as $$ begin
      select v.name into new.current_display_name from service_definition_version v
        where v.organization_id=new.organization_id and v.service_definition_id=new.id and v.id=new.current_published_version_id;
      if TG_OP='UPDATE' then
        if (new.status,new.display_order,new.current_published_version_id) is distinct from (old.status,old.display_order,old.current_published_version_id) then
          new.core_revision=old.core_revision+1;
          new.updated_at=clock_timestamp();
        else new.core_revision=old.core_revision; end if;
      end if;
      return new;
    end $$;
    create trigger issue_core_revision before insert or update on service_definition for each row execute function maintain_issue_core();
    insert into permission(permission_key) values ('admin.issues.write');
    create table issue_configuration_audit (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null references organization(id),
      issue_id uuid not null, staff_identity_id uuid not null,
      action text not null check(action in ('created','changed','activated','deactivated')),
      changed_fields text[] not null,
      prior_core_revision integer, core_revision integer not null,
      policy_revision integer not null, assignment_revision integer not null,
      correlation_id uuid not null, occurred_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,issue_id) references service_definition(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id)
    );
    create function protect_issue_configuration_audit() returns trigger language plpgsql as $$ begin
      raise exception 'Issue configuration audit is append-only'; end $$;
    create trigger issue_configuration_audit_immutable before update or delete on issue_configuration_audit
      for each row execute function protect_issue_configuration_audit();
    create trigger issue_configuration_audit_no_truncate before truncate on issue_configuration_audit
      for each statement execute function protect_issue_configuration_audit();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_definition,issue_configuration_audit,role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from issue_configuration_audit)
        or exists(select 1 from role_permission where permission_key='admin.issues.write')
        or exists(select 1 from service_definition where display_order<>0 or core_revision<>1)
        then raise exception 'Retained Issue configuration prevents rollback'; end if;
    end $$;
    drop table issue_configuration_audit;
    drop function protect_issue_configuration_audit();
    delete from permission where permission_key='admin.issues.write';
    drop trigger issue_core_revision on service_definition;
    drop function maintain_issue_core();
    drop index issue_current_name_unique;
    drop function issue_name_key(text);
    alter table service_definition drop column current_display_name,drop column core_revision,drop column display_order;
  `.execute(db);
}

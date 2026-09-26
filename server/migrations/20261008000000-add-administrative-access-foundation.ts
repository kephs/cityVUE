import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

// Frozen integrity policy. Runtime presentation/validation is code-defined;
// parity tests intentionally require a new migration for policy changes.
export const managedPermissionKeys = [
  'admin.configuration.read',
  'admin.issues.write',
  'admin.intake_settings.write',
  'admin.participation_areas.write',
  'analytics.service_participation.read',
  'catalog.issue_action.manage',
  'service_request.answers.read',
  'service_request.tracking.manage',
  'service_request.reference.manage',
  'service_request.view',
  'service_request.create',
  'service_request.create_internal',
  'service_request.internal.read',
  'service_request.internal.update',
  'service_request.contact.read',
  'service_request.note.read',
  'service_request.note.create',
  'service_request.communication.read',
  'service_request.communication.create',
  'service_request.assign',
  'service_request.route',
  'service_request.watchers.manage',
  'service_request.start_work',
  'service_request.hold',
  'service_request.resume',
  'service_request.close',
  'service_request.reopen',
] as const;

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization,staff_identity,role,role_permission,staff_role_assignment,
      staff_department_membership,staff_division_membership in access exclusive mode;
    insert into permission(permission_key) values ('admin.access.read'),('admin.access.manage');
    alter table role add column access_creation_txid bigint;
    create table organization_access_state (
      organization_id uuid primary key references organization(id),
      authorization_revision bigint not null default 0 check(authorization_revision>=0),
      bootstrap_established boolean not null default false,
      mutation_txid bigint,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );
    insert into organization_access_state(organization_id) select id from organization;
    create table access_role_ownership (
      organization_id uuid not null,
      staff_identity_id uuid not null,
      role_id uuid primary key,
      kind text not null check(kind in ('operational','administrator')),
      creation_txid bigint not null,
      created_at timestamptz not null default clock_timestamp(),
      unique(organization_id,staff_identity_id,kind),
      unique(organization_id,staff_identity_id,role_id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id),
      foreign key(organization_id,role_id) references role(organization_id,id)
    );
    create table access_change_set (
      id uuid primary key,
      organization_id uuid not null references organization(id),
      target_staff_id uuid not null,
      role_id uuid not null,
      actor_staff_id uuid,
      source text not null check(source in ('runtime','controlled_provisioning')),
      operation text not null check(operation in ('bootstrap_access_administration','provision_access_administrator','revoke_access_administrator','update_managed_access')),
      correlation_id uuid not null,
      before_revision bigint not null check(before_revision>=0),
      after_revision bigint not null check(after_revision=before_revision+1),
      mutation_txid bigint not null,
      created_at timestamptz not null default clock_timestamp(),
      unique(organization_id,mutation_txid),
      unique(organization_id,after_revision),
      foreign key(organization_id,target_staff_id,role_id) references access_role_ownership(organization_id,staff_identity_id,role_id),
      foreign key(organization_id,actor_staff_id) references staff_identity(organization_id,id),
      check((source='runtime' and actor_staff_id is not null and actor_staff_id<>target_staff_id and operation='update_managed_access')
        or (source='controlled_provisioning' and actor_staff_id is null and operation<>'update_managed_access'))
    );
    create index access_change_target_history on access_change_set(organization_id,target_staff_id,created_at desc,id);
    create table access_permission_delta (
      change_set_id uuid not null references access_change_set(id),
      permission_key varchar(100) not null references permission(permission_key),
      direction text not null check(direction in ('added','removed')),
      primary key(change_set_id,permission_key)
    );

    create function protect_access_history() returns trigger language plpgsql as $$ begin
      raise exception 'Access history and ownership are immutable';
    end $$;
    create trigger access_change_immutable before update or delete on access_change_set for each row execute function protect_access_history();
    create trigger access_change_no_truncate before truncate on access_change_set execute function protect_access_history();
    create trigger access_delta_immutable before update or delete on access_permission_delta for each row execute function protect_access_history();
    create trigger access_delta_no_truncate before truncate on access_permission_delta execute function protect_access_history();
    create trigger access_ownership_immutable before update or delete on access_role_ownership for each row execute function protect_access_history();
    create trigger access_ownership_no_truncate before truncate on access_role_ownership execute function protect_access_history();

    create function initialize_access_state() returns trigger language plpgsql as $$ begin
      insert into organization_access_state(organization_id) values(new.id); return new;
    end $$;
    create trigger organization_access_initialize after insert on organization for each row execute function initialize_access_state();

    create function advance_access_revision(org uuid) returns void language plpgsql as $$ begin
      if pg_trigger_depth()=0 then raise exception 'Authorization revision is database maintained'; end if;
      update organization_access_state set authorization_revision=authorization_revision+1,
        mutation_txid=txid_current(),updated_at=clock_timestamp()
        where organization_id=org and mutation_txid is distinct from txid_current();
      -- Even a second mutation in this transaction retains the serialization lock.
      perform 1 from organization_access_state where organization_id=org for update;
    end $$;
    create function protect_access_state() returns trigger language plpgsql as $$ begin
      if TG_OP='DELETE' then raise exception 'Access state cannot be removed'; end if;
      if TG_OP='INSERT' then
        if new.authorization_revision<>0 or new.bootstrap_established or new.mutation_txid is not null then
          raise exception 'Access state must start unbootstrapped'; end if;
        return new;
      end if;
      if new.organization_id<>old.organization_id then raise exception 'Access state Organization is immutable'; end if;
      if pg_trigger_depth()=1 and (new.authorization_revision,new.mutation_txid) is distinct from (old.authorization_revision,old.mutation_txid) then
        raise exception 'Authorization revision is database maintained'; end if;
      if old.bootstrap_established and not new.bootstrap_established then raise exception 'Bootstrap cannot be cleared'; end if;
      if new.bootstrap_established is distinct from old.bootstrap_established then
        if not exists(select 1 from access_change_set a where a.organization_id=new.organization_id
          and a.mutation_txid=txid_current() and a.operation='bootstrap_access_administration') then
          raise exception 'Bootstrap requires transaction audit'; end if;
        if old.mutation_txid is distinct from txid_current() then
          new.authorization_revision=old.authorization_revision+1; new.mutation_txid=txid_current();
        end if;
        new.updated_at=clock_timestamp();
      end if;
      return new;
    end $$;
    create trigger access_state_protect before insert or update or delete on organization_access_state for each row execute function protect_access_state();
    create trigger access_state_no_truncate before truncate on organization_access_state execute function protect_access_history();

    create function invalidate_access_revision() returns trigger language plpgsql as $$
    declare previous jsonb; current_value jsonb; org uuid; old_org uuid;
    begin
      if TG_OP<>'INSERT' then previous=to_jsonb(old); end if;
      if TG_OP<>'DELETE' then current_value=to_jsonb(new); end if;
      if TG_OP='UPDATE' then
        if TG_TABLE_NAME='organization' and current_value->'status' is not distinct from previous->'status' then return new; end if;
        if TG_TABLE_NAME='role' and (current_value->'organization_id',current_value->'id',current_value->'active') is not distinct from (previous->'organization_id',previous->'id',previous->'active') then return new; end if;
        if TG_TABLE_NAME='staff_identity' and
          (current_value->'organization_id',current_value->'id',current_value->'active',current_value->'entra_tenant_id',current_value->'entra_object_id') is not distinct from
          (previous->'organization_id',previous->'id',previous->'active',previous->'entra_tenant_id',previous->'entra_object_id') then return new; end if;
        if TG_TABLE_NAME not in ('organization','role','staff_identity') and
          (current_value-'updated_at'-'created_at') is not distinct from (previous-'updated_at'-'created_at') then return new; end if;
      end if;
      org=coalesce((current_value->>'organization_id')::uuid,(current_value->>'id')::uuid);
      old_org=coalesce((previous->>'organization_id')::uuid,(previous->>'id')::uuid);
      for org in select distinct v from unnest(array[org,old_org]) v where v is not null order by v loop
        perform advance_access_revision(org);
      end loop;
      return coalesce(new,old);
    end $$;
    create trigger access_organization_revision after update of status on organization for each row execute function invalidate_access_revision();
    create trigger access_staff_revision after insert or update or delete on staff_identity for each row execute function invalidate_access_revision();
    create trigger access_role_revision after insert or update or delete on role for each row execute function invalidate_access_revision();
    create trigger access_permission_revision after insert or update or delete on role_permission for each row execute function invalidate_access_revision();
    create trigger access_assignment_revision after insert or update or delete on staff_role_assignment for each row execute function invalidate_access_revision();
    create trigger access_department_revision after insert or update or delete on staff_department_membership for each row execute function invalidate_access_revision();
    create trigger access_division_revision after insert or update or delete on staff_division_membership for each row execute function invalidate_access_revision();

    create function effective_access_managers(org uuid) returns bigint language sql stable as $$
      select count(*) from (
        select s.id from staff_identity s
        join organization o on o.id=s.organization_id and o.status='active'
        join staff_role_assignment a on a.organization_id=s.organization_id and a.staff_identity_id=s.id and a.active
        join role r on r.organization_id=a.organization_id and r.id=a.role_id and r.active
        join role_permission p on p.organization_id=r.organization_id and p.role_id=r.id
        where s.organization_id=org and s.active and p.permission_key in
          ('admin.configuration.read','admin.access.read','admin.access.manage')
        group by s.id having count(distinct p.permission_key)=3
      ) managers;
    $$;
    create function verify_last_access_manager() returns trigger language plpgsql as $$ begin
      if exists(select 1 from organization_access_state s join organization o on o.id=s.organization_id
        where s.organization_id=new.organization_id and s.bootstrap_established and o.status='active')
        and effective_access_managers(new.organization_id)=0 then
        raise exception 'An active bootstrapped Organization must retain an Access Administrator'; end if;
      return null;
    end $$;
    create constraint trigger access_last_manager after update on organization_access_state
      deferrable initially deferred for each row execute function verify_last_access_manager();

    create function stamp_access_role_creation() returns trigger language plpgsql as $$ begin
      if TG_OP='INSERT' then new.access_creation_txid=txid_current();
      elsif new.access_creation_txid is distinct from old.access_creation_txid then raise exception 'Role creation provenance is immutable'; end if;
      if TG_OP='UPDATE' and exists(select 1 from access_role_ownership where role_id=old.id)
        and (new.id,new.organization_id,new.name,new.description,new.active) is distinct from
          (old.id,old.organization_id,old.name,old.description,old.active) then
        raise exception 'Owned role metadata is immutable'; end if;
      return new;
    end $$;
    create trigger access_role_creation before insert or update on role for each row execute function stamp_access_role_creation();
    create function validate_access_ownership() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from role r where r.id=new.role_id and r.organization_id=new.organization_id
        and r.access_creation_txid=txid_current() and r.description is null and r.active)
        or exists(select 1 from role_permission where role_id=new.role_id)
        or exists(select 1 from staff_role_assignment where role_id=new.role_id) then
        raise exception 'Ownership requires a fresh unassigned role without prior provenance'; end if;
      new.creation_txid=txid_current(); return new;
    end $$;
    create trigger access_ownership_validate before insert on access_role_ownership for each row execute function validate_access_ownership();

    create function validate_access_change() returns trigger language plpgsql as $$
    declare s organization_access_state%rowtype; owner_kind text;
    begin
      select * into s from organization_access_state where organization_id=new.organization_id for update;
      if not found or not ((s.authorization_revision=new.before_revision and s.mutation_txid is distinct from txid_current())
        or (s.authorization_revision=new.after_revision and s.mutation_txid=txid_current())) then
        raise exception 'Access audit revision mismatch'; end if;
      select kind into owner_kind from access_role_ownership where role_id=new.role_id;
      if (new.operation='update_managed_access') is distinct from (owner_kind='operational') then
        raise exception 'Access audit ownership mismatch'; end if;
      new.mutation_txid=txid_current(); return new;
    end $$;
    create trigger access_change_validate before insert on access_change_set for each row execute function validate_access_change();
    create function validate_access_delta() returns trigger language plpgsql as $$
    declare a access_change_set%rowtype; present boolean;
    begin
      select * into a from access_change_set where id=new.change_set_id;
      if a.mutation_txid is distinct from txid_current() then raise exception 'Access delta must belong to current transaction'; end if;
      select exists(select 1 from role_permission where role_id=a.role_id and permission_key=new.permission_key) into present;
      if present=(new.direction='added') then raise exception 'Access delta does not match prior contribution'; end if;
      return new;
    end $$;
    create trigger access_delta_validate before insert on access_permission_delta for each row execute function validate_access_delta();

    create function protect_owned_access() returns trigger language plpgsql as $$
    declare v record; owner access_role_ownership%rowtype; direction_value text;
    begin
      if TG_OP='DELETE' then v=old; direction_value='removed'; else v=new; direction_value='added'; end if;
      if TG_OP='UPDATE' and (to_jsonb(new)-'created_at') is not distinct from (to_jsonb(old)-'created_at') then return new; end if;
      if TG_OP='UPDATE' and exists(select 1 from access_role_ownership where role_id=old.role_id)
        and (new.organization_id,new.role_id) is distinct from (old.organization_id,old.role_id) then
        raise exception 'Owned access cannot move'; end if;
      select * into owner from access_role_ownership where role_id=v.role_id;
      if not found then return coalesce(new,old); end if;
      if TG_TABLE_NAME='role_permission' then
        if TG_OP='UPDATE' then raise exception 'Owned permissions require explicit delta'; end if;
        if owner.kind='operational' and not(v.permission_key=any(${sql.raw(`ARRAY[${managedPermissionKeys.map((key) => `'${key}'`).join(',')}]`)}::text[])) then
          raise exception 'Permission is not F057 manageable'; end if;
        if owner.kind='administrator' and v.permission_key not in ('admin.configuration.read','admin.access.read','admin.access.manage') then
          raise exception 'Permission is not an access prerequisite'; end if;
        if not exists(select 1 from access_change_set a join access_permission_delta d on d.change_set_id=a.id
          where a.organization_id=owner.organization_id and a.role_id=owner.role_id and a.mutation_txid=txid_current()
          and d.permission_key=v.permission_key and d.direction=direction_value) then
          raise exception 'Owned permission mutation requires transaction audit delta'; end if;
      else
        if v.staff_identity_id<>owner.staff_identity_id or (TG_OP='UPDATE' and old.staff_identity_id<>new.staff_identity_id) then
          raise exception 'Owned role cannot be shared'; end if;
        if not exists(select 1 from access_change_set a where a.role_id=owner.role_id and a.mutation_txid=txid_current()) then
          raise exception 'Owned assignment mutation requires transaction audit'; end if;
      end if;
      return coalesce(new,old);
    end $$;
    create trigger access_owned_permission before insert or update or delete on role_permission for each row execute function protect_owned_access();
    create trigger access_owned_assignment before insert or update or delete on staff_role_assignment for each row execute function protect_owned_access();

    create function verify_access_change() returns trigger language plpgsql as $$
    declare a access_change_set%rowtype;
    begin
      if TG_TABLE_NAME='access_role_ownership' then
        if not exists(select 1 from access_change_set where role_id=new.role_id and mutation_txid=txid_current()) then
          raise exception 'Ownership requires atomic audit'; end if; return null;
      end if;
      select * into a from access_change_set where id=new.id;
      if not exists(select 1 from organization_access_state where organization_id=a.organization_id
        and authorization_revision=a.after_revision and mutation_txid=a.mutation_txid) then raise exception 'Access audit transition incomplete'; end if;
      if exists(select 1 from access_permission_delta d where d.change_set_id=a.id and
        (d.direction='added') is distinct from exists(select 1 from role_permission p where p.role_id=a.role_id and p.permission_key=d.permission_key)) then
        raise exception 'Access audit delta incomplete'; end if;
      if a.operation='bootstrap_access_administration' and not exists(select 1 from organization_access_state
        where organization_id=a.organization_id and bootstrap_established) then raise exception 'Bootstrap incomplete'; end if;
      if not exists(select 1 from staff_role_assignment s where s.organization_id=a.organization_id
        and s.staff_identity_id=a.target_staff_id and s.role_id=a.role_id and s.active) then
        raise exception 'Owned assignment must be retained active'; end if;
      return null;
    end $$;
    create constraint trigger access_change_complete after insert on access_change_set deferrable initially deferred for each row execute function verify_access_change();
    create constraint trigger access_ownership_complete after insert on access_role_ownership deferrable initially deferred for each row execute function verify_access_change();
  `.execute(db);
  // TRUNCATE bypasses row triggers. Supported tooling never truncates authority tables.
  for (const table of [
    'role',
    'role_permission',
    'staff_role_assignment',
    'staff_identity',
    'staff_department_membership',
    'staff_division_membership',
    'organization',
  ]) {
    await sql`create trigger access_no_truncate before truncate on ${sql.table(table)} execute function protect_access_history()`.execute(
      db,
    );
  }
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization,staff_identity,role,role_permission,staff_role_assignment,
      staff_department_membership,staff_division_membership,organization_access_state,
      access_role_ownership,access_change_set,access_permission_delta in access exclusive mode;
    do $$ begin
      if exists(select 1 from access_role_ownership) or exists(select 1 from access_change_set)
        or exists(select 1 from organization_access_state where bootstrap_established)
        or exists(select 1 from role_permission where permission_key in ('admin.access.read','admin.access.manage')) then
        raise exception 'Retained governed access prevents rollback'; end if;
    end $$;
    drop table access_permission_delta,access_change_set,access_role_ownership,organization_access_state cascade;
    drop function initialize_access_state() cascade;
    drop function invalidate_access_revision() cascade;
    drop function advance_access_revision(uuid) cascade;
    drop function protect_access_state() cascade;
    drop function verify_last_access_manager() cascade;
    drop function effective_access_managers(uuid) cascade;
    drop function stamp_access_role_creation() cascade;
    drop function validate_access_ownership() cascade;
    drop function validate_access_change() cascade;
    drop function validate_access_delta() cascade;
    drop function protect_owned_access() cascade;
    drop function verify_access_change() cascade;
    drop function protect_access_history() cascade;
    alter table role drop column access_creation_txid;
    delete from permission where permission_key in ('admin.access.read','admin.access.manage');
  `.execute(db);
}

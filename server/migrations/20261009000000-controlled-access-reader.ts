import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table access_role_ownership drop constraint access_role_ownership_kind_check;
    alter table access_role_ownership add constraint access_role_ownership_kind_check check(kind in ('operational','administrator','reader'));
    alter table access_change_set drop constraint access_change_set_operation_check;
    alter table access_change_set add constraint access_change_set_operation_check check(operation in
      ('bootstrap_access_administration','provision_access_administrator','revoke_access_administrator','update_managed_access','provision_access_reader','revoke_access_reader'));
    create function validate_reader_access_change() returns trigger language plpgsql as $$
    declare reader_owned boolean;
    begin
      select kind='reader' into reader_owned from access_role_ownership where role_id=new.role_id;
      if (new.operation in ('provision_access_reader','revoke_access_reader')) is distinct from reader_owned then
        raise exception 'Reader audit ownership mismatch'; end if;
      return new;
    end $$;
    create trigger access_reader_change before insert on access_change_set for each row execute function validate_reader_access_change();
    create function validate_reader_access_delta() returns trigger language plpgsql as $$
    declare op text;
    begin
      select operation into op from access_change_set where id=new.change_set_id;
      if op in ('provision_access_reader','revoke_access_reader') and
        (new.permission_key<>'admin.access.read' or new.direction<>case when op='provision_access_reader' then 'added' else 'removed' end) then
        raise exception 'Reader delta must match read authority operation'; end if;
      return new;
    end $$;
    create trigger access_reader_delta before insert on access_permission_delta for each row execute function validate_reader_access_delta();
    create function protect_reader_permission() returns trigger language plpgsql as $$
    begin
      if exists(select 1 from access_role_ownership where role_id=new.role_id and kind='reader')
        and new.permission_key<>'admin.access.read' then raise exception 'Reader ownership permits only access read'; end if;
      return new;
    end $$;
    create trigger access_reader_permission before insert or update on role_permission for each row execute function protect_reader_permission();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table access_role_ownership,access_change_set,access_permission_delta,role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from access_role_ownership where kind='reader') or
        exists(select 1 from access_change_set where operation in ('provision_access_reader','revoke_access_reader')) then
        raise exception 'Retained Reader ownership or history prevents rollback'; end if;
    end $$;
    drop trigger access_reader_permission on role_permission;
    drop trigger access_reader_delta on access_permission_delta;
    drop trigger access_reader_change on access_change_set;
    drop function protect_reader_permission();
    drop function validate_reader_access_delta();
    drop function validate_reader_access_change();
    alter table access_role_ownership drop constraint access_role_ownership_kind_check;
    alter table access_role_ownership add constraint access_role_ownership_kind_check check(kind in ('operational','administrator'));
    alter table access_change_set drop constraint access_change_set_operation_check;
    alter table access_change_set add constraint access_change_set_operation_check check(operation in
      ('bootstrap_access_administration','provision_access_administrator','revoke_access_administrator','update_managed_access'));
  `.execute(db);
}

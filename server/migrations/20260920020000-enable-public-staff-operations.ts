import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table service_request drop constraint request_routing_check;
    alter table service_request add constraint request_routing_check check (
      (routed_department_id is null and routed_division_id is null)
      or (audience in ('public','internal') and routed_department_id is not null)
    );
    insert into permission(permission_key) values ('service_request.route'), ('service_request.watchers.manage');
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // Never restore catalog scope over routed PUBLIC records or remove live permission dependencies.
  await sql`
    lock table service_request, request_operational_activity, role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from service_request where audience='public' and routed_department_id is not null)
        or exists(select 1 from role_permission where permission_key in ('service_request.route','service_request.watchers.manage'))
        or exists(select 1 from request_operational_activity a join service_request r
          on r.organization_id=a.organization_id and r.id=a.service_request_id
          where r.audience='public' and a.activity_type in ('request_routed','watcher_added','watcher_removed'))
      then raise exception 'F040 rollback requires review of dependent PUBLIC operations and grants'; end if;
    end $$;
    delete from permission where permission_key in ('service_request.route','service_request.watchers.manage');
    alter table service_request drop constraint request_routing_check;
    alter table service_request add constraint request_routing_check check (
      (routed_department_id is null and routed_division_id is null)
      or (audience='internal' and routed_department_id is not null)
    );
  `.execute(db);
}

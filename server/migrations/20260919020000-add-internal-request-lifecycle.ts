import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    alter table service_request
      add column routed_department_id uuid,
      add column routed_division_id uuid,
      add constraint request_routing_department_fk foreign key (organization_id,routed_department_id) references department(organization_id,id),
      add constraint request_routing_division_fk foreign key (organization_id,routed_department_id,routed_division_id) references division(organization_id,department_id,id),
      add constraint request_routing_check check ((routed_department_id is null and routed_division_id is null) or (audience='internal' and routed_department_id is not null));
    insert into permission(permission_key) values ('service_request.internal.update');
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // Never silently restore catalog scope over routed confidential records.
  await sql`
    lock table service_request, activity, role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from service_request where routed_department_id is not null)
        or exists(select 1 from activity where metadata->>'policy'='F031')
        or exists(select 1 from role_permission where permission_key='service_request.internal.update')
      then raise exception 'F031 rollback requires approved removal of dependent routes, activity and grants'; end if;
    end $$;
    delete from permission where permission_key='service_request.internal.update';
    alter table service_request drop column routed_division_id, drop column routed_department_id;
  `.execute(db);
}

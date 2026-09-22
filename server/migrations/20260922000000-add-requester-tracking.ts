import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

const previousActions = [
  'service_request_created',
  'service_request_assigned',
  'service_request_reassigned',
  'service_request_unassigned',
  'work_started',
  'work_held',
  'work_resumed',
  'service_request_closed',
  'service_request_reopened',
  'watcher_added',
  'watcher_removed',
  'service_request_contact_viewed',
  'service_request_internal_note_created',
  'service_request_communication_created',
];
const trackingActions = [
  'requester_tracking_issued',
  'requester_tracking_rotated',
  'requester_tracking_revoked',
];
async function auditConstraint(db: Kysely<DatabaseSchema>, actions: string[]) {
  await sql`alter table activity drop constraint activity_activity_type_check`.execute(
    db,
  );
  await sql`alter table activity add constraint activity_activity_type_check check(activity_type in (${sql.join(actions.map((a) => sql.lit(a)))}))`.execute(
    db,
  );
}
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    insert into permission(permission_key) values ('service_request.tracking.manage');
    create table request_tracking_credential (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      service_request_id uuid not null,
      credential_digest text not null unique check(credential_digest ~ '^[0-9a-f]{64}$'),
      status text not null check(status in ('active','revoked')),
      created_by_staff_identity_id uuid not null,
      created_at timestamptz not null default clock_timestamp(),
      revoked_at timestamptz,
      foreign key (organization_id,service_request_id) references service_request(organization_id,id),
      foreign key (organization_id,created_by_staff_identity_id) references staff_identity(organization_id,id),
      check((status='active' and revoked_at is null) or (status='revoked' and revoked_at is not null))
    );
    create unique index request_tracking_one_active on request_tracking_credential(organization_id,service_request_id) where status='active';
    create index request_tracking_state on request_tracking_credential(organization_id,service_request_id,created_at desc,id desc);
    create function protect_request_tracking() returns trigger language plpgsql as $$
    begin
      if TG_OP='INSERT' then
        perform 1 from service_request where organization_id=NEW.organization_id and id=NEW.service_request_id and audience='public' for share;
        if not found then raise exception 'Tracking requires PUBLIC parent'; end if;
        return NEW;
      end if;
      if TG_OP='UPDATE' and OLD.status='active' and NEW.status='revoked' and NEW.revoked_at is not null
        and (to_jsonb(NEW)-'status'-'revoked_at')=(to_jsonb(OLD)-'status'-'revoked_at') then return NEW; end if;
      raise exception 'Tracking history is immutable except revocation';
    end $$;
    create trigger request_tracking_guard before insert or update or delete on request_tracking_credential for each row execute function protect_request_tracking();
    create trigger request_tracking_no_truncate before truncate on request_tracking_credential for each statement execute function protect_request_tracking();
  `.execute(db);
  await auditConstraint(db, [...previousActions, ...trackingActions]);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`lock table request_tracking_credential, activity, role_permission in access exclusive mode;
    do $$ begin
      if exists(select 1 from request_tracking_credential)
        or exists(select 1 from activity where activity_type in ('requester_tracking_issued','requester_tracking_rotated','requester_tracking_revoked'))
        or exists(select 1 from role_permission where permission_key='service_request.tracking.manage')
      then raise exception 'Tracking state, audit or grants prevent safe rollback'; end if;
    end $$;
    drop table request_tracking_credential;
    drop function protect_request_tracking();
    delete from permission where permission_key='service_request.tracking.manage';
  `.execute(db);
  await auditConstraint(db, previousActions);
}

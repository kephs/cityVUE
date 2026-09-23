import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { OwnershipTarget } from './ownership-targets.js';

/** Caller owns the request transaction and has locked/revalidated the target. */
export async function insertCurrentAssignment(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  requestId: string,
  target: OwnershipTarget,
  staffId: string | null,
) {
  await db
    .insertInto('service_request_assignment')
    .values({
      id: randomUUID(),
      organization_id: organizationId,
      service_request_id: requestId,
      assignment_type: target.type === 'staff' ? 'individual' : target.type,
      staff_identity_id: target.type === 'staff' ? target.id : null,
      operational_role_id: target.type === 'role' ? target.id : null,
      work_group_id: target.type === 'group' ? target.id : null,
      department_id: null,
      assigned_by_actor_type: staffId ? 'staff' : 'system',
      assigned_by_staff_identity_id: staffId,
      ended_at: null,
      reason: null,
    })
    .execute();
}

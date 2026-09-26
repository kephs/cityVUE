import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { permissions, type Permission } from './auth.types.js';

export function recognizedPermissions(keys: readonly string[]): Permission[] {
  const known = new Set<string>(permissions);
  return [
    ...new Set(keys.filter((key): key is Permission => known.has(key))),
  ].sort();
}

/** Shared by request authorization and transaction-bound access configuration. */
export async function effectivePermissions(
  db: Kysely<DatabaseSchema>,
  organizationId: string,
  staffId: string,
) {
  const rows = await db
    .selectFrom('staff_role_assignment as assignment')
    .innerJoin('role', 'role.id', 'assignment.role_id')
    .innerJoin('role_permission', 'role_permission.role_id', 'role.id')
    .select('role_permission.permission_key')
    .where('assignment.organization_id', '=', organizationId)
    .where('assignment.staff_identity_id', '=', staffId)
    .where('assignment.active', '=', true)
    .where('role.active', '=', true)
    .execute();
  return recognizedPermissions(rows.map((row) => row.permission_key));
}

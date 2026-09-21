import type { Kysely } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { staffRequestScope } from './staff-request-scope.js';

// Preserve F030/F031 names and their explicit INTERNAL-only route contracts.
export {
  assertStaffRequestPermission as assertInternalAccess,
  requestUuid as internalRequestUuid,
  requestDepartment as internalDepartment,
  requestDivision as internalDivision,
} from './staff-request-scope.js';

/** Caller must first authorize the operation-specific permission on guard-resolved access. */
export function internalRequestScope(
  db: Kysely<DatabaseSchema>,
  access: StaffAccess,
) {
  return staffRequestScope(db, access).where(
    'request.audience',
    '=',
    'internal',
  );
}

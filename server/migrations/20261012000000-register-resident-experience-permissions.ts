import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

// Registration only. No roles, assignments, grants, bundles or delegation changes.
export const residentPermissionKeys = [
  'resident_experience.write',
  'resident_experience.publish',
  'resident_experience.contact.manage',
] as const;

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await db
    .insertInto('permission')
    .values(
      residentPermissionKeys.map((permission_key) => ({ permission_key })),
    )
    .execute();
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`lock table permission, role_permission, access_permission_delta in access exclusive mode`.execute(
    db,
  );
  // Refuse retained contributions or audit; never cascade or delete a grant.
  const grants = await db
    .selectFrom('role_permission')
    .select('permission_key')
    .where('permission_key', 'in', residentPermissionKeys)
    .executeTakeFirst();
  const history = await db
    .selectFrom('access_permission_delta')
    .select('permission_key')
    .where('permission_key', 'in', residentPermissionKeys)
    .executeTakeFirst();
  if (grants || history)
    throw new Error(
      'Retained resident experience grants or history prevent rollback',
    );
  await db
    .deleteFrom('permission')
    .where('permission_key', 'in', residentPermissionKeys)
    .execute();
}

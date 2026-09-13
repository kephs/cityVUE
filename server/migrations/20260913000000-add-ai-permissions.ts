import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await db
    .insertInto('permission')
    .values([
      { permission_key: 'ai.workspace.access' },
      { permission_key: 'ai.administration.access' },
    ])
    .onConflict((oc) => oc.column('permission_key').doNothing())
    .execute();
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // Foreign keys deliberately prevent rollback while explicit grants still reference these keys.
  await db
    .deleteFrom('permission')
    .where('permission_key', 'in', [
      'ai.workspace.access',
      'ai.administration.access',
    ])
    .execute();
}

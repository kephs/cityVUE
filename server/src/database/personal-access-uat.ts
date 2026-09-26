import type { Kysely } from 'kysely';
import type { DatabaseSchema } from './database.types.js';

/** Operator selection only. Never imported by runtime HTTP authorization. */
export function personalAccessUatMode(env: NodeJS.ProcessEnv, reader: boolean) {
  const selected = reader
    ? env.F057_PERSONAL_READER_UAT === 'true'
    : env.F057_PERSONAL_MANAGER_UAT === 'true';
  if (!selected) return false;
  if (
    env.NODE_ENV !== 'development' ||
    env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    env.CITYVUE_ENABLE_EXTERNAL_IDENTITY !== 'true' ||
    !env.ENTRA_TENANT_ID ||
    env.F036_PERSONAL_ENTRA_TENANT_ID !== env.ENTRA_TENANT_ID ||
    (!reader &&
      (!env.F036_STAFF_ID ||
        env.F057_STAFF_ID !== env.F036_STAFF_ID ||
        !env.F036_ORGANIZATION_ID ||
        env.F057_ORGANIZATION_ID !== env.F036_ORGANIZATION_ID))
  )
    throw new Error('Explicit personal development selection required');
  return true;
}

export async function assertPersonalAccessTarget(
  db: Kysely<DatabaseSchema>,
  env: NodeJS.ProcessEnv,
) {
  const mapped = await db
    .selectFrom('staff_identity')
    .select('id')
    .where('id', '=', env.F057_STAFF_ID ?? '')
    .where('organization_id', '=', env.F057_ORGANIZATION_ID ?? '')
    .where('entra_tenant_id', '=', env.ENTRA_TENANT_ID ?? '')
    .where('entra_object_id', 'is not', null)
    .where('active', '=', true)
    .executeTakeFirst();
  if (!mapped) throw new Error('Existing personal identity required');
}

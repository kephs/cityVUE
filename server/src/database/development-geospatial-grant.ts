import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import { GEOSPATIAL_READ_PERMISSION } from '../auth/auth.types.js';
import type { EnvironmentVariables } from '../config/environment.js';
import type { DatabaseSchema } from './database.types.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const roleName = 'geospatial-reader';

export interface DevelopmentGeospatialGrant {
  tenantId: string;
  objectId: string;
  organizationId: string;
  grant: boolean;
}

export function developmentGeospatialGrantInput(
  environment: EnvironmentVariables,
  input: Record<string, string | undefined>,
): DevelopmentGeospatialGrant {
  if (
    environment.NODE_ENV !== 'development' ||
    environment.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    !environment.CITYVUE_ENABLE_EXTERNAL_IDENTITY ||
    !environment.ENTRA_TENANT_ID ||
    !environment.ENTRA_API_CLIENT_ID ||
    !environment.ENTRA_EXPECTED_AUDIENCE
  )
    throw new Error('Development identity provisioning is unavailable');
  const objectId = input.F027_ENTRA_OBJECT_ID;
  const organizationId = input.F027_ORGANIZATION_ID;
  const grant = input.F027_GRANT_GEOSPATIAL_READ;
  if (
    !objectId ||
    !uuid.test(objectId) ||
    !organizationId ||
    !uuid.test(organizationId) ||
    (grant !== 'true' && grant !== 'false')
  )
    throw new Error(
      'Explicit development identity, Organization and grant choice required',
    );
  return {
    tenantId: environment.ENTRA_TENANT_ID,
    objectId,
    organizationId,
    grant: grant === 'true',
  };
}

// Operator-invoked only; migration never grants this permission automatically.
export async function provisionDevelopmentGeospatialGrant(
  db: Kysely<DatabaseSchema>,
  input: DevelopmentGeospatialGrant,
): Promise<void> {
  await db.transaction().execute(async (trx) => {
    const organization = await trx
      .selectFrom('organization')
      .select('id')
      .where('id', '=', input.organizationId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!organization)
      throw new Error('Active development Organization required');
    const existing = await trx
      .selectFrom('staff_identity')
      .select(['id', 'organization_id', 'active'])
      .where('entra_tenant_id', '=', input.tenantId)
      .where('entra_object_id', '=', input.objectId)
      .executeTakeFirst();
    if (
      existing &&
      (!existing.active || existing.organization_id !== input.organizationId)
    )
      throw new Error('Identity is already assigned elsewhere or inactive');
    const staffId = existing?.id ?? randomUUID();
    if (!existing)
      await trx
        .insertInto('staff_identity')
        .values({
          id: staffId,
          organization_id: input.organizationId,
          entra_tenant_id: input.tenantId,
          entra_object_id: input.objectId,
          display_name: 'Development staff',
          email: null,
          active: true,
        })
        .execute();
    if (!input.grant) return;
    const permission = await trx
      .selectFrom('permission')
      .select('permission_key')
      .where('permission_key', '=', GEOSPATIAL_READ_PERMISSION)
      .executeTakeFirst();
    if (!permission) throw new Error('Apply F026 permission migration first');
    let role = await trx
      .selectFrom('role')
      .select(['id', 'active'])
      .where('organization_id', '=', input.organizationId)
      .where('name', '=', roleName)
      .executeTakeFirst();
    if (role) {
      if (!role.active) throw new Error('Development role is inactive');
      const keys = await trx
        .selectFrom('role_permission')
        .select('permission_key')
        .where('role_id', '=', role.id)
        .execute();
      if (
        keys.length !== 1 ||
        keys[0]?.permission_key !== GEOSPATIAL_READ_PERMISSION
      )
        throw new Error('Development role contains unexpected permissions');
    } else {
      const roleId = randomUUID();
      await trx
        .insertInto('role')
        .values({
          id: roleId,
          organization_id: input.organizationId,
          name: roleName,
          description: 'Explicit development-only geospatial read grant',
          active: true,
        })
        .execute();
      role = { id: roleId, active: true };
    }
    await trx
      .insertInto('role_permission')
      .values({
        organization_id: input.organizationId,
        role_id: role.id,
        permission_key: GEOSPATIAL_READ_PERMISSION,
      })
      .onConflict((oc) => oc.columns(['role_id', 'permission_key']).doNothing())
      .execute();
    await trx
      .insertInto('staff_role_assignment')
      .values({
        organization_id: input.organizationId,
        staff_identity_id: staffId,
        role_id: role.id,
        active: true,
      })
      .onConflict((oc) =>
        oc
          .columns(['staff_identity_id', 'role_id'])
          .doUpdateSet({ active: true }),
      )
      .execute();
  });
}

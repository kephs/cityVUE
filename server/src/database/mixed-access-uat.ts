import { type Kysely, sql } from 'kysely';
import type { DatabaseSchema } from './database.types.js';
import { lockAuthorizationWriter } from './authorization-writer-lock.js';
import {
  assertDevelopmentDatabaseUrl,
  developmentOrganization,
  developmentUuid,
} from './development-staff-input.js';
import { effectivePermissionContributions } from '../auth/effective-permissions.js';

/** Operator-only fixture manifest. Never imported by runtime authorization. */
export const mixedAccessFixture = {
  staffId: '90000000-0000-4000-8000-000000000002',
  roleId: '93000000-0000-4000-8000-000000000057',
  roleName: 'F057 Jordan mixed-source UAT fixture',
  permission: 'service_request.create',
  description: JSON.stringify({
    source: 'F057_MIXED_SOURCE_UAT',
    version: 1,
    target: '90000000-0000-4000-8000-000000000002',
    permission: 'service_request.create',
  }),
} as const;

export function mixedAccessEnvironment(env: NodeJS.ProcessEnv) {
  if (
    env.NODE_ENV !== 'development' ||
    env.CITYVUE_DEPLOYMENT_PROFILE !== 'development' ||
    env.F057_MIXED_SOURCE_UAT !== 'true' ||
    env.CITYVUE_ENABLE_EXTERNAL_IDENTITY !== 'true' ||
    !developmentUuid.test(env.ENTRA_TENANT_ID ?? '') ||
    env.F036_PERSONAL_ENTRA_TENANT_ID !== env.ENTRA_TENANT_ID ||
    !developmentUuid.test(env.F036_STAFF_ID ?? '') ||
    env.F036_ORGANIZATION_ID !== developmentOrganization.id
  )
    throw new Error(
      'Explicit approved personal development configuration required',
    );
  return assertDevelopmentDatabaseUrl(env.DATABASE_URL ?? '');
}

export interface MixedAccessInput {
  operation: 'add' | 'cleanup';
  staffId: string;
  permission: string;
  expectedRevision: string;
  dryRun: boolean;
}

export async function mixedAccessUat(
  db: Kysely<DatabaseSchema>,
  env: NodeJS.ProcessEnv,
  input: MixedAccessInput,
) {
  mixedAccessEnvironment(env);
  if (
    !['add', 'cleanup'].includes(input.operation) ||
    input.staffId !== mixedAccessFixture.staffId ||
    input.permission !== mixedAccessFixture.permission ||
    !/^(0|[1-9][0-9]*)$/.test(input.expectedRevision) ||
    typeof input.dryRun !== 'boolean'
  )
    throw new Error('Invalid explicit fixture selection');
  return db
    .transaction()
    .setIsolationLevel(input.dryRun ? 'repeatable read' : 'read committed')
    .execute(async (trx) => {
      if (input.dryRun) await sql`set transaction read only`.execute(trx);
      // Derive the Organization from the fixed target; validate it before any write.
      const initial = await trx
        .selectFrom('staff_identity')
        .select('organization_id')
        .where('id', '=', input.staffId)
        .executeTakeFirst();
      if (initial?.organization_id !== developmentOrganization.id)
        throw new Error('Approved synthetic Organization required');
      if (!input.dryRun)
        await lockAuthorizationWriter(trx, initial.organization_id);
      const org = await trx
        .selectFrom('organization')
        .selectAll()
        .where('id', '=', initial.organization_id)
        .executeTakeFirstOrThrow();
      const target = await trx
        .selectFrom('staff_identity')
        .selectAll()
        .where('id', '=', input.staffId)
        .executeTakeFirstOrThrow();
      if (
        org.name !== developmentOrganization.name ||
        org.slug !== developmentOrganization.slug ||
        org.status !== 'active' ||
        target.organization_id !== org.id ||
        !target.active ||
        target.entra_tenant_id !== null ||
        target.entra_object_id !== null ||
        target.display_name !== 'Jordan Example' ||
        target.email !== 'jordan@example.test'
      )
        throw new Error('Unchanged active synthetic Jordan fixture required');
      const operator = await trx
        .selectFrom('staff_identity')
        .select('id')
        .where('id', '=', env.F036_STAFF_ID ?? '')
        .where('organization_id', '=', org.id)
        .where('active', '=', true)
        .where('entra_tenant_id', '=', env.ENTRA_TENANT_ID ?? '')
        .where('entra_object_id', 'is not', null)
        .executeTakeFirst();
      if (!operator)
        throw new Error(
          'Existing approved personal development identity required',
        );
      const state = await trx
        .selectFrom('organization_access_state')
        .selectAll()
        .where('organization_id', '=', org.id)
        .executeTakeFirstOrThrow();
      if (state.authorization_revision !== input.expectedRevision)
        throw new Error('Access state changed; dry-run again');
      const candidates = await trx
        .selectFrom('role')
        .selectAll()
        .where((eb) =>
          eb.or([
            eb('id', '=', mixedAccessFixture.roleId),
            eb.and([
              eb('organization_id', '=', org.id),
              eb('name', '=', mixedAccessFixture.roleName),
            ]),
          ]),
        )
        .execute();
      const role = candidates[0];
      if (role) {
        const owned = await trx
          .selectFrom('access_role_ownership')
          .select('role_id')
          .where('role_id', '=', role.id)
          .execute();
        const assignments = await trx
          .selectFrom('staff_role_assignment')
          .selectAll()
          .where('role_id', '=', role.id)
          .execute();
        const permissions = await trx
          .selectFrom('role_permission')
          .selectAll()
          .where('role_id', '=', role.id)
          .execute();
        if (
          candidates.length !== 1 ||
          role.id !== mixedAccessFixture.roleId ||
          role.organization_id !== org.id ||
          role.name !== mixedAccessFixture.roleName ||
          role.description !== mixedAccessFixture.description ||
          !role.active ||
          role.access_creation_txid === null ||
          owned.length ||
          assignments.length !== 1 ||
          assignments[0]?.staff_identity_id !== target.id ||
          assignments[0].organization_id !== org.id ||
          !assignments[0].active ||
          permissions.length !== 1 ||
          permissions[0]?.permission_key !== input.permission ||
          permissions[0].organization_id !== org.id
        )
          throw new Error(
            'Fixture ownership mismatch; no adoption or repair permitted',
          );
      }
      const owned = await trx
        .selectFrom('access_role_ownership')
        .select('role_id')
        .where('organization_id', '=', org.id)
        .where('staff_identity_id', '=', target.id)
        .where('kind', '=', 'operational')
        .executeTakeFirst();
      const contributions = await effectivePermissionContributions(trx, org.id)
        .where('assignment.staff_identity_id', '=', target.id)
        .execute();
      const keys = (rows: typeof contributions) =>
        [...new Set(rows.map((r) => r.permission_key))].sort();
      const managed = keys(
        contributions.filter((r) => r.role_id === owned?.role_id),
      );
      const outside = keys(
        contributions.filter((r) => r.role_id !== owned?.role_id),
      );
      const blockedReason =
        input.operation === 'add' &&
        !role &&
        !managed.includes(input.permission)
          ? 'Jordan must first receive Create requests manually through Configure Access.'
          : null;
      const changed = input.operation === 'add' ? !role : Boolean(role);
      const report = {
        dryRun: input.dryRun,
        operation: input.operation,
        target: 'Jordan Example',
        targetReference: target.id,
        authorizationRevision: state.authorization_revision,
        effective: keys(contributions),
        managed,
        outside,
        fixtureRole: {
          id: mixedAccessFixture.roleId,
          name: mixedAccessFixture.roleName,
          provenance: mixedAccessFixture.description,
        },
        permission: input.permission,
        ready: !blockedReason,
        blockedReason,
        wouldChange: changed && !blockedReason,
        proposedAuthorizationRevision: blockedReason
          ? null
          : (
              BigInt(state.authorization_revision) + (changed ? 1n : 0n)
            ).toString(),
        mixedAfter:
          input.operation === 'add' &&
          !blockedReason &&
          managed.includes(input.permission),
        audit:
          'No F057 change set. Fixture role provenance and this operator report only.',
        provenanceCreated:
          !blockedReason && changed && input.operation === 'add',
      };
      if (input.dryRun) return report;
      if (blockedReason) throw new Error(blockedReason);
      if (!changed) return report;
      if (input.operation === 'add') {
        await trx
          .insertInto('role')
          .values({
            id: mixedAccessFixture.roleId,
            organization_id: org.id,
            name: mixedAccessFixture.roleName,
            description: mixedAccessFixture.description,
            active: true,
          })
          .execute();
        await trx
          .insertInto('role_permission')
          .values({
            organization_id: org.id,
            role_id: mixedAccessFixture.roleId,
            permission_key: mixedAccessFixture.permission,
          })
          .execute();
        await trx
          .insertInto('staff_role_assignment')
          .values({
            organization_id: org.id,
            staff_identity_id: target.id,
            role_id: mixedAccessFixture.roleId,
            active: true,
          })
          .execute();
      } else {
        await trx
          .deleteFrom('staff_role_assignment')
          .where('role_id', '=', mixedAccessFixture.roleId)
          .where('staff_identity_id', '=', target.id)
          .execute();
        await trx
          .deleteFrom('role_permission')
          .where('role_id', '=', mixedAccessFixture.roleId)
          .where('permission_key', '=', mixedAccessFixture.permission)
          .execute();
        await trx
          .deleteFrom('role')
          .where('id', '=', mixedAccessFixture.roleId)
          .execute();
      }
      const after = await trx
        .selectFrom('organization_access_state')
        .select('authorization_revision')
        .where('organization_id', '=', org.id)
        .executeTakeFirstOrThrow();
      if (after.authorization_revision !== report.proposedAuthorizationRevision)
        throw new Error('Unexpected fixture revision; transaction rolled back');
      return report;
    });
}

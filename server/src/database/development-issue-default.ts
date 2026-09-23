import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from './database.types.js';
import {
  developmentOrganization,
  developmentUuid,
} from './development-staff-input.js';
import {
  configureIssueDefault,
  type DefaultAssignmentInput,
} from '../service-request/issue-default-assignment.js';
import {
  eligibleTargets,
  targetCatalog,
  type OwnershipTarget,
} from '../service-request/ownership-targets.js';

/** CLI-only boundary. Never registered as a provider/controller or imported by runtime intake. */
export async function developmentIssueDefault(
  db: Kysely<DatabaseSchema>,
  selection: {
    organizationId: string;
    tenantId: string;
    staffId: string;
    issueId: string;
    input?: DefaultAssignmentInput;
  },
  dryRun: boolean,
) {
  if (
    selection.organizationId !== developmentOrganization.id ||
    !developmentUuid.test(selection.staffId) ||
    !developmentUuid.test(selection.issueId) ||
    !developmentUuid.test(selection.tenantId)
  )
    throw new Error('Invalid explicit development selection');
  return db.transaction().execute(async (trx) => {
    if (dryRun || !selection.input)
      await sql`set transaction read only`.execute(trx);
    const org = await trx
      .selectFrom('organization')
      .select(['name', 'slug', 'status'])
      .where('id', '=', selection.organizationId)
      .executeTakeFirst();
    if (
      org?.name !== developmentOrganization.name ||
      org.slug !== developmentOrganization.slug ||
      org.status !== 'active'
    )
      throw new Error('Fictional development Organization required');
    const staff = await trx
      .selectFrom('staff_identity')
      .select('id')
      .where('organization_id', '=', selection.organizationId)
      .where('id', '=', selection.staffId)
      .where('entra_tenant_id', '=', selection.tenantId)
      .where('entra_object_id', 'is not', null)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!staff) throw new Error('Existing mapped personal principal required');
    const issue = await trx
      .selectFrom('service_definition as issue')
      .innerJoin('category', (j) =>
        j
          .onRef('category.organization_id', '=', 'issue.organization_id')
          .onRef('category.id', '=', 'issue.category_id'),
      )
      .select(['issue.id', 'category.department_id', 'category.division_id'])
      .where('issue.organization_id', '=', selection.organizationId)
      .where('issue.id', '=', selection.issueId)
      .executeTakeFirst();
    if (!issue) throw new Error('Development Issue unavailable');
    const member = await trx
      .selectFrom('staff_department_membership')
      .select('staff_identity_id')
      .where('organization_id', '=', selection.organizationId)
      .where('staff_identity_id', '=', selection.staffId)
      .where('department_id', '=', issue.department_id)
      .where('active', '=', true)
      .executeTakeFirst();
    const division =
      !issue.division_id ||
      (await trx
        .selectFrom('staff_division_membership')
        .select('staff_identity_id')
        .where('organization_id', '=', selection.organizationId)
        .where('staff_identity_id', '=', selection.staffId)
        .where('department_id', '=', issue.department_id)
        .where('division_id', '=', issue.division_id)
        .where('active', '=', true)
        .executeTakeFirst());
    if (!member || !division)
      throw new Error('Existing explicit development scope required');
    if (selection.input)
      return configureIssueDefault(
        trx,
        selection.organizationId,
        selection.issueId,
        selection.staffId,
        selection.input,
        dryRun,
      );
    const config = await trx
      .selectFrom('issue_default_assignment')
      .selectAll()
      .where('organization_id', '=', selection.organizationId)
      .where('service_definition_id', '=', selection.issueId)
      .executeTakeFirst();
    if (!config?.target_type)
      return { revision: config?.revision ?? 0, state: 'none', target: null };
    const id =
      config.staff_identity_id ??
      config.operational_role_id ??
      config.work_group_id;
    const target = (
      await sql<OwnershipTarget>`select t.type,t.id,t.name as "displayName",t.active from ${targetCatalog(selection.organizationId)} t where t.type=${config.target_type} and t.id=${id}`.execute(
        trx,
      )
    ).rows[0];
    const eligibleAudiences = [];
    for (const audience of ['public', 'internal'] as const)
      if (
        id &&
        (
          await eligibleTargets(
            trx,
            selection.organizationId,
            issue.department_id,
            issue.division_id,
            config.target_type,
            '',
            id,
            audience,
          )
        ).length
      )
        eligibleAudiences.push(audience);
    return {
      revision: config.revision,
      state: eligibleAudiences.length ? 'configured' : 'target_unavailable',
      target: target ?? null,
      eligibleAudiences,
    };
  });
}

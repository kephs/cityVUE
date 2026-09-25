import {
  lockCreationCategory,
  findCreationCategories,
  categoryHandlingCapability,
} from './admin-issue-creation.domain.js';
import { isDeepStrictEqual } from 'node:util';
import {
  actionScope,
  configureIssueAction,
} from '../catalog/issue-action.command.js';
import { validateActiveIssue } from '../catalog/issue-activation.js';
import {
  loadQuestions,
  validateQuestions,
  insertQuestions,
  type QuestionConfiguration,
} from './admin-question.domain.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from './admin-configuration.domain.js';
import {
  assertIssueWrite,
  issueText,
  validateIssue,
  type IssueCreate,
  type IssueChange,
} from './admin-issue.domain.js';
import {
  configureRequesterPolicy,
  effectiveRequesterPolicy,
} from '../service-request/requester-identity-policy.js';
import {
  configureIssueDefault,
  validateIssueDefaultTarget,
} from '../service-request/issue-default-assignment.js';
import {
  eligibleTargets,
  targetCatalog,
  targetTypes,
  validateTargetSearch,
  type OwnershipTarget,
} from '../service-request/ownership-targets.js';
import { requestUuid } from '../service-request/staff-request-scope.js';

type Tx = Transaction<DatabaseSchema>;
export interface IssueProjection {
  availability: string;
  actionType: string;
  questions?: QuestionConfiguration[];
  catalogVersionId?: string | null;
  id: string;
  name: string;
  description: string;
  active: boolean;
  category: string;
  displayOrder: number;
  coreRevision: number;
  actionRevision: number;
  policyRevision: number;
  assignmentRevision: number;
  requesterPolicy: string;
  templateEligible: boolean;
  defaultAssignment: { type: string; id: string; displayName: string } | null;
}
const conflict = () =>
  new ConflictException(
    'This Issue changed since you opened it. Refresh the latest configuration before making another change.',
  );

@Injectable()
export class AdminIssueService {
  constructor(private readonly database: DatabaseService) {}
  private projection(org: string) {
    return sql`
    select i.id,i.availability,i.action_type as "actionType",coalesce(v.name,'Unpublished Issue') as name,coalesce(v.resident_description,'') as description,
      (i.status='active') as active,c.name as category,c.display_order as category_order,c.id as category_id,
      i.display_order as "displayOrder",i.core_revision as "coreRevision",i.action_revision as "actionRevision",
      coalesce(p.revision,0) as "policyRevision",coalesce(a.revision,0) as "assignmentRevision",
      ${effectiveRequesterPolicy(sql`${org}`, sql`i.id`)} as "requesterPolicy",
      (i.status='active' and c.status='active' and d.status='active' and (c.division_id is null or dv.status='active') and i.action_type='internal_intake' and v.status='published') is true as "templateEligible",
      case when a.target_type is null then null else json_build_object('type',a.target_type,'id',coalesce(a.staff_identity_id,a.operational_role_id,a.work_group_id),'displayName',coalesce(t.name,'Configured target unavailable')) end as "defaultAssignment"
    from service_definition i join category c on c.organization_id=i.organization_id and c.id=i.category_id
      join department d on d.organization_id=c.organization_id and d.id=c.department_id
      left join division dv on dv.organization_id=c.organization_id and dv.id=c.division_id
      left join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
      left join issue_requester_identity_policy p on p.organization_id=i.organization_id and p.service_definition_id=i.id
      left join issue_default_assignment a on a.organization_id=i.organization_id and a.service_definition_id=i.id
      left join ${targetCatalog(org)} t on t.type=a.target_type and t.id=coalesce(a.staff_identity_id,a.operational_role_id,a.work_group_id)
    where i.organization_id=${org}`;
  }
  private async org(trx: Tx, org: string) {
    if (
      !(await trx
        .selectFrom('organization')
        .select('id')
        .where('id', '=', org)
        .where('status', '=', 'active')
        .forShare()
        .executeTakeFirst())
    )
      throw new ForbiddenException('Access denied');
  }
  private async readOne(trx: Tx, org: string, id: string) {
    const row = (
      await sql<IssueProjection>`select id,availability,"actionType",name,description,active,category,"displayOrder","coreRevision","actionRevision","policyRevision","assignmentRevision","requesterPolicy","templateEligible","defaultAssignment" from (${this.projection(org)}) x where id=${id}`.execute(
        trx,
      )
    ).rows[0];
    if (!row) throw new NotFoundException('Issue unavailable');
    const stable = await trx
      .selectFrom('service_definition')
      .select('current_published_version_id')
      .where('organization_id', '=', org)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return {
      ...row,
      catalogVersionId: stable.current_published_version_id,
      questions: stable.current_published_version_id
        ? await loadQuestions(trx, org, stable.current_published_version_id)
        : [],
    };
  }
  async detail(access: StaffAccess | undefined, id: string) {
    assertConfigurationRead(access);
    if (!requestUuid.test(id)) throw new NotFoundException('Issue unavailable');
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        const issue = await this.readOne(trx, access.organizationId, id);
        const action = access.permissions.includes(
          'catalog.issue_action.manage',
        )
          ? await actionScope(trx, id, access)
              .select([
                'service.action_type',
                'service.redirect_url',
                'service.redirect_message',
                'service.redirect_label',
              ])
              .executeTakeFirst()
          : undefined;
        return {
          issue: {
            ...issue,
            ...(action
              ? {
                  handling: {
                    actionType: action.action_type,
                    ...(action.action_type === 'external_redirect'
                      ? {
                          redirect: {
                            destination: action.redirect_url ?? '',
                            message: action.redirect_message ?? '',
                            label: action.redirect_label ?? '',
                          },
                        }
                      : {}),
                  },
                }
              : {}),
            canManageHandling:
              !!action && access.permissions.includes('admin.issues.write'),
          },
        };
      });
  }
  async list(access: StaffAccess | undefined, page = 1) {
    assertConfigurationRead(access);
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        const org = access.organizationId;
        const counts = (
          await sql<{
            total: number;
            active: number;
          }>`select count(*)::int as total,count(*) filter(where status='active')::int as active from service_definition where organization_id=${org}`.execute(
            trx,
          )
        ).rows[0];
        if (!counts) throw new Error('Issue counts unavailable');
        const items = (
          await sql<IssueProjection>`select id,name,description,active,category,"displayOrder","coreRevision","actionRevision","policyRevision","assignmentRevision","requesterPolicy","templateEligible","defaultAssignment" from (${this.projection(org)}) x order by category_order,category,category_id,"displayOrder",name,id limit 25 offset ${(page - 1) * 25}`.execute(
            trx,
          )
        ).rows;
        return {
          ...counts,
          page,
          pageSize: 25,
          items,
          canWrite: access.permissions.includes('admin.issues.write'),
        };
      });
  }
  async targets(access: StaffAccess | undefined, id: string, search = '') {
    assertIssueWrite(access);
    if (!requestUuid.test(id)) throw new NotFoundException('Issue unavailable');
    validateTargetSearch(search);
    return this.database.client.transaction().execute(async (trx) => {
      await sql`set transaction read only`.execute(trx);
      const issue = await trx
        .selectFrom('service_definition as i')
        .innerJoin('category as c', (j) =>
          j
            .onRef('c.id', '=', 'i.category_id')
            .onRef('c.organization_id', '=', 'i.organization_id'),
        )
        .select(['c.department_id', 'c.division_id'])
        .where('i.organization_id', '=', access.organizationId)
        .where('i.id', '=', id)
        .executeTakeFirst();
      if (!issue) throw new NotFoundException('Issue unavailable');
      const found = new Map<string, OwnershipTarget>();
      for (const type of targetTypes)
        for (const audience of ['public', 'internal'] as const)
          for (const target of await eligibleTargets(
            trx,
            access.organizationId,
            issue.department_id,
            issue.division_id,
            type,
            search,
            undefined,
            audience,
          ))
            found.set(`${type}:${target.id}`, target);
      return { items: [...found.values()] };
    });
  }
  async creationCategories(access: StaffAccess | undefined, search = '') {
    assertIssueWrite(access);
    return findCreationCategories(this.database.client, access, search);
  }
  async creationTargets(
    access: StaffAccess | undefined,
    categoryId: string | undefined,
    search = '',
  ) {
    assertIssueWrite(access);
    validateTargetSearch(search);
    return this.database.client.transaction().execute(async (trx) => {
      await this.org(trx, access.organizationId);
      const category = await lockCreationCategory(
        trx,
        access.organizationId,
        categoryId,
      );
      const found = new Map<string, OwnershipTarget>();
      for (const type of targetTypes)
        for (const audience of ['public', 'internal'] as const)
          for (const target of await eligibleTargets(
            trx,
            access.organizationId,
            category.department_id,
            category.division_id,
            type,
            search,
            undefined,
            audience,
          ))
            found.set(`${type}:${target.id}`, target);
      return { items: [...found.values()] };
    });
  }
  private async creationSnapshot(
    trx: Tx,
    org: string,
    categoryId: string,
    id: string,
  ) {
    if (!requestUuid.test(id))
      throw new BadRequestException({ code: 'ISSUE_SOURCE_UNAVAILABLE' });
    const source = await trx
      .selectFrom('service_definition')
      .selectAll()
      .where('organization_id', '=', org)
      .where('category_id', '=', categoryId)
      .where('id', '=', id)
      .where('status', '=', 'active')
      .where('action_type', '=', 'internal_intake')
      .forShare()
      .executeTakeFirst();
    if (!source?.current_published_version_id)
      throw new BadRequestException({ code: 'ISSUE_SOURCE_UNAVAILABLE' });
    const version = await trx
      .selectFrom('service_definition_version')
      .selectAll()
      .where('organization_id', '=', org)
      .where('service_definition_id', '=', id)
      .where('id', '=', source.current_published_version_id)
      .where('status', '=', 'published')
      .executeTakeFirst();
    if (!version)
      throw new BadRequestException({ code: 'ISSUE_SOURCE_UNAVAILABLE' });
    const questions = await loadQuestions(trx, org, version.id);
    return { source, version, questions };
  }
  async creationSources(
    access: StaffAccess | undefined,
    categoryId: string | undefined,
    search = '',
  ) {
    assertIssueWrite(access);
    const term = validateTargetSearch(search);
    return this.database.client.transaction().execute(async (trx) => {
      await this.org(trx, access.organizationId);
      const category = await lockCreationCategory(
        trx,
        access.organizationId,
        categoryId,
      );
      const { rows } = await sql<{
        id: string;
        name: string;
        category: string;
      }>`
        select i.id,v.name,c.name as category from service_definition i
        join category c on c.organization_id=i.organization_id and c.id=i.category_id
        join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
        where i.organization_id=${access.organizationId} and i.category_id=${category.id}
        and i.status='active' and i.action_type='internal_intake' and v.status='published'
        and (strpos(lower(v.name),lower(${term}))>0 or strpos(lower(c.name),lower(${term}))>0)
        order by v.name,i.id limit 26`.execute(trx);
      return { items: rows.slice(0, 25), hasMore: rows.length > 25 };
    });
  }
  async creationSource(
    access: StaffAccess | undefined,
    categoryId: string | undefined,
    id: string,
  ) {
    assertIssueWrite(access);
    return this.database.client.transaction().execute(async (trx) => {
      await this.org(trx, access.organizationId);
      const category = await lockCreationCategory(
        trx,
        access.organizationId,
        categoryId,
      );
      const { version, questions } = await this.creationSnapshot(
        trx,
        access.organizationId,
        category.id,
        id,
      );
      return {
        source: {
          id,
          name: version.name,
          category: category.name,
          catalogVersionId: version.id,
          defaultPriority: version.default_priority,
          locationPolicy: version.location_policy,
          geographicEligibilityMode: version.geographic_eligibility_mode,
          questions,
          supportedGeography:
            version.geographic_eligibility_mode ===
              'no_geographic_restriction' &&
            version.geographic_eligibility_policy_reference === null,
        },
      };
    });
  }
  private async publish(
    trx: Tx,
    org: string,
    issue: string,
    source: string,
    name: string,
    description: string,
    newPolicy: string | null = null,
    questions?: QuestionConfiguration[],
  ) {
    const version = randomUUID();
    // Explicit copy allowlist. New version/form identities; no ownership, history or action configuration.
    await sql`insert into service_definition_version(id,organization_id,service_definition_id,version_number,name,resident_description,icon_key,aliases,keywords,default_priority,location_policy,geographic_eligibility_mode,geographic_eligibility_policy_reference,unable_to_determine_behavior,anonymous_reporting_policy,status,published_at,routing_metadata)
      select ${version},${org},${issue},(select coalesce(max(version_number),0)+1 from service_definition_version where organization_id=${org} and service_definition_id=${issue}),${name},${description},icon_key,
      case when ${newPolicy}::text is null then aliases else '{}'::text[] end,
      case when ${newPolicy}::text is null then keywords else '{}'::text[] end,
      default_priority,location_policy,geographic_eligibility_mode,geographic_eligibility_policy_reference,unable_to_determine_behavior,
      case when ${newPolicy}::text is null then anonymous_reporting_policy when ${newPolicy}='ANONYMOUS_ALLOWED' then 'allowed' else 'not_allowed' end,
      'draft',null,case when ${newPolicy}::text is null then routing_metadata else null end
      from service_definition_version where organization_id=${org} and id=${source} and status='published'`.execute(
      trx,
    );
    if (questions) await insertQuestions(trx, org, version, questions);
    else {
      await sql`insert into question(id,organization_id,service_definition_version_id,question_key,label,help_text,question_type,is_required,display_order,validation_metadata,visibility_condition,status)
      select gen_random_uuid(),organization_id,${version},question_key,label,help_text,question_type,is_required,display_order,validation_metadata,visibility_condition,status from question where organization_id=${org} and service_definition_version_id=${source}`.execute(
        trx,
      );
      await sql`insert into question_option(id,organization_id,question_id,option_key,label,display_order,status)
      select gen_random_uuid(),o.organization_id,n.id,o.option_key,o.label,o.display_order,o.status from question_option o
      join question old on old.organization_id=o.organization_id and old.id=o.question_id
      join question n on n.organization_id=old.organization_id and n.question_key=old.question_key and n.service_definition_version_id=${version}
      where old.organization_id=${org} and old.service_definition_version_id=${source}`.execute(
        trx,
      );
    }
    await trx
      .updateTable('service_definition_version')
      .set({ status: 'published', published_at: new Date() })
      .where('id', '=', version)
      .execute();
    return version;
  }
  private async audit(
    trx: Tx,
    access: StaffAccess,
    id: string,
    old: IssueProjection | null,
    next: IssueProjection,
    fields: string[],
    correlation?: string,
  ) {
    const action = !old
      ? 'created'
      : old.active !== next.active
        ? next.active
          ? 'activated'
          : 'deactivated'
        : 'changed';
    const schemaSummary = fields.includes('questions')
      ? {
          priorVersion: old?.catalogVersionId ?? null,
          version: next.catalogVersionId,
          priorQuestions: old?.questions?.length ?? 0,
          questions: next.questions?.length ?? 0,
          priorOptions:
            old?.questions?.reduce((n, q) => n + q.options.length, 0) ?? 0,
          options:
            next.questions?.reduce((n, q) => n + q.options.length, 0) ?? 0,
        }
      : null;
    await sql`insert into issue_configuration_audit(organization_id,issue_id,staff_identity_id,action,changed_fields,prior_core_revision,core_revision,policy_revision,assignment_revision,correlation_id,availability${schemaSummary ? sql`,schema_summary` : sql``})
      values(${access.organizationId},${id},${access.staffIdentityId},${action},${fields},${old?.coreRevision ?? null},${next.coreRevision},${next.policyRevision},${next.assignmentRevision},${correlation && requestUuid.test(correlation) ? correlation : randomUUID()},${old ? null : next.availability}${schemaSummary ? sql`,${JSON.stringify(schemaSummary)}::jsonb` : sql``})`.execute(
      trx,
    );
  }
  private duplicate(error: unknown): never {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === '23505' &&
      'constraint' in error &&
      error.constraint === 'issue_current_name_unique'
    )
      throw new BadRequestException({
        code: 'ISSUE_DUPLICATE',
        error: 'Bad Request',
      });
    throw error;
  }
  async create(
    access: StaffAccess | undefined,
    input: IssueCreate,
    correlation?: string,
  ) {
    assertIssueWrite(access);
    validateIssue(input, true);
    try {
      return await this.database.client.transaction().execute(async (trx) => {
        const org = access.organizationId;
        await this.org(trx, org);
        const category = await lockCreationCategory(trx, org, input.categoryId);
        const copied = input.templateId
          ? await this.creationSnapshot(trx, org, category.id, input.templateId)
          : null;
        if (copied && copied.version.id !== input.expectedSourceVersion)
          throw new ConflictException({ code: 'ISSUE_SOURCE_STALE' });
        const questions = validateQuestions(
          input.questions,
          copied?.questions ?? [],
        );
        if (
          input.handling.actionType === 'external_redirect' &&
          !categoryHandlingCapability(access, category)
        )
          throw new ForbiddenException('Access denied');
        await validateIssueDefaultTarget(
          trx,
          org,
          category.department_id,
          category.division_id,
          input.defaultAssignment,
        );
        const name = issueText(input.name, true),
          description = issueText(input.description, false);
        const duplicate =
          await sql`select id from service_definition where organization_id=${org} and issue_name_key(current_display_name)=issue_name_key(${name}) limit 1`.execute(
            trx,
          );
        if (duplicate.rows.length)
          throw new BadRequestException({ code: 'ISSUE_DUPLICATE' });
        const id = randomUUID();
        await trx
          .insertInto('service_definition')
          .values({
            id,
            organization_id: org,
            category_id: category.id,
            service_key: `issue-${id}`,
            availability: input.availability,
            status: 'inactive',
            current_published_version_id: null,
            display_order: input.displayOrder,
          })
          .execute();
        const version = randomUUID();
        await trx
          .insertInto('service_definition_version')
          .values({
            id: version,
            organization_id: org,
            service_definition_id: id,
            version_number: 1,
            name,
            resident_description: description,
            icon_key: copied?.version.icon_key ?? 'file-earmark-text',
            aliases: [],
            keywords: [],
            default_priority: input.defaultPriority,
            location_policy: input.locationPolicy,
            geographic_eligibility_mode: input.geographicEligibilityMode,
            geographic_eligibility_policy_reference: null,
            unable_to_determine_behavior: 'block',
            anonymous_reporting_policy:
              input.requesterPolicy === 'ANONYMOUS_ALLOWED'
                ? 'allowed'
                : 'not_allowed',
            routing_metadata: null,
            status: 'draft',
            published_at: null,
          })
          .execute();
        await insertQuestions(trx, org, version, questions);
        await trx
          .updateTable('service_definition_version')
          .set({ status: 'published', published_at: new Date() })
          .where('organization_id', '=', org)
          .where('id', '=', version)
          .execute();
        await trx
          .updateTable('service_definition')
          .set({ current_published_version_id: version })
          .where('organization_id', '=', org)
          .where('id', '=', id)
          .execute();
        await configureRequesterPolicy(
          trx,
          org,
          id,
          access.staffIdentityId,
          { policy: input.requesterPolicy, expectedRevision: 0 },
          false,
          true,
        );
        await configureIssueDefault(
          trx,
          org,
          id,
          access.staffIdentityId,
          { target: input.defaultAssignment, expectedRevision: 0 },
          false,
          true,
        );
        if (input.handling.actionType === 'external_redirect')
          await configureIssueAction(
            trx,
            id,
            { ...input.handling, expectedRevision: 1 },
            access,
            correlation,
          );
        const issue = await this.readOne(trx, org, id);
        await this.audit(
          trx,
          access,
          id,
          null,
          issue,
          ['created'],
          correlation,
        );
        return { issue, changed: true };
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
  async change(
    access: StaffAccess | undefined,
    id: string,
    input: IssueChange,
    correlation?: string,
  ) {
    assertIssueWrite(access);
    validateIssue(input, false);
    if (!requestUuid.test(id)) throw new NotFoundException('Issue unavailable');
    try {
      return await this.database.client.transaction().execute(async (trx) => {
        const org = access.organizationId;
        await this.org(trx, org);
        const stable = await trx
          .selectFrom('service_definition')
          .selectAll()
          .where('organization_id', '=', org)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (
          !stable?.current_published_version_id ||
          !['active', 'inactive'].includes(stable.status)
        )
          throw new NotFoundException('Issue unavailable');
        const old = await this.readOne(trx, org, id);
        if (
          old.coreRevision !== input.expectedCoreRevision ||
          old.actionRevision !== input.expectedActionRevision ||
          old.policyRevision !== input.expectedPolicyRevision ||
          old.assignmentRevision !== input.expectedAssignmentRevision
        )
          throw conflict();
        const saveHandling = async () =>
          input.handling === undefined
            ? null
            : await configureIssueAction(
                trx,
                id,
                {
                  ...input.handling,
                  expectedRevision: input.expectedActionRevision,
                },
                access,
                correlation,
              );
        const name = issueText(input.name, true),
          description = issueText(input.description, false),
          fields: string[] = [];
        const questions =
          input.questions === undefined
            ? old.questions
            : validateQuestions(input.questions, old.questions);
        if (!isDeepStrictEqual(questions, old.questions))
          fields.push('questions');
        if (name !== old.name) fields.push('name');
        if (description !== old.description) fields.push('description');
        if (input.displayOrder !== old.displayOrder)
          fields.push('displayOrder');
        if (input.active !== old.active) fields.push('active');
        const policy = await configureRequesterPolicy(
          trx,
          org,
          id,
          access.staffIdentityId,
          {
            policy: input.requesterPolicy,
            expectedRevision: input.expectedPolicyRevision,
          },
          false,
          true,
        );
        const assignment = await configureIssueDefault(
          trx,
          org,
          id,
          access.staffIdentityId,
          {
            target: input.defaultAssignment,
            expectedRevision: input.expectedAssignmentRevision,
          },
          false,
          true,
        );
        if (policy.changed) fields.push('requesterPolicy');
        if (assignment.changed) fields.push('defaultAssignment');
        if (!fields.length) {
          const handling = await saveHandling();
          return {
            issue: handling?.changed ? await this.readOne(trx, org, id) : old,
            changed: !!handling?.changed,
          };
        }
        let version = stable.current_published_version_id;
        if (
          name !== old.name ||
          description !== old.description ||
          fields.includes('questions')
        )
          version = await this.publish(
            trx,
            org,
            id,
            version,
            name,
            description,
            null,
            questions,
          );
        await trx
          .updateTable('service_definition')
          .set({
            current_published_version_id: version,
            status: input.active ? 'active' : 'inactive',
            display_order: input.displayOrder,
          })
          .where('organization_id', '=', org)
          .where('id', '=', id)
          .execute();
        await saveHandling();
        const issue = await this.readOne(trx, org, id);
        await validateActiveIssue(trx, org, id);
        await this.audit(trx, access, id, old, issue, fields, correlation);
        return { issue, changed: true };
      });
    } catch (error) {
      this.duplicate(error);
    }
  }
}

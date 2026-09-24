import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'kysely';
import type { AppConfiguration } from '../config/configuration.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import { effectiveRequesterPolicy } from '../service-request/requester-identity-policy.js';
import { targetCatalog } from '../service-request/ownership-targets.js';
import { participationThreshold } from '../service-request/participation.domain.js';
import {
  assertConfigurationRead,
  participationHealth,
} from './admin-configuration.domain.js';

interface IssueRow {
  key: string;
  name: string;
  category: string;
  available: boolean;
  publishedVersion: number | null;
  actionRevision: number;
  identityPolicy: string;
  identityPolicyRevision: number;
  assignmentRevision: number;
  assignmentType: string | null;
  assignmentName: string | null;
  assignmentAvailable: boolean;
}

/** Set-based projection: eligibility follows F037/F048 for either supported audience.
 * Only safe target display names survive; no target IDs or identity-provider fields. */
function issueConfiguration(org: string) {
  return sql`
    select i.service_key as key,coalesce(v.name,'Unpublished Issue') as name,c.name as category,
      c.display_order as category_order,i.id as sort_id,
      (i.status='active' and c.status='active' and d.status='active'
        and (c.division_id is null or dv.status='active') and v.status='published') is true as available,
      v.version_number as "publishedVersion",i.action_revision as "actionRevision",
      ${effectiveRequesterPolicy(sql`${org}`, sql`i.id`)} as "identityPolicy",
      coalesce(p.revision,0) as "identityPolicyRevision",coalesce(a.revision,0) as "assignmentRevision",
      a.target_type as "assignmentType",t.name as "assignmentName",
      (t.active and d.status='active' and (c.division_id is null or dv.status='active') and (
        (t.type='staff'
          and exists(select 1 from staff_department_membership m where m.organization_id=${org} and m.staff_identity_id=t.id and m.department_id=c.department_id and m.active)
          and (c.division_id is null or exists(select 1 from staff_division_membership m where m.organization_id=${org} and m.staff_identity_id=t.id and m.department_id=c.department_id and m.division_id=c.division_id and m.active))
          and exists(select 1 from staff_role_assignment ar join role r on r.organization_id=ar.organization_id and r.id=ar.role_id and r.active
            join role_permission rp on rp.organization_id=r.organization_id and rp.role_id=r.id and rp.permission_key in ('service_request.view','service_request.internal.read')
            where ar.organization_id=${org} and ar.staff_identity_id=t.id and ar.active))
        or (t.type='role' and exists(select 1 from operational_role r where r.organization_id=${org} and r.id=t.id and r.department_id=c.department_id and (r.division_id is null or r.division_id=c.division_id)))
        or (t.type='group' and exists(select 1 from work_group g where g.organization_id=${org} and g.id=t.id and g.department_id=c.department_id and (g.division_id is null or g.division_id=c.division_id)))
      )) is true as "assignmentAvailable"
    from service_definition i
    join category c on c.organization_id=i.organization_id and c.id=i.category_id
    join department d on d.organization_id=c.organization_id and d.id=c.department_id
    left join division dv on dv.organization_id=c.organization_id and dv.department_id=c.department_id and dv.id=c.division_id
    left join service_definition_version v on v.organization_id=i.organization_id and v.service_definition_id=i.id and v.id=i.current_published_version_id
    left join issue_requester_identity_policy p on p.organization_id=i.organization_id and p.service_definition_id=i.id
    left join issue_default_assignment a on a.organization_id=i.organization_id and a.service_definition_id=i.id
    left join ${targetCatalog(org)} t on t.type=a.target_type and t.id=coalesce(a.staff_identity_id,a.operational_role_id,a.work_group_id)
    where i.organization_id=${org}`;
}

@Injectable()
export class AdminConfigurationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}
  async read(access: StaffAccess | undefined, issuePage = 1, areaPage = 1) {
    assertConfigurationRead(access);
    const org = access.organizationId,
      pageSize = 25;
    const threshold = participationThreshold(
      this.config.get('participation', { infer: true })?.suppressionThreshold ??
        5,
    );
    return this.database.client
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute(async (trx) => {
        await sql`set transaction read only`.execute(trx);
        const organization = await trx
          .selectFrom('organization')
          .select([
            'service_participation_collection_enabled',
            'participation_collection_revision',
          ])
          .where('id', '=', org)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (!organization) throw new ForbiddenException('Access denied');
        const issues = issueConfiguration(org);
        const totals = (
          await sql<{
            issues: number;
            unavailableAssignments: number;
            invalidPolicies: number;
            areas: number;
            activeAreas: number;
          }>`
        with configuration as (${issues}) select count(*)::int as issues,
        count(*) filter(where "assignmentType" is not null and not "assignmentAvailable")::int as "unavailableAssignments",
        count(*) filter(where available and "identityPolicy" not in ('IDENTIFIED_REQUIRED','ANONYMOUS_ALLOWED'))::int as "invalidPolicies",
        (select count(*)::int from participation_area where organization_id=${org}) as areas,
        (select count(*)::int from participation_area where organization_id=${org} and active) as "activeAreas"
        from configuration`.execute(trx)
        ).rows[0];
        if (!totals) throw new Error('Configuration summary unavailable');
        const rows = (
          await sql<IssueRow>`select key,name,category,available,"publishedVersion","actionRevision","identityPolicy","identityPolicyRevision","assignmentRevision","assignmentType","assignmentName","assignmentAvailable"
        from (${issues}) configuration order by category_order,category,name,sort_id limit ${pageSize} offset ${(issuePage - 1) * pageSize}`.execute(
            trx,
          )
        ).rows;
        const areas = await trx
          .selectFrom('participation_area')
          .select([
            'id',
            'display_name as name',
            'active',
            'display_order as displayOrder',
            'revision',
          ])
          .where('organization_id', '=', org)
          .orderBy('display_order')
          .orderBy('display_name')
          .orderBy('id')
          .limit(pageSize)
          .offset((areaPage - 1) * pageSize)
          .execute();
        const collection = {
          enabled: organization.service_participation_collection_enabled,
          revision: organization.participation_collection_revision,
        };
        return {
          capabilities: {
            canWriteIntakeSettings: access.permissions.includes(
              'admin.intake_settings.write',
            ),
          },
          collection,
          issues: {
            page: issuePage,
            pageSize,
            total: totals.issues,
            items: rows.map((row) => ({
              key: row.key,
              name: row.name,
              category: row.category,
              available: row.available,
              publishedVersion: row.publishedVersion,
              action: { revision: row.actionRevision },
              identityPolicy: {
                value: row.identityPolicy,
                revision: row.identityPolicyRevision,
              },
              defaultAssignment: {
                revision: row.assignmentRevision,
                state: !row.assignmentType
                  ? 'none'
                  : row.assignmentAvailable
                    ? 'configured'
                    : 'unavailable',
                label: !row.assignmentType
                  ? 'None'
                  : !row.assignmentAvailable
                    ? 'Configured target unavailable'
                    : `${row.assignmentName ?? 'Configured target'} · ${row.assignmentType === 'staff' ? 'Staff' : row.assignmentType === 'group' ? 'Team' : 'Role'}`,
              },
            })),
          },
          participationAreas: {
            page: areaPage,
            pageSize,
            total: totals.areas,
            active: totals.activeAreas,
            items: areas,
          },
          privacy: {
            source: 'deployment_policy',
            suppressionThreshold: threshold,
            smallCountSuppression: true,
            exactSuppressedCountsDisclosed: false,
            analyticsRequiresSeparateAuthorization: true,
          },
          health: [
            participationHealth(collection.enabled, totals.activeAreas),
            {
              resource: 'Issue identity policies',
              severity: totals.invalidPolicies ? 'WARNING' : 'OK',
              message: totals.invalidPolicies
                ? `${String(totals.invalidPolicies)} available Issues have an unsupported requester identity policy.`
                : 'Available Issues use supported effective requester identity policies.',
            },
            {
              resource: 'Issue default assignment',
              severity: totals.unavailableAssignments ? 'WARNING' : 'OK',
              message: totals.unavailableAssignments
                ? `${String(totals.unavailableAssignments)} Issues have a configured target that is unavailable. Review Issues for details.`
                : 'Configured default assignment targets are available. No default assignment is also valid.',
            },
            {
              resource: 'Analytics privacy',
              severity: 'OK',
              message: `The deployment privacy threshold is ${String(threshold)} requests and meets the hard minimum of 5.`,
            },
          ],
        };
      });
  }
}

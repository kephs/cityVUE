import { clearIneligibleAssignment } from './request-ownership.service.js';
import {
  normalizeOperationalNarrative,
  workflowActivityTypes,
  type RequestActivityType,
} from './request-activity.domain.js';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { WorkflowActionDto } from './service-request.dto.js';
import {
  resolveWorkflowTransition,
  validateWorkflowInput,
} from './service-request.domain.js';
import {
  assertInternalAccess,
  internalDepartment,
  internalDivision,
  internalRequestScope,
  internalRequestUuid,
} from './internal-request-scope.js';
import {
  assertStaffRequestRead,
  staffRequestReadScope,
  type StaffRequestAudienceFilter,
} from './staff-request-scope.js';
import {
  assertRequestOperation,
  persistedRequestAudience,
} from './staff-request-policy.js';

export interface InternalRoutingInput {
  expectedRevision: number;
  departmentId: string;
  divisionId?: string | null;
}

@Injectable()
export class InternalRequestMutationsService {
  constructor(private readonly database: DatabaseService) {}

  workflow(
    id: string,
    input: WorkflowActionDto,
    access: StaffAccess | undefined,
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    return this.mutate(id, input, access, 'workflow', audience);
  }

  route(
    id: string,
    input: InternalRoutingInput,
    access: StaffAccess | undefined,
    audience: StaffRequestAudienceFilter = 'internal',
  ) {
    return this.mutate(id, input, access, 'routing', audience);
  }

  private async mutate(
    id: string,
    input: WorkflowActionDto | InternalRoutingInput,
    access: StaffAccess | undefined,
    operation: 'workflow' | 'routing',
    audience: StaffRequestAudienceFilter,
  ) {
    if (audience === 'internal')
      assertInternalAccess(access, 'service_request.internal.update');
    else assertStaffRequestRead(access, audience);
    if (!internalRequestUuid.test(id)) throw new NotFoundException();
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      input.expectedRevision >= 2147483647
    )
      throw new BadRequestException('Invalid revision');
    return this.database.client.transaction().execute(async (trx) => {
      const scope = () =>
        audience === 'internal'
          ? internalRequestScope(trx, access)
          : staffRequestReadScope(trx, access, audience);
      const current = await scope()
        .select([
          'request.id',
          'request.audience',
          'request.status',
          'request.revision',
          internalDepartment.as('departmentId'),
          internalDivision.as('divisionId'),
        ])
        .where('request.id', '=', id)
        .forUpdate('request')
        .forShare(['category', 'organization'])
        .executeTakeFirst();
      if (!current) throw new NotFoundException();
      const persistedAudience = persistedRequestAudience(current.audience);
      if (audience !== 'internal')
        assertRequestOperation(
          access,
          persistedAudience,
          operation === 'routing'
            ? 'route'
            : (input as WorkflowActionDto).action,
        );
      if (current.revision !== input.expectedRevision)
        throw new ConflictException('Request changed; refresh before retrying');
      let status = current.status;
      let departmentId = current.departmentId;
      let divisionId = current.divisionId;
      let activityType: string;
      let operationalType: RequestActivityType;
      let narrative: string | null = null;
      let scopeSnapshot = {};
      let metadata: Record<string, string | number | null>;
      if (operation === 'workflow' && 'action' in input) {
        // Reuse existing validation, but never persist operational free text in audit.
        validateWorkflowInput(
          input.action,
          input.reason,
          input.resolutionSummary,
        );
        narrative = normalizeOperationalNarrative(
          input.action,
          input.reason,
          input.resolutionSummary,
        );
        operationalType = workflowActivityTypes[input.action];
        status = resolveWorkflowTransition(current.status, input.action);
        const types = {
          start_work: 'work_started',
          hold: 'work_held',
          resume: 'work_resumed',
          close: 'service_request_closed',
          reopen: 'service_request_reopened',
        };
        activityType = types[input.action];
        metadata = {
          action: input.action,
          changedField: 'status',
          fromStatus: current.status,
          toStatus: status,
        };
      } else if (operation === 'routing' && 'departmentId' in input) {
        departmentId = input.departmentId;
        divisionId = input.divisionId ?? null;
        if (
          !internalRequestUuid.test(departmentId) ||
          (divisionId !== null && !internalRequestUuid.test(divisionId)) ||
          !access.departmentIds.includes(departmentId) ||
          (divisionId !== null && !access.divisionIds.includes(divisionId))
        )
          throw new NotFoundException();
        const department = await trx
          .selectFrom('department')
          .select('id')
          .where('organization_id', '=', access.organizationId)
          .where('id', '=', departmentId)
          .where('status', '=', 'active')
          .forShare()
          .executeTakeFirst();
        if (!department) throw new NotFoundException();
        if (divisionId !== null) {
          const division = await trx
            .selectFrom('division')
            .select('id')
            .where('organization_id', '=', access.organizationId)
            .where('department_id', '=', departmentId)
            .where('id', '=', divisionId)
            .where('status', '=', 'active')
            .forShare()
            .executeTakeFirst();
          if (!division) throw new NotFoundException();
        }
        if (
          departmentId === current.departmentId &&
          divisionId === current.divisionId
        )
          throw new ConflictException('Request already has this route');
        operationalType = 'request_routed';
        const snapshot = async (dept: string, div: string | null) => {
          const d = await trx
            .selectFrom('department')
            .select('name')
            .where('organization_id', '=', access.organizationId)
            .where('id', '=', dept)
            .forShare()
            .executeTakeFirstOrThrow();
          const v = div
            ? await trx
                .selectFrom('division')
                .select('name')
                .where('organization_id', '=', access.organizationId)
                .where('department_id', '=', dept)
                .where('id', '=', div)
                .forShare()
                .executeTakeFirstOrThrow()
            : null;
          return { department: d.name, division: v?.name ?? null };
        };
        const from = await snapshot(current.departmentId, current.divisionId);
        const to = await snapshot(departmentId, divisionId);
        scopeSnapshot = {
          from_department_id: current.departmentId,
          from_division_id: current.divisionId,
          to_department_id: departmentId,
          to_division_id: divisionId,
          from_department_name: from.department,
          from_division_name: from.division,
          to_department_name: to.department,
          to_division_name: to.division,
        };
        activityType = 'service_request_reassigned';
        metadata = {
          action: 'route',
          changedField: 'routing',
          fromDepartmentId: current.departmentId,
          fromDivisionId: current.divisionId,
          toDepartmentId: departmentId,
          toDivisionId: divisionId,
        };
      } else throw new BadRequestException('Invalid operation');
      const row = await trx
        .updateTable('service_request')
        .set({
          status,
          revision: current.revision + 1,
          updated_at: sql`now()`,
          ...(operation === 'routing'
            ? {
                routed_department_id: departmentId,
                routed_division_id: divisionId,
              }
            : {}),
        })
        .where(
          'id',
          'in',
          scope().select('request.id').where('request.id', '=', id),
        )
        .where('organization_id', '=', access.organizationId)
        .where('audience', '=', persistedAudience)
        .where('revision', '=', input.expectedRevision)
        .returning([
          'id',
          'reference_number',
          'status',
          'revision',
          'updated_at',
        ])
        .executeTakeFirst();
      if (!row)
        throw new ConflictException('Request changed; refresh before retrying');
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: access.organizationId,
          service_request_id: id,
          activity_type: activityType,
          actor_type: 'staff',
          staff_identity_id: access.staffIdentityId,
          actor_reference: null,
          metadata: {
            ...metadata,
            policy: persistedAudience === 'public' ? 'F040' : 'F031',
            revision: row.revision,
          },
        })
        .execute();
      await trx
        .insertInto('request_operational_activity')
        .values({
          organization_id: access.organizationId,
          service_request_id: id,
          activity_type: operationalType,
          actor_type: 'staff',
          staff_identity_id: access.staffIdentityId,
          request_revision: row.revision,
          from_status: operation === 'workflow' ? current.status : null,
          to_status: operation === 'workflow' ? status : null,
          narrative,
          ...scopeSnapshot,
        })
        .execute();
      if (operation === 'routing')
        await clearIneligibleAssignment(
          trx,
          access,
          id,
          departmentId,
          divisionId,
          row.revision,
          persistedAudience,
        );
      return {
        serviceRequestId: row.id,
        ...(audience === 'public'
          ? { referenceNumber: row.reference_number }
          : {}),
        status: row.status,
        revision: row.revision,
        updatedAt: row.updated_at,
        departmentId,
        divisionId,
      };
    });
  }
}

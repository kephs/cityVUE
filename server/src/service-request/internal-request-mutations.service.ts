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
  ) {
    return this.mutate(id, input, access, 'workflow');
  }

  route(
    id: string,
    input: InternalRoutingInput,
    access: StaffAccess | undefined,
  ) {
    return this.mutate(id, input, access, 'routing');
  }

  private async mutate(
    id: string,
    input: WorkflowActionDto | InternalRoutingInput,
    access: StaffAccess | undefined,
    operation: 'workflow' | 'routing',
  ) {
    assertInternalAccess(access, 'service_request.internal.update');
    if (!internalRequestUuid.test(id)) throw new NotFoundException();
    if (
      !Number.isInteger(input.expectedRevision) ||
      input.expectedRevision < 1 ||
      input.expectedRevision >= 2147483647
    )
      throw new BadRequestException('Invalid revision');
    return this.database.client.transaction().execute(async (trx) => {
      const current = await internalRequestScope(trx, access)
        .select([
          'request.id',
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
      if (current.revision !== input.expectedRevision)
        throw new ConflictException('Request changed; refresh before retrying');
      let status = current.status;
      let departmentId = current.departmentId;
      let divisionId = current.divisionId;
      let activityType: string;
      let metadata: Record<string, string | number | null>;
      if (operation === 'workflow' && 'action' in input) {
        // Reuse existing validation, but never persist operational free text in audit.
        validateWorkflowInput(
          input.action,
          input.reason,
          input.resolutionSummary,
        );
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
          internalRequestScope(trx, access)
            .select('request.id')
            .where('request.id', '=', id),
        )
        .where('organization_id', '=', access.organizationId)
        .where('audience', '=', 'internal')
        .where('revision', '=', input.expectedRevision)
        .returning(['id', 'status', 'revision', 'updated_at'])
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
          metadata: { ...metadata, policy: 'F031', revision: row.revision },
        })
        .execute();
      return {
        serviceRequestId: row.id,
        status: row.status,
        revision: row.revision,
        updatedAt: row.updated_at,
        departmentId,
        divisionId,
      };
    });
  }
}

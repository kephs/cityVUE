import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { AppConfiguration } from '../config/configuration.js';
import { DatabaseService } from '../database/database.service.js';
import type {
  AssignmentActionDto,
  StaffMutationResponseDto,
  WorkflowActionDto,
} from './service-request.dto.js';
import {
  resolveWorkflowTransition,
  validateWorkflowInput,
} from './service-request.domain.js';

interface AssignmentSummary {
  type: string;
  targetId?: string;
  displayName?: string;
}
const uuidV4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class StaffActionsService {
  private readonly organizationId: string;
  private readonly actorId: string;
  private readonly enabled: boolean;
  constructor(
    config: ConfigService<AppConfiguration, true>,
    private readonly database: DatabaseService,
  ) {
    this.organizationId = config.get('catalog.developmentOrganizationId', {
      infer: true,
    });
    this.actorId = config.get('staffActions.developmentActorId', {
      infer: true,
    });
    this.enabled = config.get('staffActions.developmentEnabled', {
      infer: true,
    });
  }

  private assertEnabled(): void {
    if (!this.enabled) throw new NotFoundException();
  }
  private assertRequestId(id: string): void {
    if (!uuidV4.test(id)) throw new NotFoundException();
  }
  private async assertActor(trx: typeof this.database.client): Promise<void> {
    const actor = await trx
      .selectFrom('staff_identity')
      .select('id')
      .where('organization_id', '=', this.organizationId)
      .where('id', '=', this.actorId)
      .where('active', '=', true)
      .executeTakeFirst();
    if (!actor)
      throw new NotFoundException('Development staff actor is unavailable');
  }
  private async bump(
    trx: typeof this.database.client,
    id: string,
    expected: number,
    status?: string,
  ) {
    const row = await trx
      .updateTable('service_request')
      .set({
        revision: expected + 1,
        updated_at: sql`now()`,
        ...(status ? { status } : {}),
      })
      .where('organization_id', '=', this.organizationId)
      .where('id', '=', id)
      .where('revision', '=', expected)
      .returning(['id', 'reference_number', 'status', 'revision', 'updated_at'])
      .executeTakeFirst();
    if (!row)
      throw new ConflictException(
        'This request was updated by another user. Refresh the request before making changes.',
      );
    return row;
  }
  private response(
    row: {
      id: string;
      reference_number: string;
      status: string;
      revision: number;
      updated_at: unknown;
    },
    assignment?: AssignmentSummary,
  ): StaffMutationResponseDto {
    return {
      serviceRequestId: row.id,
      referenceNumber: row.reference_number,
      status: row.status,
      revision: row.revision,
      ...(assignment ? { currentAssignment: assignment } : {}),
      updatedAt: row.updated_at as Date | string,
    };
  }

  async assign(
    id: string,
    input: AssignmentActionDto,
  ): Promise<StaffMutationResponseDto> {
    this.assertEnabled();
    this.assertRequestId(id);
    const needsTarget = input.assignmentType !== 'unassigned';
    if (needsTarget !== Boolean(input.targetId))
      throw new BadRequestException(
        'Assignment target does not match assignment type',
      );
    return this.database.client.transaction().execute(async (trx) => {
      await this.assertActor(trx);
      const targetId = input.targetId ?? '';
      let summary: AssignmentSummary = { type: input.assignmentType };
      if (input.assignmentType === 'department') {
        const target = await trx
          .selectFrom('department')
          .select(['id', 'name'])
          .where('organization_id', '=', this.organizationId)
          .where('id', '=', targetId)
          .where('status', '=', 'active')
          .executeTakeFirst();
        if (!target)
          throw new NotFoundException('Active assignment target not found');
        summary = {
          type: 'department',
          targetId: target.id,
          displayName: target.name,
        };
      } else if (input.assignmentType === 'group') {
        const target = await trx
          .selectFrom('work_group')
          .select(['id', 'name'])
          .where('organization_id', '=', this.organizationId)
          .where('id', '=', targetId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (!target)
          throw new NotFoundException('Active assignment target not found');
        summary = {
          type: 'group',
          targetId: target.id,
          displayName: target.name,
        };
      } else if (input.assignmentType === 'individual') {
        const target = await trx
          .selectFrom('staff_identity')
          .select(['id', 'display_name'])
          .where('organization_id', '=', this.organizationId)
          .where('id', '=', targetId)
          .where('active', '=', true)
          .executeTakeFirst();
        if (!target)
          throw new NotFoundException('Active assignment target not found');
        summary = {
          type: 'individual',
          targetId: target.id,
          displayName: target.display_name,
        };
      }
      const current = await trx
        .selectFrom('service_request_assignment')
        .select(['assignment_type'])
        .where('organization_id', '=', this.organizationId)
        .where('service_request_id', '=', id)
        .where('ended_at', 'is', null)
        .executeTakeFirst();
      const row = await this.bump(trx, id, input.expectedRevision);
      await trx
        .updateTable('service_request_assignment')
        .set({ ended_at: new Date() })
        .where('organization_id', '=', this.organizationId)
        .where('service_request_id', '=', id)
        .where('ended_at', 'is', null)
        .execute();
      await trx
        .insertInto('service_request_assignment')
        .values({
          id: randomUUID(),
          organization_id: this.organizationId,
          service_request_id: id,
          assignment_type: input.assignmentType,
          staff_identity_id:
            input.assignmentType === 'individual' ? targetId : null,
          work_group_id: input.assignmentType === 'group' ? targetId : null,
          department_id:
            input.assignmentType === 'department' ? targetId : null,
          ended_at: null,
          assigned_by_actor_type: 'development_staff',
          assigned_by_staff_identity_id: this.actorId,
          reason: input.reason?.trim() ?? null,
        })
        .execute();
      const activityType =
        input.assignmentType === 'unassigned'
          ? 'service_request_unassigned'
          : current
            ? 'service_request_reassigned'
            : 'service_request_assigned';
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: this.organizationId,
          service_request_id: id,
          activity_type: activityType,
          actor_type: 'development_staff',
          actor_reference: null,
          staff_identity_id: this.actorId,
          metadata: {
            previousAssignmentType: current?.assignment_type ?? 'unassigned',
            newAssignmentType: input.assignmentType,
            ...(summary.displayName
              ? { targetDisplayName: summary.displayName }
              : {}),
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
          },
        })
        .execute();
      return this.response(row, summary);
    });
  }

  async workflow(
    id: string,
    input: WorkflowActionDto,
  ): Promise<StaffMutationResponseDto> {
    this.assertEnabled();
    this.assertRequestId(id);
    validateWorkflowInput(input.action, input.reason, input.resolutionSummary);
    return this.database.client.transaction().execute(async (trx) => {
      await this.assertActor(trx);
      const request = await trx
        .selectFrom('service_request')
        .select(['status'])
        .where('organization_id', '=', this.organizationId)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!request) throw new NotFoundException();
      const next = resolveWorkflowTransition(request.status, input.action);
      const row = await this.bump(trx, id, input.expectedRevision, next);
      const activityTypes = {
        start_work: 'work_started',
        hold: 'work_held',
        resume: 'work_resumed',
        close: 'service_request_closed',
        reopen: 'service_request_reopened',
      } as const;
      await trx
        .insertInto('activity')
        .values({
          id: randomUUID(),
          organization_id: this.organizationId,
          service_request_id: id,
          activity_type: activityTypes[input.action],
          actor_type: 'development_staff',
          actor_reference: null,
          staff_identity_id: this.actorId,
          metadata: {
            fromStatus: request.status,
            toStatus: next,
            ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
            ...(input.resolutionSummary?.trim()
              ? { resolutionSummary: input.resolutionSummary.trim() }
              : {}),
          },
        })
        .execute();
      return this.response(row);
    });
  }
}

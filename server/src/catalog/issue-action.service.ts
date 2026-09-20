import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import { DatabaseService } from '../database/database.service.js';
import type { IssueActionDto } from './issue-action.controller.js';
import {
  approvedDestination,
  issueActionProjection,
} from './issue-action.domain.js';
@Injectable()
export class IssueActionService {
  constructor(private readonly database: DatabaseService) {}
  private scoped(id: string, access: StaffAccess | undefined) {
    if (
      !access ||
      access.development ||
      !access.tenantId ||
      !access.objectId ||
      !access.organizationId ||
      !access.permissions.includes('catalog.issue_action.manage')
    )
      throw new ForbiddenException('Access denied');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new NotFoundException();
    return this.database.client
      .selectFrom('service_definition as service')
      .innerJoin('organization', 'organization.id', 'service.organization_id')
      .innerJoin('category', (join) =>
        join
          .onRef('category.id', '=', 'service.category_id')
          .onRef('category.organization_id', '=', 'service.organization_id'),
      )
      .where('service.id', '=', id)
      .where('service.organization_id', '=', access.organizationId)
      .where('organization.status', '=', 'active')
      .where((eb) =>
        access.departmentIds.length
          ? eb('category.department_id', 'in', access.departmentIds)
          : sql<boolean>`false`,
      )
      .where((eb) =>
        access.divisionIds.length
          ? eb.or([
              eb('category.division_id', 'is', null),
              eb('category.division_id', 'in', access.divisionIds),
            ])
          : eb('category.division_id', 'is', null),
      );
  }
  async get(id: string, access: StaffAccess | undefined) {
    const row = await this.scoped(id, access)
      .select([
        'service.action_type',
        'service.redirect_url',
        'service.redirect_message',
        'service.redirect_label',
        'service.action_revision',
      ])
      .executeTakeFirst();
    if (!row) throw new NotFoundException();
    return { ...issueActionProjection(row), revision: row.action_revision };
  }
  async set(
    id: string,
    input: IssueActionDto,
    access: StaffAccess | undefined,
  ) {
    if (!access) throw new ForbiddenException('Access denied');
    const scope = this.scoped(id, access);
    let destination: string | null = null,
      message: string | null = null,
      label: string | null = null;
    if (input.actionType === 'external_redirect') {
      destination = approvedDestination(input.destination ?? '');
      const text = input.message?.trim();
      const button = input.label?.trim();
      message =
        text === undefined || text === ''
          ? 'This service is handled through another online service.'
          : text;
      label =
        button === undefined || button === ''
          ? 'Continue to External Service'
          : button;
    } else if (
      input.actionType !== 'internal_intake' ||
      input.destination != null ||
      input.message != null ||
      input.label != null
    )
      throw new BadRequestException(
        'Redirect configuration does not match the action',
      );
    const row = await this.database.client
      .updateTable('service_definition')
      .set({
        action_type: input.actionType,
        redirect_url: destination,
        redirect_message: message,
        redirect_label: label,
        action_revision: input.expectedRevision + 1,
        updated_at: sql`now()`,
      })
      .where('id', 'in', scope.select('service.id'))
      .where('organization_id', '=', access.organizationId)
      .where('action_revision', '=', input.expectedRevision)
      .returning([
        'action_type',
        'redirect_url',
        'redirect_message',
        'redirect_label',
        'action_revision',
      ])
      .executeTakeFirst();
    if (!row) {
      if (!(await scope.select('service.id').executeTakeFirst()))
        throw new NotFoundException();
      throw new ConflictException(
        'Issue configuration changed; refresh before retrying',
      );
    }
    return { ...issueActionProjection(row), revision: row.action_revision };
  }
}

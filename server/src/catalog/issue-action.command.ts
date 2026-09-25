import { validateActiveIssue } from './issue-activation.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import {
  handoffText,
  approvedDestination,
  issueActionProjection,
} from './issue-action.domain.js';
import { validateHandling } from './issue-availability.js';

export interface ActionInput {
  actionType: string;
  expectedRevision: number;
  destination?: string;
  message?: string | null;
  label?: string | null;
}
export function assertActionRead(
  access: StaffAccess | undefined,
): asserts access is StaffAccess {
  if (
    !access ||
    access.development ||
    !access.tenantId ||
    !access.objectId ||
    !access.organizationId ||
    !access.permissions.includes('catalog.issue_action.manage')
  )
    throw new ForbiddenException('Access denied');
}
export function actionScope(
  db: Kysely<DatabaseSchema>,
  id: string,
  access: StaffAccess,
) {
  assertActionRead(access);
  if (!requestUuid.test(id)) throw new NotFoundException();
  return db
    .selectFrom('service_definition as service')
    .innerJoin('organization', 'organization.id', 'service.organization_id')
    .innerJoin('category', (j) =>
      j
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
export function normalizeAction(input: ActionInput) {
  if (
    Object.keys(input).some(
      (k) =>
        ![
          'actionType',
          'expectedRevision',
          'destination',
          'message',
          'label',
        ].includes(k),
    ) ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    input.expectedRevision > 2147483646
  )
    throw new BadRequestException('Invalid Issue action');
  let destination: string | null = null,
    message: string | null = null,
    label: string | null = null;
  if (input.actionType === 'external_redirect') {
    if (typeof input.destination !== 'string')
      throw new BadRequestException('Enter a valid HTTPS destination.');
    destination = approvedDestination(input.destination);
    // Preserve F032 omitted-field defaults; explicitly blank values are invalid.
    // Explicit null is malformed even though the legacy DTO permits omitted fields.
    if (input.message === null || input.label === null)
      throw new BadRequestException(
        'Enter a valid handoff message and button label.',
      );
    message =
      input.message ??
      'This service is handled through another online service.';
    label = input.label ?? 'Continue to External Service';
    message = handoffText(message, 500);
    label = handoffText(label, 80);
  } else if (
    input.actionType !== 'internal_intake' ||
    input.destination != null ||
    input.message != null ||
    input.label != null
  )
    throw new BadRequestException(
      'Redirect configuration does not match the action',
    );
  return {
    action_type: input.actionType,
    redirect_url: destination,
    redirect_message: message,
    redirect_label: label,
  };
}
/** Both entry points participate in this command's caller-owned transaction. */
export async function configureIssueAction(
  trx: Transaction<DatabaseSchema>,
  id: string,
  input: ActionInput,
  access: StaffAccess | undefined,
  correlation?: string,
) {
  assertActionRead(access);
  if (
    !access.permissions.includes('admin.configuration.read') ||
    !access.permissions.includes('admin.issues.write')
  )
    throw new ForbiddenException('Access denied');
  if (
    !(await trx
      .selectFrom('organization')
      .select('id')
      .where('id', '=', access.organizationId)
      .where('status', '=', 'active')
      .forShare()
      .executeTakeFirst())
  )
    throw new ForbiddenException('Access denied');
  const old = await actionScope(trx, id, access)
    .select([
      'service.id',
      'service.availability',
      'service.action_revision',
      'service.action_type',
      'service.redirect_url',
      'service.redirect_message',
      'service.redirect_label',
    ])
    .forUpdate('service')
    .forShare(['category', 'organization'])
    .executeTakeFirst();
  if (!old) throw new NotFoundException('Issue unavailable');
  if (old.action_revision !== input.expectedRevision)
    throw new ConflictException(
      'Issue configuration changed; refresh before retrying',
    );
  const next = normalizeAction(input);
  validateHandling(old.availability, next.action_type);
  if (
    old.action_type === next.action_type &&
    old.redirect_url === next.redirect_url &&
    old.redirect_message === next.redirect_message &&
    old.redirect_label === next.redirect_label
  )
    return {
      ...issueActionProjection(old),
      revision: old.action_revision,
      changed: false,
    };
  const revision = old.action_revision + 1,
    correlationId =
      correlation && requestUuid.test(correlation) ? correlation : randomUUID();
  await trx
    .updateTable('service_definition')
    .set({ ...next, action_revision: revision, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('organization_id', '=', access.organizationId)
    .execute();
  await validateActiveIssue(trx, access.organizationId, id);
  await sql`insert into issue_action_history(organization_id,issue_id,action_revision,action_type,redirect_url,redirect_message,redirect_label,staff_identity_id,correlation_id)
    values(${access.organizationId},${id},${revision},${next.action_type},${next.redirect_url},${next.redirect_message},${next.redirect_label},${access.staffIdentityId},${correlationId})`.execute(
    trx,
  );
  await sql`insert into issue_action_audit(organization_id,issue_id,staff_identity_id,prior_action,action,prior_revision,revision,destination_hostname,correlation_id)
    values(${access.organizationId},${id},${access.staffIdentityId},${old.action_type},${next.action_type},${old.action_revision},${revision},${next.redirect_url ? new URL(next.redirect_url).hostname : null},${correlationId})`.execute(
    trx,
  );
  return { ...issueActionProjection(next), revision, changed: true };
}

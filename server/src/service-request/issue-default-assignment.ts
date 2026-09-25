import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  eligibleTargets,
  validateTarget,
  type OwnershipTarget,
  type TargetType,
} from './ownership-targets.js';
import { insertCurrentAssignment } from './assignment-write.js';
import type { StaffRequestAudience } from './staff-request-scope.js';

export interface DefaultAssignmentInput {
  expectedRevision: number;
  target: { type: TargetType; id: string } | null;
}
export function validateDefaultAssignment(input: DefaultAssignmentInput) {
  if (
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= 2147483647
  )
    throw new BadRequestException('Invalid configuration revision');
  if (input.target !== null) validateTarget(input.target.type, input.target.id);
}

async function lockTarget(
  db: Kysely<DatabaseSchema>,
  org: string,
  type: TargetType,
  id: string,
) {
  const table =
    type === 'staff'
      ? 'staff_identity'
      : type === 'role'
        ? 'operational_role'
        : 'work_group';
  return db
    .selectFrom(table)
    .select('id')
    .where('organization_id', '=', org)
    .where('id', '=', id)
    .forShare()
    .executeTakeFirst();
}

/** Shared Category-based eligibility for Add preflight and authoritative assignment writes. */
export async function validateIssueDefaultTarget(
  db: Kysely<DatabaseSchema>,
  org: string,
  departmentId: string,
  divisionId: string | null,
  target: DefaultAssignmentInput['target'],
  lock = true,
) {
  let selected: OwnershipTarget | undefined;
  if (target) {
    const { type, id } = target;
    if (lock && !(await lockTarget(db, org, type, id)))
      throw new BadRequestException(
        'Selected assignment target is unavailable',
      );
    for (const audience of ['public', 'internal'] as const) {
      selected = (
        await eligibleTargets(
          db,
          org,
          departmentId,
          divisionId,
          type,
          '',
          id,
          audience,
        )
      )[0];
      if (selected) break;
    }
    if (!selected)
      throw new BadRequestException(
        'Selected assignment target is unavailable',
      );
  }
  return selected;
}

/** Internal transaction helper, not an HTTP configuration API. Caller establishes administrative authority. */
export async function configureIssueDefault(
  db: Kysely<DatabaseSchema>,
  org: string,
  issueId: string,
  staffId: string,
  input: DefaultAssignmentInput,
  dryRun = false,
  allowInactive = false,
) {
  validateDefaultAssignment(input);
  let issueQuery = db
    .selectFrom('service_definition as issue')
    .innerJoin('category', (j) =>
      j
        .onRef('category.organization_id', '=', 'issue.organization_id')
        .onRef('category.id', '=', 'issue.category_id'),
    )
    .select(['issue.id', 'category.department_id', 'category.division_id'])
    .where('issue.organization_id', '=', org)
    .where('issue.id', '=', issueId)
    .where(
      'issue.status',
      'in',
      allowInactive ? ['active', 'inactive'] : ['active'],
    )
    .where('category.status', '=', 'active');
  if (!dryRun) issueQuery = issueQuery.forUpdate('issue').forShare('category');
  const issue = await issueQuery.executeTakeFirst();
  if (!issue) throw new NotFoundException('Issue unavailable');
  const old = await db
    .selectFrom('issue_default_assignment')
    .selectAll()
    .where('organization_id', '=', org)
    .where('service_definition_id', '=', issueId)
    .executeTakeFirst();
  const revision = old?.revision ?? 0;
  if (input.expectedRevision !== revision)
    throw new ConflictException(
      'Issue configuration changed; inspect before retrying',
    );
  const selected = await validateIssueDefaultTarget(
    db,
    org,
    issue.department_id,
    issue.division_id,
    input.target,
    !dryRun,
  );
  const priorId =
    old?.staff_identity_id ??
    old?.operational_role_id ??
    old?.work_group_id ??
    null;
  const changed =
    (old?.target_type ?? null) !== (input.target?.type ?? null) ||
    priorId !== (input.target?.id ?? null);
  if (!changed || dryRun)
    return { revision, changed, target: selected ?? null };
  const next = {
    organization_id: org,
    service_definition_id: issueId,
    target_type: input.target?.type ?? null,
    staff_identity_id: input.target?.type === 'staff' ? input.target.id : null,
    operational_role_id: input.target?.type === 'role' ? input.target.id : null,
    work_group_id: input.target?.type === 'group' ? input.target.id : null,
    revision: revision + 1,
    updated_at: sql<Date>`clock_timestamp()`,
  };
  await db
    .insertInto('issue_default_assignment')
    .values(next)
    .onConflict((c) =>
      c.columns(['organization_id', 'service_definition_id']).doUpdateSet(next),
    )
    .execute();
  await db
    .insertInto('issue_default_assignment_audit')
    .values({
      organization_id: org,
      service_definition_id: issueId,
      staff_identity_id: staffId,
      revision: revision + 1,
      action: input.target ? 'set' : 'clear',
      target_type: input.target?.type ?? null,
      target_id: input.target?.id ?? null,
    })
    .execute();
  return { revision: revision + 1, changed: true, target: selected ?? null };
}

export interface ResolvedDefault {
  outcome: 'none' | 'assigned' | 'target_unavailable';
  target?: OwnershipTarget;
}

/** Caller holds the stable Issue share lock through creation commit. */
export async function resolveIssueDefault(
  db: Kysely<DatabaseSchema>,
  org: string,
  issueId: string,
  categoryId: string,
  audience: StaffRequestAudience,
): Promise<ResolvedDefault> {
  const config = await db
    .selectFrom('issue_default_assignment')
    .selectAll()
    .where('organization_id', '=', org)
    .where('service_definition_id', '=', issueId)
    .executeTakeFirst();
  if (!config?.target_type) return { outcome: 'none' };
  const id =
    config.staff_identity_id ??
    config.operational_role_id ??
    config.work_group_id;
  const category = await db
    .selectFrom('category')
    .select(['department_id', 'division_id'])
    .where('organization_id', '=', org)
    .where('id', '=', categoryId)
    .forShare()
    .executeTakeFirstOrThrow();
  if (!id || !(await lockTarget(db, org, config.target_type, id)))
    return { outcome: 'target_unavailable' };
  const target = (
    await eligibleTargets(
      db,
      org,
      category.department_id,
      category.division_id,
      config.target_type,
      '',
      id,
      audience,
    )
  )[0];
  return target
    ? { outcome: 'assigned', target }
    : { outcome: 'target_unavailable' };
}

export async function applyInitialAssignment(
  db: Kysely<DatabaseSchema>,
  org: string,
  requestId: string,
  target: OwnershipTarget,
) {
  await insertCurrentAssignment(db, org, requestId, target, null);
  const row = await db
    .updateTable('service_request')
    .set({ revision: 2, updated_at: sql`clock_timestamp()` })
    .where('organization_id', '=', org)
    .where('id', '=', requestId)
    .where('revision', '=', 1)
    .returning('revision')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('request_operational_activity')
    .values({
      organization_id: org,
      service_request_id: requestId,
      activity_type: 'request_auto_assigned',
      actor_type: 'system',
      request_revision: row.revision,
      to_target_type: target.type,
      to_target_name: target.displayName,
      occurred_at: sql`greatest(clock_timestamp(), (select occurred_at + interval '1 microsecond' from request_operational_activity where organization_id=${org} and service_request_id=${requestId} and activity_type='request_created'))`,
    })
    .execute();
  await db
    .insertInto('activity')
    .values({
      id: randomUUID(),
      organization_id: org,
      service_request_id: requestId,
      activity_type: 'service_request_assigned',
      actor_type: 'system',
      actor_reference: null,
      metadata: {
        policy: 'F048',
        source: 'issue_default',
        action: 'assign',
        revision: row.revision,
      },
    })
    .execute();
}

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Kysely, type RawBuilder } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';

export const requesterPolicies = [
  'IDENTIFIED_REQUIRED',
  'ANONYMOUS_ALLOWED',
] as const;
export type RequesterIdentityPolicy = (typeof requesterPolicies)[number];
export interface RequesterPolicyInput {
  policy: RequesterIdentityPolicy;
  expectedRevision: number;
}

/** Stable Issue configuration; caller supplies trusted SQL references, never user SQL. */
export function effectiveRequesterPolicy(
  org: RawBuilder<unknown>,
  issue: RawBuilder<unknown>,
) {
  return sql<RequesterIdentityPolicy>`coalesce(
    (select p.policy from issue_requester_identity_policy p where p.organization_id=${org} and p.service_definition_id=${issue}),
    (select case when v.anonymous_reporting_policy in ('allowed','allowed_with_limitations') then 'ANONYMOUS_ALLOWED' else 'IDENTIFIED_REQUIRED' end
     from service_definition i left join service_definition_version v on v.organization_id=i.organization_id and v.id=i.current_published_version_id
     where i.organization_id=${org} and i.id=${issue}), 'IDENTIFIED_REQUIRED')`;
}

export function validateIdentityContact(
  identity: string,
  contact: unknown,
  internal: boolean,
) {
  if (!['identified', 'anonymous'].includes(identity))
    throw new BadRequestException('Invalid requester identity');
  if (identity === 'anonymous' && contact !== undefined)
    throw new BadRequestException(
      'Anonymous requests must not include contact information',
    );
  if (internal && (identity !== 'identified' || contact))
    throw new BadRequestException('Internal intake requires staff attribution');
}

/** Internal transactional administrative helper; not registered as an HTTP endpoint. */
export async function configureRequesterPolicy(
  db: Kysely<DatabaseSchema>,
  org: string,
  issueId: string,
  staffId: string,
  input: RequesterPolicyInput,
  dryRun = false,
  allowInactive = false,
) {
  if (
    !requesterPolicies.includes(input.policy) ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    input.expectedRevision >= 2147483647
  )
    throw new BadRequestException(
      'Invalid requester identity policy configuration',
    );
  let query = db
    .selectFrom('service_definition')
    .select('id')
    .where('organization_id', '=', org)
    .where('id', '=', issueId)
    .where('status', 'in', allowInactive ? ['active', 'inactive'] : ['active']);
  if (!dryRun) query = query.forUpdate();
  if (!(await query.executeTakeFirst()))
    throw new NotFoundException('Issue unavailable');
  const current = await inspectRequesterPolicy(db, org, issueId);
  if (current.revision !== input.expectedRevision)
    throw new ConflictException(
      'Issue policy changed; inspect before retrying',
    );
  if ((current.revision > 0 && current.policy === input.policy) || dryRun)
    return {
      ...current,
      changed: current.revision === 0 || current.policy !== input.policy,
    };
  const next = {
    organization_id: org,
    service_definition_id: issueId,
    policy: input.policy,
    revision: current.revision + 1,
    updated_at: sql<Date>`clock_timestamp()`,
  };
  await db
    .insertInto('issue_requester_identity_policy')
    .values(next)
    .onConflict((c) =>
      c.columns(['organization_id', 'service_definition_id']).doUpdateSet(next),
    )
    .execute();
  await db
    .insertInto('issue_requester_identity_audit')
    .values({
      organization_id: org,
      service_definition_id: issueId,
      staff_identity_id: staffId,
      revision: next.revision,
      prior_policy: current.policy,
      policy: input.policy,
    })
    .execute();
  return { policy: input.policy, revision: next.revision, changed: true };
}

export async function inspectRequesterPolicy(
  db: Kysely<DatabaseSchema>,
  org: string,
  issue: string,
) {
  const { rows } = await sql<{
    policy: RequesterIdentityPolicy;
    revision: number;
  }>`select ${effectiveRequesterPolicy(sql`${org}`, sql`${issue}`)} as policy,
    coalesce((select revision from issue_requester_identity_policy where organization_id=${org} and service_definition_id=${issue}),0)::int as revision`.execute(
    db,
  );
  const result = rows[0];
  if (!result) throw new NotFoundException();
  return result;
}

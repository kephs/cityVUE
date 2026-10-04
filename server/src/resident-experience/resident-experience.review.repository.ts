import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import type { DatabaseSchema } from '../database/database.types.js';
import type { StaffAccess } from '../auth/auth.types.js';
import { authorizeRequestTransaction } from '../service-request/request-authorization.js';
import type { ResidentExperienceRepository } from './resident-experience.repository.js';
import {
  assertResidentPublicationAuthority,
  classifyResidentPublication,
  type ResidentReviewBinding,
  type ReviewOutcome,
} from './resident-experience.review.js';

type Trx = Transaction<DatabaseSchema>;
/** Internal transaction-bound foundation. Not a Nest provider, controller or CLI.
 * Callers must commit each request/decision separately. No publish command exists.
 */
export class ResidentReviewRepository {
  constructor(private readonly snapshots: ResidentExperienceRepository) {}

  private async lock(trx: Trx, trusted: StaffAccess, expectedRevision: number) {
    const access = await authorizeRequestTransaction(trx, trusted, [
      'admin.configuration.read',
    ]);
    const resource = await trx
      .selectFrom('organization_resident_experience')
      .selectAll()
      .where('organization_id', '=', access.organizationId)
      .forUpdate()
      .executeTakeFirst();
    if (!resource) throw new NotFoundException();
    if (resource.revision !== expectedRevision)
      throw new ConflictException('Resident experience changed');
    return { access, resource };
  }

  async insertRequest(
    trx: Trx,
    trusted: StaffAccess,
    binding: ResidentReviewBinding,
    supersedesRequestId: string | null,
  ) {
    const { access, resource } = await this.lock(
      trx,
      trusted,
      binding.resourceRevision,
    );
    if (binding.organizationId !== access.organizationId)
      throw new NotFoundException();
    if (
      !access.permissions.includes('resident_experience.write') &&
      !access.permissions.includes('resident_experience.publish')
    )
      throw new ForbiddenException('Access denied');
    if (
      binding.baselineRevisionId !== resource.published_revision_id ||
      binding.draftRevisionId !== resource.draft_revision_id
    )
      throw new ConflictException('Resident experience changed');
    const target = await this.snapshots.loadRevision(
      trx,
      access.organizationId,
      binding.targetRevisionId,
    );
    const baseline = binding.baselineRevisionId
      ? await this.snapshots.loadRevision(
          trx,
          access.organizationId,
          binding.baselineRevisionId,
        )
      : null;
    const changes = classifyResidentPublication(baseline, target);
    return trx
      .insertInto('resident_experience_review_request')
      .values({
        id: randomUUID(),
        organization_id: access.organizationId,
        target_revision_id: binding.targetRevisionId,
        baseline_revision_id: binding.baselineRevisionId,
        draft_revision_id: binding.draftRevisionId,
        resource_revision: binding.resourceRevision,
        authorization_revision: binding.authorizationRevision,
        purpose: binding.purpose,
        policy_version: binding.policyVersion as 1,
        classifier_version: binding.classifierVersion as 1,
        requested_by: access.staffIdentityId,
        supersedes_request_id: supersedesRequestId,
        consequential: changes.consequential,
        changed_fields: changes.changedFields,
        reasons: changes.reasons,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertDecision(
    trx: Trx,
    trusted: StaffAccess,
    requestId: string,
    expectedRevision: number,
    outcome: ReviewOutcome,
  ) {
    const { access } = await this.lock(trx, trusted, expectedRevision);
    const request = await trx
      .selectFrom('resident_experience_review_request')
      .selectAll()
      .where('organization_id', '=', access.organizationId)
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (!request) throw new NotFoundException();
    assertResidentPublicationAuthority(access, request.consequential);
    return trx
      .insertInto('resident_experience_review_decision')
      .values({
        id: randomUUID(),
        organization_id: access.organizationId,
        request_id: request.id,
        reviewer_id: access.staffIdentityId,
        outcome,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async contributors(
    trx: Trx,
    organizationId: string,
    targetRevisionId: string,
    baselineRevisionId: string | null,
  ) {
    const result = await sql<{
      actor: string;
    }>`select resident_review_contributors(${organizationId}::uuid,${targetRevisionId}::uuid,${baselineRevisionId}::uuid) as actor`.execute(
      trx,
    );
    return result.rows.map((r) => r.actor).sort();
  }
}

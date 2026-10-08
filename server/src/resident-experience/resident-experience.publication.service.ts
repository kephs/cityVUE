import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import {
  requestTransaction,
  resolveRequestAuthority,
} from '../service-request/request-authorization.js';
import { requestUuid } from '../service-request/staff-request-scope.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import {
  assertResidentPublicationAuthority,
  classifyResidentPublication,
  evaluateResidentApproval,
  residentPublicationClassifierVersion,
  residentReviewPolicyVersion,
  type ResidentReviewBinding,
  type ResidentReviewDecision,
  type ResidentReviewRequest,
} from './resident-experience.review.js';

type RequestRow = Selectable<
  DatabaseSchema['resident_experience_review_request']
>;
type DecisionRow = Selectable<
  DatabaseSchema['resident_experience_review_decision']
>;

export interface ResidentPublicationCommand {
  readonly publisher: StaffAccess;
  readonly reviewRequestId: string;
  readonly expectedResourceRevision: number;
  readonly correlationId: string;
}

export interface ResidentPublicationResult {
  readonly publicationEventId: string;
  readonly reviewRequestId: string;
  readonly reviewDecisionId: string;
  readonly targetRevisionId: string;
  readonly priorPublishedRevisionId: string | null;
  readonly resourceRevision: number;
  readonly consequential: boolean;
}

function requestModel(row: RequestRow): ResidentReviewRequest {
  return {
    id: row.id,
    organizationId: row.organization_id,
    targetRevisionId: row.target_revision_id,
    baselineRevisionId: row.baseline_revision_id,
    draftRevisionId: row.draft_revision_id,
    resourceRevision: row.resource_revision,
    authorizationRevision: row.authorization_revision,
    purpose: row.purpose,
    policyVersion: row.policy_version,
    classifierVersion: row.classifier_version,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
    supersedesRequestId: row.supersedes_request_id,
    changes: {
      changedFields: row.changed_fields,
      reasons: row.reasons,
      consequential: row.consequential,
    },
  };
}

function decisionModel(row: DecisionRow): ResidentReviewDecision {
  return {
    id: row.id,
    organizationId: row.organization_id,
    requestId: row.request_id,
    reviewerId: row.reviewer_id,
    outcome: row.outcome,
    decidedAt: row.decided_at,
    expiresAt: row.expires_at,
  };
}

/**
 * Internal reviewed-publication mutation. No controller is registered in 4C-1.
 * The only mutable operation is the resource published pointer; all content and
 * review evidence remain immutable and are linked by one publication event.
 */
@Injectable()
export class ResidentPublicationService {
  constructor(private readonly snapshots: ResidentExperienceRepository) {}

  async publish(
    command: ResidentPublicationCommand,
  ): Promise<ResidentPublicationResult> {
    if (
      !requestUuid.test(command.reviewRequestId) ||
      !requestUuid.test(command.correlationId) ||
      !Number.isSafeInteger(command.expectedResourceRevision) ||
      command.expectedResourceRevision < 1
    )
      throw new ConflictException('Resident publication is stale');

    try {
      return await requestTransaction(
        this.snapshots.database,
        command.publisher,
        ['admin.configuration.read'],
        async (trx, initialAccess) => {
          const resource = await trx
            .selectFrom('organization_resident_experience')
            .selectAll()
            .where('organization_id', '=', initialAccess.organizationId)
            .forUpdate()
            .executeTakeFirst();
          if (!resource) throw new NotFoundException();
          if (resource.revision !== command.expectedResourceRevision)
            throw new ConflictException('Resident experience changed');

          // Re-resolve after the resource lock. The authorization barrier held by
          // requestTransaction prevents concurrent persisted authority changes.
          const publisher = await resolveRequestAuthority(trx, initialAccess);
          assertResidentPublicationAuthority(publisher, false);

          // F060.3C-2d: the FOR UPDATE locks on the review request and
          // decision were removed. Single use is already a unique-index
          // invariant -- resident_approval_consumed on
          // (organization_id, review_decision_id) where operation='published'
          // -- and resident_publication_transition admits one publication per
          // resource revision. The resource row above is still locked FOR
          // UPDATE and its expected revision still checked, which serializes
          // concurrent publications of the same resource. Nothing anywhere
          // updates or deletes these two tables, so no writer was excluded.
          const request = await trx
            .selectFrom('resident_experience_review_request')
            .selectAll()
            .where('organization_id', '=', publisher.organizationId)
            .where('id', '=', command.reviewRequestId)
            .executeTakeFirst();
          if (!request) throw new NotFoundException();

          const decision = await trx
            .selectFrom('resident_experience_review_decision')
            .selectAll()
            .where('organization_id', '=', publisher.organizationId)
            .where('request_id', '=', request.id)
            .executeTakeFirst();
          if (!decision)
            throw new ConflictException('Resident approval is not usable');

          if (
            request.organization_id !== publisher.organizationId ||
            request.resource_revision !== resource.revision ||
            request.baseline_revision_id !== resource.published_revision_id ||
            (request.purpose === 'draft' &&
              request.draft_revision_id !== resource.draft_revision_id)
          )
            throw new ConflictException(
              'Resident approval is no longer usable',
            );

          const authority = await trx
            .selectFrom('organization_access_state')
            .select('authorization_revision')
            .where('organization_id', '=', publisher.organizationId)
            .executeTakeFirstOrThrow();
          const current: ResidentReviewBinding = {
            organizationId: publisher.organizationId,
            targetRevisionId: request.target_revision_id,
            baselineRevisionId: resource.published_revision_id,
            draftRevisionId: resource.draft_revision_id,
            resourceRevision: resource.revision,
            authorizationRevision: authority.authorization_revision,
            purpose: request.purpose,
            policyVersion: residentReviewPolicyVersion,
            classifierVersion: residentPublicationClassifierVersion,
          };

          const target = await this.snapshots.loadRevision(
            trx,
            publisher.organizationId,
            request.target_revision_id,
          );
          const baseline = resource.published_revision_id
            ? await this.snapshots.loadRevision(
                trx,
                publisher.organizationId,
                resource.published_revision_id,
              )
            : null;
          const changes = classifyResidentPublication(baseline, target);
          if (
            changes.consequential !== request.consequential ||
            JSON.stringify(changes.changedFields) !==
              JSON.stringify(request.changed_fields) ||
            JSON.stringify(changes.reasons) !== JSON.stringify(request.reasons)
          )
            throw new ConflictException(
              'Resident approval is no longer usable',
            );
          assertResidentPublicationAuthority(publisher, changes.consequential);

          const latest = await trx
            .selectFrom('resident_experience_review_request')
            .select('id')
            .where('organization_id', '=', publisher.organizationId)
            .orderBy('review_sequence', 'desc')
            .limit(1)
            .executeTakeFirst();
          const consumed = !!(await trx
            .selectFrom('resident_experience_event')
            .select('id')
            .where('organization_id', '=', publisher.organizationId)
            .where('review_decision_id', '=', decision.id)
            .where('operation', '=', 'published')
            .limit(1)
            .executeTakeFirst());
          const contributors = await sql<{ actor: string }>`
          select resident_review_contributors(
            ${publisher.organizationId}::uuid,
            ${request.target_revision_id}::uuid,
            ${request.baseline_revision_id}::uuid
          ) as actor
        `.execute(trx);
          const clock = await sql<{ now: Date; authorized: boolean }>`
          select clock_timestamp() as now,
            resident_review_authorized(
              ${publisher.organizationId}::uuid,
              ${decision.reviewer_id}::uuid,
              ${changes.consequential}
            ) as authorized
        `.execute(trx);
          const now = clock.rows[0]?.now;
          if (!now)
            throw new ConflictException(
              'Resident approval is no longer usable',
            );
          const usability = evaluateResidentApproval(
            requestModel(request),
            decisionModel(decision),
            current,
            {
              latestRequestId: latest?.id ?? null,
              excludedReviewers: contributors.rows.map((row) => row.actor),
              consumed,
              now,
              reviewerAuthorized: clock.rows[0]?.authorized === true,
              targetEligible:
                request.target_revision_id !== resource.published_revision_id &&
                (request.purpose === 'historical'
                  ? !!(await trx
                      .selectFrom('resident_experience_event')
                      .select('id')
                      .where('organization_id', '=', publisher.organizationId)
                      .where('new_revision_id', '=', request.target_revision_id)
                      .where('operation', '=', 'published')
                      .limit(1)
                      .executeTakeFirst())
                  : request.target_revision_id === resource.draft_revision_id),
              publisherId: publisher.staffIdentityId,
            },
          );
          if (decision.reviewer_id === publisher.staffIdentityId)
            throw new ConflictException(
              'Resident approval requires an independent publisher',
            );
          if (usability.reason === 'separation')
            throw new ConflictException(
              'Resident approval requires an independent publisher',
            );
          if (!usability.usable)
            throw new ConflictException(
              'Resident approval is no longer usable',
            );

          const nextRevision = resource.revision + 1;
          const eventId = randomUUID();
          await trx
            .insertInto('resident_experience_event')
            .values({
              id: eventId,
              organization_id: publisher.organizationId,
              actor_id: publisher.staffIdentityId,
              operation: 'published',
              prior_revision_id: resource.published_revision_id,
              new_revision_id: request.target_revision_id,
              prior_resource_revision: resource.revision,
              resource_revision: nextRevision,
              changed_fields: changes.changedFields,
              consequential: changes.consequential,
              reasons: changes.reasons,
              correlation_id: command.correlationId,
              review_request_id: request.id,
              review_decision_id: decision.id,
            })
            .executeTakeFirstOrThrow();
          await trx
            .updateTable('organization_resident_experience')
            .set({
              published_revision_id: request.target_revision_id,
              revision: nextRevision,
            })
            .where('organization_id', '=', publisher.organizationId)
            .where('revision', '=', resource.revision)
            .executeTakeFirstOrThrow();
          return {
            publicationEventId: eventId,
            reviewRequestId: request.id,
            reviewDecisionId: decision.id,
            targetRevisionId: request.target_revision_id,
            priorPublishedRevisionId: resource.published_revision_id,
            resourceRevision: nextRevision,
            consequential: changes.consequential,
          };
        },
      );
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'P0001' || error.code === '23505')
      )
        throw new ConflictException('Resident publication changed');
      throw error;
    }
  }
}

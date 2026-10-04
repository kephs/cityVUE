import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sql, type Selectable, type Transaction } from 'kysely';
import type { StaffAccess } from '../auth/auth.types.js';
import type { DatabaseSchema } from '../database/database.types.js';
import { requestTransaction } from '../service-request/request-authorization.js';
import { ResidentExperienceRepository } from './resident-experience.repository.js';
import { ResidentReviewRepository } from './resident-experience.review.repository.js';
import { projectPublishedResidentExperience } from './resident-experience.public.dto.js';
import {
  parseResidentReviewDecision,
  parseResidentReviewRequest,
  residentReviewId,
} from './resident-experience.review.input.js';
import {
  assertResidentPublicationAuthority,
  classifyResidentPublication,
  evaluateResidentApproval,
  residentPublicationClassifierVersion,
  residentReviewPolicyVersion,
  type ResidentReviewBinding,
  type ResidentReviewRequest,
  type ResidentReviewDecision,
  type ReviewPurpose,
} from './resident-experience.review.js';

type Trx = Transaction<DatabaseSchema>;
type RequestRow = Selectable<
  DatabaseSchema['resident_experience_review_request']
>;
type DecisionRow = Selectable<
  DatabaseSchema['resident_experience_review_decision']
>;
type Resource = Selectable<DatabaseSchema['organization_resident_experience']>;
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

/** Review-only commands. No publication/pointer writer is reachable from this service. */
@Injectable()
export class AdminResidentReviewService {
  private readonly reviews: ResidentReviewRepository;
  constructor(private readonly snapshots: ResidentExperienceRepository) {
    this.reviews = new ResidentReviewRepository(snapshots);
  }

  private async transaction<T>(
    access: StaffAccess,
    write: boolean,
    run: (trx: Trx, fresh: StaffAccess, resource: Resource) => Promise<T>,
  ) {
    try {
      return await requestTransaction(
        this.snapshots.database,
        access,
        ['admin.configuration.read'],
        async (trx, fresh) => {
          let query = trx
            .selectFrom('organization_resident_experience')
            .selectAll()
            .where('organization_id', '=', fresh.organizationId);
          query = write ? query.forUpdate() : query.forShare();
          const resource = await query.executeTakeFirst();
          if (!resource) throw new NotFoundException();
          return run(trx, fresh, resource);
        },
      );
    } catch (error) {
      // Constraint/trigger defense-in-depth failures never disclose raw PostgreSQL errors.
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error.code === 'P0001' || error.code === '23505')
      )
        throw new ConflictException(
          'Resident review changed; reload before reviewing',
        );
      throw error;
    }
  }
  private latest(trx: Trx, org: string) {
    return trx
      .selectFrom('resident_experience_review_request')
      .select('id')
      .where('organization_id', '=', org)
      .orderBy('review_sequence', 'desc')
      .limit(1)
      .executeTakeFirst();
  }
  private async findRequest(trx: Trx, org: string, id: string) {
    const row = await trx
      .selectFrom('resident_experience_review_request')
      .selectAll()
      .where('organization_id', '=', org)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new NotFoundException();
    return row;
  }
  private async binding(
    trx: Trx,
    resource: Resource,
    targetRevisionId: string,
    purpose: ReviewPurpose,
  ): Promise<ResidentReviewBinding> {
    const authority = await trx
      .selectFrom('organization_access_state')
      .select('authorization_revision')
      .where('organization_id', '=', resource.organization_id)
      .executeTakeFirstOrThrow();
    return {
      organizationId: resource.organization_id,
      targetRevisionId,
      purpose,
      resourceRevision: resource.revision,
      baselineRevisionId: resource.published_revision_id,
      draftRevisionId: resource.draft_revision_id,
      authorizationRevision: authority.authorization_revision,
      policyVersion: residentReviewPolicyVersion,
      classifierVersion: residentPublicationClassifierVersion,
    };
  }
  private async eligible(
    trx: Trx,
    resource: Resource,
    target: string,
    purpose: ReviewPurpose,
  ) {
    if (target === resource.published_revision_id) return false;
    if (purpose === 'draft') return target === resource.draft_revision_id;
    return !!(await trx
      .selectFrom('resident_experience_event')
      .select('id')
      .where('organization_id', '=', resource.organization_id)
      .where('new_revision_id', '=', target)
      .where('operation', '=', 'published')
      .limit(1)
      .executeTakeFirst());
  }
  private async evidence(trx: Trx, resource: Resource, row: RequestRow) {
    const model = requestModel(row);
    const current = await this.binding(
      trx,
      resource,
      row.target_revision_id,
      row.purpose,
    );
    const latest = await this.latest(trx, resource.organization_id);
    const decision = await trx
      .selectFrom('resident_experience_review_decision')
      .selectAll()
      .where('organization_id', '=', resource.organization_id)
      .where('request_id', '=', row.id)
      .executeTakeFirst();
    const consumed = !!(await trx
      .selectFrom('resident_experience_event')
      .select('id')
      .where('organization_id', '=', resource.organization_id)
      .where('review_request_id', '=', row.id)
      .where('operation', '=', 'published')
      .limit(1)
      .executeTakeFirst());
    const excludedReviewers = await this.reviews.contributors(
      trx,
      resource.organization_id,
      row.target_revision_id,
      row.baseline_revision_id,
    );
    const clock = await sql<{
      now: Date;
      authorized: boolean;
    }>`select clock_timestamp() as now,
      resident_publication_authorized(${resource.organization_id}::uuid, ${decision?.reviewer_id ?? null}::uuid, ${row.consequential}) as authorized`.execute(
      trx,
    );
    const facts = clock.rows[0];
    if (!facts) throw new ConflictException('Resident review unavailable');
    const state = {
      latestRequestId: latest?.id ?? null,
      excludedReviewers,
      consumed,
      now: facts.now,
      reviewerAuthorized: facts.authorized,
      targetEligible: await this.eligible(
        trx,
        resource,
        row.target_revision_id,
        row.purpose,
      ),
    };
    return {
      model,
      decision,
      current,
      state,
      usability: evaluateResidentApproval(
        model,
        decision ? decisionModel(decision) : null,
        current,
        state,
      ),
    };
  }
  private async projection(
    trx: Trx,
    fresh: StaffAccess,
    resource: Resource,
    row: RequestRow,
  ) {
    const evidence = await this.evidence(trx, resource, row);
    const { model, decision, state, usability } = evidence;
    const authorized =
      fresh.permissions.includes('resident_experience.publish') &&
      (!row.consequential ||
        fresh.permissions.includes('resident_experience.contact.manage'));
    return {
      id: model.id,
      targetRevisionId: model.targetRevisionId,
      baselineRevisionId: model.baselineRevisionId,
      draftRevisionId: model.draftRevisionId,
      resourceRevision: model.resourceRevision,
      purpose: model.purpose,
      policyVersion: model.policyVersion,
      classifierVersion: model.classifierVersion,
      createdAt: model.createdAt,
      supersedesRequestId: model.supersedesRequestId,
      latestRequestId: state.latestRequestId,
      changes: model.changes,
      decision: decision
        ? {
            id: decision.id,
            outcome: decision.outcome,
            decidedAt: decision.decided_at,
            expiresAt: decision.expires_at,
          }
        : null,
      usability,
      evaluatedAt: state.now,
      canReview:
        !decision &&
        usability.reason === 'pending' &&
        authorized &&
        !state.excludedReviewers.includes(fresh.staffIdentityId),
      independentPublisherRequired: true,
    };
  }

  context(access: StaffAccess) {
    return this.transaction(access, false, async (trx, fresh, resource) => ({
      resourceRevision: resource.revision,
      draftRevisionId: resource.draft_revision_id,
      publishedRevisionId: resource.published_revision_id,
      latestRequestId:
        (await this.latest(trx, fresh.organizationId))?.id ?? null,
    }));
  }
  revision(access: StaffAccess, revisionId: string) {
    const id = residentReviewId(revisionId);
    return this.transaction(access, false, async (trx, fresh, resource) => {
      const snapshot = await this.snapshots.loadRevision(
        trx,
        fresh.organizationId,
        id,
      );
      const baseline = resource.published_revision_id
        ? await this.snapshots.loadRevision(
            trx,
            fresh.organizationId,
            resource.published_revision_id,
          )
        : null;
      return {
        revisionId: id,
        resourceRevision: resource.revision,
        baselineRevisionId: resource.published_revision_id,
        currentDraft: id === resource.draft_revision_id,
        // Same presentation DTO as the protected Slice 3 preview. Clients must render in inert preview mode.
        unpublished: true,
        presentation: projectPublishedResidentExperience(snapshot),
        // Validated domain projection includes disabled items and structured contact
        // guidance that the public presentation deliberately omits. No persistence rows.
        review: snapshot,
        changes: classifyResidentPublication(baseline, snapshot),
        latestRequestId:
          (await this.latest(trx, fresh.organizationId))?.id ?? null,
      };
    });
  }
  get(access: StaffAccess, requestId: string) {
    const id = residentReviewId(requestId);
    return this.transaction(access, false, async (trx, fresh, resource) =>
      this.projection(
        trx,
        fresh,
        resource,
        await this.findRequest(trx, fresh.organizationId, id),
      ),
    );
  }
  create(access: StaffAccess, input: unknown) {
    const value = parseResidentReviewRequest(input);
    return this.transaction(access, true, async (trx, fresh, resource) => {
      if (
        !fresh.permissions.includes('resident_experience.write') &&
        !fresh.permissions.includes('resident_experience.publish')
      )
        throw new ForbiddenException('Access denied');
      // Resolve scoped identifiers before checking context, so inaccessible IDs always yield 404.
      await this.snapshots.loadRevision(
        trx,
        fresh.organizationId,
        value.targetRevisionId,
      );
      if (value.supersedesRequestId)
        await this.findRequest(
          trx,
          fresh.organizationId,
          value.supersedesRequestId,
        );
      const latest = await this.latest(trx, fresh.organizationId);
      if (
        resource.revision !== value.expectedRevision ||
        (latest?.id ?? null) !== value.supersedesRequestId ||
        !(await this.eligible(
          trx,
          resource,
          value.targetRevisionId,
          value.purpose,
        ))
      )
        throw new ConflictException(
          'Resident review changed; reload before requesting review',
        );
      const row = await this.reviews.insertRequest(
        trx,
        fresh,
        await this.binding(
          trx,
          resource,
          value.targetRevisionId,
          value.purpose,
        ),
        value.supersedesRequestId,
      );
      return this.projection(trx, fresh, resource, row);
    });
  }
  decide(access: StaffAccess, requestId: string, input: unknown) {
    const id = residentReviewId(requestId),
      value = parseResidentReviewDecision(input);
    return this.transaction(access, true, async (trx, fresh, resource) => {
      const row = await this.findRequest(trx, fresh.organizationId, id);
      assertResidentPublicationAuthority(fresh, row.consequential);
      const evidence = await this.evidence(trx, resource, row);
      if (
        resource.revision !== value.expectedRevision ||
        evidence.decision ||
        evidence.usability.reason !== 'pending'
      )
        throw new ConflictException(
          'Resident review changed; reload before deciding',
        );
      if (evidence.state.excludedReviewers.includes(fresh.staffIdentityId))
        throw new ForbiddenException('Independent resident review required');
      await this.reviews.insertDecision(
        trx,
        fresh,
        id,
        value.expectedRevision,
        value.outcome,
      );
      return this.projection(trx, fresh, resource, row);
    });
  }
}

import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from '../admin/admin-configuration.domain.js';
import {
  classifyResidentChanges,
  type ResidentChanges,
  type ResidentSnapshot,
} from './resident-experience.domain.js';

export const residentReviewPolicyVersion = 2 as const;
export const residentPublicationClassifierVersion = 1 as const;
export const residentApprovalLifetimeMs = 24 * 60 * 60 * 1000;
export type ReviewPurpose = 'draft' | 'historical';
export type ReviewOutcome = 'approved' | 'rejected';

/** Exact content + comparison + authorization context; no mutable draft payload. */
export interface ResidentReviewBinding {
  readonly organizationId: string;
  readonly targetRevisionId: string;
  readonly baselineRevisionId: string | null;
  readonly draftRevisionId: string | null;
  readonly resourceRevision: number;
  readonly authorizationRevision: string;
  readonly purpose: ReviewPurpose;
  readonly policyVersion: number;
  readonly classifierVersion: number;
}
export interface ResidentReviewRequest extends ResidentReviewBinding {
  readonly id: string;
  readonly requestedBy: string;
  readonly createdAt: Date;
  readonly supersedesRequestId: string | null;
  readonly changes: Readonly<{
    changedFields: readonly string[];
    reasons: readonly string[];
    consequential: boolean;
  }>;
}
export interface ResidentReviewDecision {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly reviewerId: string;
  readonly outcome: ReviewOutcome;
  readonly decidedAt: Date;
  readonly expiresAt: Date;
}

/** Publication comparison is separate from unchanged draft-save classification. */
export function classifyResidentPublication(
  published: ResidentSnapshot | null,
  target: ResidentSnapshot,
): ResidentChanges {
  const changes = classifyResidentChanges(published, target);
  return published
    ? changes
    : {
        ...changes,
        consequential: true,
        reasons: ['first_publication', ...changes.reasons],
      };
}

/** Review authority is independent of publication and editing authority. */
export function hasResidentReviewAuthority(
  access: StaffAccess,
  consequential: boolean,
): boolean {
  return (
    access.permissions.includes('admin.configuration.read') &&
    access.permissions.includes('resident_experience.review') &&
    (!consequential ||
      access.permissions.includes('resident_experience.contact.manage'))
  );
}
export function assertResidentReviewAuthority(
  access: StaffAccess,
  consequential: boolean,
): void {
  assertConfigurationRead(access);
  if (!hasResidentReviewAuthority(access, consequential))
    throw new ForbiddenException('Access denied');
}

export function assertResidentPublicationAuthority(
  access: StaffAccess,
  consequential: boolean,
) {
  assertConfigurationRead(access);
  if (!hasResidentPublicationAuthority(access, consequential)) {
    throw new ForbiddenException('Access denied');
  }
}

export function hasResidentPublicationAuthority(
  access: StaffAccess,
  consequential: boolean,
): boolean {
  return (
    access.permissions.includes('admin.configuration.read') &&
    access.permissions.includes('resident_experience.publish') &&
    (!consequential ||
      access.permissions.includes('resident_experience.contact.manage'))
  );
}

/** Advisory request authority. Request creation revalidates this under lock. */
export function hasResidentReviewRequestAuthority(
  access: StaffAccess,
  purpose: ReviewPurpose,
  consequential: boolean,
): boolean {
  if (!access.permissions.includes('admin.configuration.read')) return false;
  if (purpose === 'historical')
    return (
      access.permissions.includes('resident_experience.write') ||
      access.permissions.includes('resident_experience.publish')
    );
  return (
    access.permissions.includes('resident_experience.write') &&
    (!consequential ||
      access.permissions.includes('resident_experience.contact.manage'))
  );
}

export interface ResidentLineageEntry {
  readonly revisionId: string;
  readonly saverId: string;
  readonly consequential: boolean;
}
/** Inputs run newest to root, resolved by the Organization-scoped repository.
 * Exclude the target saver and consequential contributors on both divergent
 * branches, including changes being undone by historical republication.
 */
export function residentReviewContributors(
  candidate: readonly ResidentLineageEntry[],
  baseline: readonly ResidentLineageEntry[],
): readonly string[] {
  for (const chain of [candidate, baseline]) {
    if (
      chain.length > 10000 ||
      new Set(chain.map((r) => r.revisionId)).size !== chain.length
    )
      throw new ConflictException('Resident lineage unavailable');
  }
  if (!candidate[0])
    throw new ConflictException('Resident lineage unavailable');
  const baselineIds = new Set(baseline.map((r) => r.revisionId));
  const common = candidate.find((r) =>
    baselineIds.has(r.revisionId),
  )?.revisionId;
  const actors = new Set([candidate[0].saverId]);
  for (const chain of [candidate, baseline]) {
    for (const entry of chain) {
      if (entry.revisionId === common) break;
      if (entry.consequential) actors.add(entry.saverId);
    }
  }
  return [...actors].sort();
}

export interface ResidentApprovalState {
  readonly latestRequestId: string | null;
  /** Optional until an actual publisher is selected in Slice 4C. */
  readonly publisherId?: string;
  readonly excludedReviewers: readonly string[];
  readonly consumed: boolean;
  readonly now: Date;
  readonly reviewerAuthorized: boolean;
  readonly targetEligible: boolean;
}

/** One fail-closed evaluation, with current state resolved under the authority barrier.
 * A usable approval is not permission to publish; 4C must supply/authorize the publisher.
 */
export function evaluateResidentApproval(
  request: ResidentReviewRequest,
  decision: ResidentReviewDecision | null,
  current: ResidentReviewBinding,
  state: ResidentApprovalState,
): {
  usable: boolean;
  reason:
    | 'pending'
    | 'stale'
    | 'superseded'
    | 'rejected'
    | 'consumed'
    | 'expired'
    | 'authority'
    | 'separation'
    | null;
} {
  const fields = [
    'organizationId',
    'targetRevisionId',
    'baselineRevisionId',
    'draftRevisionId',
    'resourceRevision',
    'authorizationRevision',
    'purpose',
    'policyVersion',
    'classifierVersion',
  ] as const;
  if (
    fields.some((key) => request[key] !== current[key]) ||
    current.policyVersion !== residentReviewPolicyVersion ||
    current.classifierVersion !== residentPublicationClassifierVersion ||
    !state.targetEligible ||
    (request.purpose === 'draft' &&
      current.draftRevisionId !== request.targetRevisionId)
  )
    return { usable: false, reason: 'stale' };
  if (request.id !== state.latestRequestId)
    return { usable: false, reason: 'superseded' };
  if (!decision) return { usable: false, reason: 'pending' };
  if (
    decision.requestId !== request.id ||
    decision.organizationId !== request.organizationId
  )
    return { usable: false, reason: 'stale' };
  if (decision.outcome !== 'approved')
    return { usable: false, reason: 'rejected' };
  if (state.consumed) return { usable: false, reason: 'consumed' };
  const decided = decision.decidedAt.getTime(),
    now = state.now.getTime();
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(decided) ||
    now < decided ||
    now >= decided + residentApprovalLifetimeMs ||
    decision.expiresAt.getTime() !== decided + residentApprovalLifetimeMs
  ) {
    return { usable: false, reason: 'expired' };
  }
  if (!state.reviewerAuthorized) return { usable: false, reason: 'authority' };
  if (
    decision.reviewerId === state.publisherId ||
    state.excludedReviewers.includes(decision.reviewerId)
  )
    return { usable: false, reason: 'separation' };
  return { usable: true, reason: null };
}

/** Current pending/usable evidence blocks a duplicate; historical evidence does not. */
export function residentReviewAllowsReplacement(
  usability: ReturnType<typeof evaluateResidentApproval> | null,
): boolean {
  return !usability || (!usability.usable && usability.reason !== 'pending');
}

/** Advisory protected projection only. Publication revalidates under lock. */
export function canPublishResidentReview(
  access: StaffAccess,
  request: ResidentReviewRequest,
  decision: ResidentReviewDecision | null,
  usability: ReturnType<typeof evaluateResidentApproval>,
): boolean {
  return (
    decision?.outcome === 'approved' &&
    usability.usable &&
    access.organizationId === request.organizationId &&
    decision.organizationId === request.organizationId &&
    decision.reviewerId !== access.staffIdentityId &&
    hasResidentPublicationAuthority(access, request.changes.consequential)
  );
}

/** Assertion form of the same evaluation; callers must resolve all current facts. */
export function assertResidentApprovalUsable(
  request: ResidentReviewRequest,
  decision: ResidentReviewDecision,
  current: ResidentReviewBinding,
  state: ResidentApprovalState & { readonly publisherId: string },
): void {
  const result = evaluateResidentApproval(request, decision, current, state);
  if (result.reason === 'separation')
    throw new ForbiddenException('Independent resident review required');
  if (!result.usable)
    throw new ConflictException('Resident approval is no longer usable');
}

import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../auth/auth.types.js';
import { assertConfigurationRead } from '../admin/admin-configuration.domain.js';
import {
  classifyResidentChanges,
  type ResidentChanges,
  type ResidentSnapshot,
} from './resident-experience.domain.js';

export const residentReviewPolicyVersion = 1 as const;
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

export function assertResidentPublicationAuthority(
  access: StaffAccess,
  consequential: boolean,
) {
  assertConfigurationRead(access);
  if (
    !access.permissions.includes('resident_experience.publish') ||
    (consequential &&
      !access.permissions.includes('resident_experience.contact.manage'))
  ) {
    throw new ForbiddenException('Access denied');
  }
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

export function assertResidentApprovalUsable(
  request: ResidentReviewRequest,
  decision: ResidentReviewDecision,
  current: ResidentReviewBinding,
  state: {
    readonly latestRequestId: string;
    readonly publisherId: string;
    readonly excludedReviewers: readonly string[];
    readonly consumed: boolean;
    readonly now: Date;
  },
): void {
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
  const decided = decision.decidedAt.getTime(),
    now = state.now.getTime();
  if (
    fields.some((key) => request[key] !== current[key]) ||
    current.policyVersion !== residentReviewPolicyVersion ||
    current.classifierVersion !== residentPublicationClassifierVersion ||
    request.id !== state.latestRequestId ||
    decision.requestId !== request.id ||
    decision.organizationId !== request.organizationId ||
    decision.outcome !== 'approved' ||
    state.consumed ||
    !Number.isFinite(now) ||
    !Number.isFinite(decided) ||
    now < decided ||
    now >= decided + residentApprovalLifetimeMs ||
    decision.expiresAt.getTime() !== decided + residentApprovalLifetimeMs
  ) {
    throw new ConflictException('Resident approval is no longer usable');
  }
  if (
    decision.reviewerId === state.publisherId ||
    state.excludedReviewers.includes(decision.reviewerId)
  )
    throw new ForbiddenException('Independent resident review required');
}

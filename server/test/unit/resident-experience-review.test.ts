import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import {
  accessPermissionMetadata,
  manageablePermissions,
} from '../../src/access/access-policy.js';
import { assertResidentDraftWrite } from '../../src/resident-experience/resident-experience.admin.service.js';
import { classifyResidentChanges } from '../../src/resident-experience/resident-experience.domain.js';
import {
  assertResidentApprovalUsable,
  assertResidentPublicationAuthority,
  classifyResidentPublication,
  residentApprovalLifetimeMs,
  residentReviewContributors,
  evaluateResidentApproval,
  type ResidentReviewRequest,
  type ResidentReviewDecision,
} from '../../src/resident-experience/resident-experience.review.js';
import {
  parseResidentReviewRequest,
  parseResidentReviewDecision,
  residentReviewId,
} from '../../src/resident-experience/resident-experience.review.input.js';
import { phoneFixture } from '../helpers/resident-experience.fixture.js';

const request: ResidentReviewRequest = {
  id: 'request',
  organizationId: 'org',
  targetRevisionId: 'target',
  baselineRevisionId: 'baseline',
  draftRevisionId: 'target',
  resourceRevision: 3,
  authorizationRevision: '10',
  purpose: 'draft',
  policyVersion: 1,
  classifierVersion: 1,
  requestedBy: 'author',
  createdAt: new Date(0),
  supersedesRequestId: null,
  changes: {
    consequential: true,
    changedFields: ['contacts'],
    reasons: ['contacts_changed'],
  },
};
const decision: ResidentReviewDecision = {
  id: 'decision',
  organizationId: 'org',
  requestId: 'request',
  reviewerId: 'reviewer',
  outcome: 'approved',
  decidedAt: new Date(1000),
  expiresAt: new Date(1000 + residentApprovalLifetimeMs),
};
const state = {
  reviewerAuthorized: true,
  targetEligible: true,
  latestRequestId: 'request',
  publisherId: 'publisher',
  excludedReviewers: ['author'],
  consumed: false,
  now: new Date(2000),
};
test('usability projection fails closed on fresh authority, eligibility and immutable decision state', () => {
  const facts = { ...state, reviewerAuthorized: true, targetEligible: true };
  assert.deepEqual(
    evaluateResidentApproval(request, decision, request, facts),
    { usable: true, reason: null },
  );
  for (const [change, reason] of [
    [{ reviewerAuthorized: false }, 'authority'],
    [{ targetEligible: false }, 'stale'],
    [{ latestRequestId: 'new' }, 'superseded'],
    [{ consumed: true }, 'consumed'],
    [{ publisherId: 'reviewer' }, 'separation'],
    [{ excludedReviewers: ['reviewer'] }, 'separation'],
    [{ now: decision.expiresAt }, 'expired'],
    [{ now: new Date(NaN) }, 'expired'],
  ] as const)
    assert.deepEqual(
      evaluateResidentApproval(request, decision, request, {
        ...facts,
        ...change,
      }),
      { usable: false, reason },
    );
  assert.equal(
    evaluateResidentApproval(request, null, request, facts).reason,
    'pending',
  );
  assert.equal(
    evaluateResidentApproval(
      request,
      { ...decision, outcome: 'rejected' },
      request,
      facts,
    ).reason,
    'rejected',
  );
  const noLongerDraft = { ...request, draftRevisionId: 'other' };
  assert.equal(
    evaluateResidentApproval(noLongerDraft, decision, noLongerDraft, facts)
      .reason,
    'stale',
  );
  for (const key of [
    'organizationId',
    'targetRevisionId',
    'baselineRevisionId',
    'draftRevisionId',
    'resourceRevision',
    'authorizationRevision',
    'purpose',
    'policyVersion',
    'classifierVersion',
  ]) {
    assert.equal(
      evaluateResidentApproval(
        request,
        decision,
        { ...request, [key]: 'changed' },
        facts,
      ).usable,
      false,
    );
  }
});
test('strict review bodies reject caller identity, baseline, classification and clock overrides', () => {
  const input = {
    targetRevisionId: '00000000-0000-4000-8000-000000000059',
    expectedRevision: 2,
    purpose: 'draft',
    supersedesRequestId: null,
  };
  assert.equal(parseResidentReviewRequest(input).purpose, 'draft');
  for (const key of [
    'organizationId',
    'requestedBy',
    'baselineRevisionId',
    'consequential',
    'policyVersion',
    'authorizationRevision',
    'createdAt',
  ])
    assert.throws(() =>
      parseResidentReviewRequest({ ...input, [key]: 'forged' }),
    );
  for (const value of [
    null,
    [],
    {},
    { ...input, expectedRevision: '2' },
    { ...input, expectedRevision: 0 },
    { ...input, purpose: 'publish' },
    { ...input, targetRevisionId: 'wrong' },
    { ...input, supersedesRequestId: undefined },
  ])
    assert.throws(() => parseResidentReviewRequest(value));
  for (const outcome of ['approved', 'rejected'])
    assert.equal(
      parseResidentReviewDecision({ expectedRevision: 2, outcome }).outcome,
      outcome,
    );
  for (const value of [
    { expectedRevision: 2, outcome: 'pending' },
    { expectedRevision: 2, outcome: 'approved', reviewerId: 'forged' },
    { expectedRevision: 2, outcome: 'approved', decidedAt: 'forged' },
  ])
    assert.throws(() => parseResidentReviewDecision(value));
  assert.throws(() => residentReviewId('invalid'));
});
test('publication classification preserves draft classifier and marks every first publication consequential', () => {
  const original = phoneFixture(),
    next = structuredClone(original);
  next.presentation.hero.alt = '';
  next.presentation.branding.applicationName = 'Changed';
  assert.equal(
    classifyResidentPublication(original, next).consequential,
    false,
  );
  assert.deepEqual(
    classifyResidentPublication(original, next),
    classifyResidentChanges(original, next),
  );
  assert.equal(
    classifyResidentPublication(null, next).reasons[0],
    'first_publication',
  );
  assert.ok(
    !classifyResidentChanges(null, next).reasons.includes('first_publication'),
  );
});
test('contact reviewers need no edit grant; draft enforcement and frozen delegation are unchanged', () => {
  const access: StaffAccess = {
    organizationId: '00000000-0000-4000-8000-000000000059',
    staffIdentityId: '00000000-0000-4000-8000-000000000058',
    tenantId: 'tenant',
    objectId: 'object',
    displayName: 'Synthetic',
    development: false,
    scopes: [],
    departmentIds: [],
    divisionIds: [],
    permissions: [
      'admin.configuration.read',
      'resident_experience.publish',
      'resident_experience.contact.manage',
    ],
  };
  assert.deepEqual(
    accessPermissionMetadata['resident_experience.contact.manage'].requires,
    ['admin.configuration.read'],
  );
  assert.equal(manageablePermissions.length, 27);
  assert.doesNotThrow(() => {
    assertResidentPublicationAuthority(access, true);
  });
  assert.throws(() => {
    assertResidentDraftWrite(access, {
      changedFields: ['contacts'],
      reasons: ['contacts_changed'],
      consequential: true,
    });
  }, ForbiddenException);
  for (const missing of [
    'admin.configuration.read',
    'resident_experience.publish',
    'resident_experience.contact.manage',
  ])
    assert.throws(() => {
      assertResidentPublicationAuthority(
        {
          ...access,
          permissions: access.permissions.filter((p) => p !== missing),
        },
        true,
      );
    }, ForbiddenException);
});
test('exact binding, policy and authorization context are all required', () => {
  assert.doesNotThrow(() => {
    assertResidentApprovalUsable(request, decision, request, state);
  });
  const changes = {
    organizationId: 'other',
    targetRevisionId: 'other',
    baselineRevisionId: 'other',
    draftRevisionId: 'other',
    resourceRevision: 4,
    authorizationRevision: '11',
    purpose: 'historical',
    policyVersion: 2,
    classifierVersion: 2,
  };
  for (const [key, value] of Object.entries(changes))
    assert.throws(() => {
      assertResidentApprovalUsable(
        request,
        decision,
        { ...request, [key]: value },
        state,
      );
    }, ConflictException);
});
test('approval has a strict 24-hour window with no future or invalid timestamps', () => {
  for (const offset of [0, residentApprovalLifetimeMs - 1])
    assert.doesNotThrow(() => {
      assertResidentApprovalUsable(request, decision, request, {
        ...state,
        now: new Date(1000 + offset),
      });
    });
  for (const time of [999, 1000 + residentApprovalLifetimeMs, NaN])
    assert.throws(() => {
      assertResidentApprovalUsable(request, decision, request, {
        ...state,
        now: new Date(time),
      });
    }, ConflictException);
  assert.throws(() => {
    assertResidentApprovalUsable(
      request,
      { ...decision, expiresAt: new Date(999999999) },
      request,
      state,
    );
  }, ConflictException);
});
test('rejection, supersession, consumption, wrong decision and separation fail closed', () => {
  for (const changed of [
    { ...decision, outcome: 'rejected' as const },
    { ...decision, organizationId: 'other' },
    { ...decision, requestId: 'other' },
  ])
    assert.throws(() => {
      assertResidentApprovalUsable(request, changed, request, state);
    }, ConflictException);
  for (const changed of [
    { ...state, consumed: true },
    { ...state, latestRequestId: 'new' },
  ])
    assert.throws(() => {
      assertResidentApprovalUsable(request, decision, request, changed);
    }, ConflictException);
  for (const reviewerId of ['publisher', 'author'])
    assert.throws(() => {
      assertResidentApprovalUsable(
        request,
        { ...decision, reviewerId },
        request,
        state,
      );
    }, ForbiddenException);
});
test('cosmetic saves cannot launder consequential authorship; historical reversal excludes divergent contributors', () => {
  const root = { revisionId: 'root', saverId: 'old', consequential: true };
  const candidate = [
    {
      revisionId: 'cosmetic',
      saverId: 'cosmetic-author',
      consequential: false,
    },
    { revisionId: 'contact', saverId: 'contact-author', consequential: true },
    root,
  ];
  assert.deepEqual(residentReviewContributors(candidate, [root]), [
    'contact-author',
    'cosmetic-author',
  ]);
  assert.deepEqual(residentReviewContributors([root], candidate), [
    'contact-author',
    'old',
  ]);
  assert.deepEqual(residentReviewContributors(candidate, []), [
    'contact-author',
    'cosmetic-author',
    'old',
  ]);
  assert.throws(() => residentReviewContributors([], []), ConflictException);
  assert.throws(
    () => residentReviewContributors([root, root], []),
    ConflictException,
  );
});

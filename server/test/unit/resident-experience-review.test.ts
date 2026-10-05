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
  assertResidentReviewAuthority,
  hasResidentReviewAuthority,
  canPublishResidentReview,
  classifyResidentPublication,
  residentApprovalLifetimeMs,
  residentReviewContributors,
  evaluateResidentApproval,
  hasResidentReviewRequestAuthority,
  residentReviewAllowsReplacement,
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
  policyVersion: 2,
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
test('replacement uses current usability, including exact expiry, not the old decision outcome', () => {
  const evaluate = (current = request, facts = state, approved = decision) =>
    evaluateResidentApproval(request, approved, current, facts);
  assert.equal(residentReviewAllowsReplacement(null), true);
  assert.equal(residentReviewAllowsReplacement(evaluate()), false);
  assert.equal(
    residentReviewAllowsReplacement(
      evaluateResidentApproval(request, null, request, state),
    ),
    false,
  );
  assert.equal(
    residentReviewAllowsReplacement(
      evaluate({
        ...request,
        resourceRevision: 8,
        draftRevisionId: 'revision-8',
      }),
    ),
    true,
  );
  assert.equal(
    residentReviewAllowsReplacement(
      evaluate(request, {
        ...state,
        now: decision.expiresAt,
      }),
    ),
    true,
  );
  assert.equal(
    residentReviewAllowsReplacement(
      evaluate(request, {
        ...state,
        consumed: true,
      }),
    ),
    true,
  );
  assert.equal(
    residentReviewAllowsReplacement(
      evaluate(request, {
        ...state,
        latestRequestId: 'new-request',
      }),
    ),
    true,
  );
  assert.equal(
    residentReviewAllowsReplacement(
      evaluate(request, state, {
        ...decision,
        outcome: 'rejected',
      }),
    ),
    true,
  );
});
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
      'resident_experience.review',
      'resident_experience.contact.manage',
    ],
  };
  assert.deepEqual(
    accessPermissionMetadata['resident_experience.contact.manage'].requires,
    ['admin.configuration.read'],
  );
  assert.equal(manageablePermissions.length, 27);
  assert.doesNotThrow(() => {
    assertResidentReviewAuthority(access, true);
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
    'resident_experience.review',
    'resident_experience.contact.manage',
  ])
    assert.throws(() => {
      assertResidentReviewAuthority(
        {
          ...access,
          permissions: access.permissions.filter((p) => p !== missing),
        },
        true,
      );
    }, ForbiddenException);
});
test('draft review requests require editor authority while historical request authority remains supported', () => {
  const base: StaffAccess = {
    organizationId: '00000000-0000-4000-8000-000000000059',
    staffIdentityId: '00000000-0000-4000-8000-000000000058',
    tenantId: 'tenant',
    objectId: 'object',
    displayName: 'Synthetic',
    development: false,
    scopes: [],
    departmentIds: [],
    divisionIds: [],
    permissions: ['admin.configuration.read'],
  };
  const withPermissions = (...permissions: StaffAccess['permissions']) => ({
    ...base,
    permissions: [...base.permissions, ...permissions],
  });
  assert.equal(
    hasResidentReviewRequestAuthority(
      withPermissions('resident_experience.write'),
      'draft',
      false,
    ),
    true,
  );
  assert.equal(
    hasResidentReviewRequestAuthority(
      withPermissions('resident_experience.write'),
      'draft',
      true,
    ),
    false,
  );
  assert.equal(
    hasResidentReviewRequestAuthority(
      withPermissions(
        'resident_experience.write',
        'resident_experience.contact.manage',
      ),
      'draft',
      true,
    ),
    true,
  );
  for (const permissions of [
    ['resident_experience.publish'],
    ['resident_experience.publish', 'resident_experience.contact.manage'],
  ] as const)
    assert.equal(
      hasResidentReviewRequestAuthority(
        withPermissions(...permissions),
        'draft',
        false,
      ),
      false,
    );
  assert.equal(
    hasResidentReviewRequestAuthority(
      withPermissions('resident_experience.publish'),
      'historical',
      false,
    ),
    true,
  );
  assert.equal(
    hasResidentReviewRequestAuthority(
      withPermissions('resident_experience.write'),
      'historical',
      true,
    ),
    true,
  );
});
test('publish projection is advisory, authority-aware and fail-closed for review state', () => {
  const publisher: StaffAccess = {
    organizationId: 'org',
    staffIdentityId: 'publisher',
    tenantId: 'tenant',
    objectId: 'object',
    displayName: 'Synthetic publisher',
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
  const usable = { usable: true, reason: null } as const;
  assert.equal(
    canPublishResidentReview(publisher, request, decision, usable),
    true,
  );
  assert.equal(
    canPublishResidentReview(
      { ...publisher, staffIdentityId: decision.reviewerId },
      request,
      decision,
      usable,
    ),
    false,
  );
  for (const missing of [
    'admin.configuration.read',
    'resident_experience.publish',
    'resident_experience.contact.manage',
  ] as const)
    assert.equal(
      canPublishResidentReview(
        {
          ...publisher,
          permissions: publisher.permissions.filter((key) => key !== missing),
        },
        request,
        decision,
        usable,
      ),
      false,
    );
  const ordinary = {
    ...request,
    changes: { ...request.changes, consequential: false },
  };
  assert.equal(
    canPublishResidentReview(
      {
        ...publisher,
        permissions: publisher.permissions.filter(
          (key) => key !== 'resident_experience.contact.manage',
        ),
      },
      ordinary,
      decision,
      usable,
    ),
    true,
  );
  assert.equal(
    publisher.permissions.includes('resident_experience.write'),
    false,
  );
  for (const reason of [
    'rejected',
    'expired',
    'superseded',
    'consumed',
  ] as const)
    assert.equal(
      canPublishResidentReview(publisher, request, decision, {
        usable: false,
        reason,
      }),
      false,
    );
  assert.equal(
    canPublishResidentReview(
      publisher,
      request,
      { ...decision, outcome: 'rejected' },
      { usable: false, reason: 'rejected' },
    ),
    false,
  );
  assert.equal(
    canPublishResidentReview(
      { ...publisher, organizationId: 'other' },
      request,
      decision,
      usable,
    ),
    false,
  );
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
    policyVersion: 3,
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

test('policy 2 separates review and publication without write authority or delegation expansion', () => {
  const base: StaffAccess = {
    organizationId: '00000000-0000-4000-8000-000000000059',
    staffIdentityId: '00000000-0000-4000-8000-000000000058',
    tenantId: 'tenant',
    objectId: 'object',
    displayName: 'Synthetic',
    development: false,
    scopes: [],
    departmentIds: [],
    divisionIds: [],
    permissions: [],
  };
  const reviewer: StaffAccess = {
    ...base,
    permissions: [
      'admin.configuration.read',
      'resident_experience.review',
      'resident_experience.contact.manage',
    ],
  };
  const publisher: StaffAccess = {
    ...base,
    permissions: [
      'admin.configuration.read',
      'resident_experience.publish',
      'resident_experience.contact.manage',
    ],
  };
  assert.doesNotThrow(() => {
    assertResidentReviewAuthority(reviewer, true);
  });
  assert.throws(() => {
    assertResidentPublicationAuthority(reviewer, true);
  }, ForbiddenException);
  assert.doesNotThrow(() => {
    assertResidentPublicationAuthority(publisher, true);
  });
  assert.throws(() => {
    assertResidentReviewAuthority(publisher, true);
  }, ForbiddenException);
  assert.equal(
    hasResidentReviewRequestAuthority(reviewer, 'draft', true),
    false,
  );
  assert.equal(
    hasResidentReviewRequestAuthority(publisher, 'draft', true),
    false,
  );
  for (const missing of [
    'admin.configuration.read',
    'resident_experience.review',
    'resident_experience.contact.manage',
  ])
    assert.equal(
      hasResidentReviewAuthority(
        {
          ...reviewer,
          permissions: reviewer.permissions.filter((p) => p !== missing),
        },
        true,
      ),
      false,
    );
  assert.equal(
    hasResidentReviewAuthority(
      {
        ...reviewer,
        permissions: ['admin.configuration.read', 'resident_experience.review'],
      },
      false,
    ),
    true,
  );
  const metadata = accessPermissionMetadata['resident_experience.review'];
  assert.deepEqual(metadata.requires, ['admin.configuration.read']);
  assert.equal(metadata.sensitive, true);
  assert.equal(metadata.classification, 'provisioning-only');
  assert.equal(
    manageablePermissions.includes('resident_experience.review'),
    false,
  );
});
test('retained policy 1 pending and approved evidence cannot be revived under policy 2', () => {
  const legacy = { ...request, policyVersion: 1 };
  for (const outcome of [null, decision]) {
    assert.deepEqual(
      evaluateResidentApproval(legacy, outcome, request, state),
      { usable: false, reason: 'stale' },
    );
    assert.deepEqual(evaluateResidentApproval(legacy, outcome, legacy, state), {
      usable: false,
      reason: 'stale',
    });
  }
});

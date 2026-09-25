import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertIssueWrite,
  issueText,
  validateIssue,
} from '../../src/admin/admin-issue.domain.js';
import { permissions, type StaffAccess } from '../../src/auth/auth.types.js';
import { developmentStaffBundles } from '../../src/database/development-staff-input.js';
const base: StaffAccess = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  staffIdentityId: '10000000-0000-4000-8000-000000000002',
  tenantId: 'tenant',
  objectId: 'actor',
  displayName: 'Fictional',
  scopes: [],
  permissions: [],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
const create = {
  availability: 'INTERNAL_AND_EXTERNAL',
  name: 'Fictional',
  description: 'Short description',
  displayOrder: 0,
  requesterPolicy: 'IDENTIFIED_REQUIRED',
  defaultAssignment: null,
  templateId: '10000000-0000-4000-8000-000000000003',
};
test('F056 requires independent trusted Admin read and Issue write without default bundles', () => {
  for (const p of permissions)
    assert.throws(() => {
      assertIssueWrite({ ...base, permissions: [p] });
    });
  assert.doesNotThrow(() => {
    assertIssueWrite({
      ...base,
      permissions: ['admin.configuration.read', 'admin.issues.write'],
    });
  });
  assert.throws(() => {
    assertIssueWrite({
      ...base,
      development: true,
      permissions: ['admin.configuration.read', 'admin.issues.write'],
    });
  });
  for (const bundle of Object.values(developmentStaffBundles))
    assert.ok(!(bundle as readonly string[]).includes('admin.issues.write'));
});
test('F056 names/descriptions are bounded, trimmed safe Unicode and never executable markup', () => {
  assert.equal(issueText('\u3000Café\u00a0', true), 'Café');
  assert.equal(issueText('line one\nline two', false), 'line one\nline two');
  for (const v of [
    '',
    ' ',
    '<script>bad</script>',
    '\ud800',
    'a\u202e',
    'x'.repeat(201),
    null,
  ])
    assert.throws(() => issueText(v, true));
  assert.equal(issueText('', false), '');
  assert.throws(() => issueText('x'.repeat(1001), false));
});
test('F056 create rejects authority, active forgery, unrelated fields and unsafe targets', () => {
  assert.doesNotThrow(() => {
    validateIssue(create, true);
  });
  for (const key of [
    'organizationId',
    'active',
    'privacyThreshold',
    'participationAreas',
    'analyticsPermission',
    'workflow',
    'sla',
    'coordinates',
    'requesterId',
    'tracking',
  ])
    assert.throws(() => {
      validateIssue({ ...create, [key]: true }, true);
    });
  for (const target of [
    '',
    {},
    {
      type: 'staff',
      id: create.templateId,
      organizationId: base.organizationId,
    },
    { type: 'user', id: create.templateId },
  ])
    assert.throws(() => {
      validateIssue({ ...create, defaultAssignment: target }, true);
    });
  for (const order of [-1, 0.5, '1', 2147483648])
    assert.throws(() => {
      validateIssue({ ...create, displayOrder: order }, true);
    });
});
test('F056 edit requires each independent expected revision, no generalized revision', () => {
  const { templateId, availability, ...fields } = create;
  void templateId;
  void availability;
  const edit = {
    ...fields,
    active: false,
    expectedCoreRevision: 1,
    expectedActionRevision: 1,
    expectedPolicyRevision: 0,
    expectedAssignmentRevision: 0,
  };
  assert.doesNotThrow(() => {
    validateIssue(edit, false);
  });
  for (const key of [
    'expectedCoreRevision',
    'expectedActionRevision',
    'expectedPolicyRevision',
    'expectedAssignmentRevision',
  ]) {
    const body: Record<string, unknown> = { ...edit };
    const incomplete = Object.fromEntries(
      Object.entries(body).filter(([name]) => name !== key),
    );
    assert.throws(() => {
      validateIssue(incomplete, false);
    });
  }
  assert.throws(() => {
    validateIssue({ ...edit, expectedRevision: 1 }, false);
  });
});

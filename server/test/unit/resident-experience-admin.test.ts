import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { assertResidentDraftWrite } from '../../src/resident-experience/resident-experience.admin.service.js';
import { classifyResidentChanges } from '../../src/resident-experience/resident-experience.domain.js';
import { phoneFixture } from '../helpers/resident-experience.fixture.js';
import {
  accessPermissionMetadata,
  manageablePermissions,
} from '../../src/access/access-policy.js';
import { residentPermissionKeys } from '../../migrations/20261012000000-register-resident-experience-permissions.js';
import {
  developmentStaffPermissions,
  developmentStaffBundles,
} from '../../src/database/development-staff-input.js';
const access: StaffAccess = {
  organizationId: '00000000-0000-4000-8000-000000000059',
  staffIdentityId: '00000000-0000-4000-8000-000000000058',
  tenantId: 'tenant',
  objectId: 'object',
  displayName: 'Synthetic',
  permissions: ['admin.configuration.read', 'resident_experience.write'],
  departmentIds: [],
  divisionIds: [],
  scopes: [],
  development: false,
};
test('resident draft permission registrations do not change runtime delegation or provisioning bundles', () => {
  for (const key of [
    ...residentPermissionKeys,
    'resident_experience.review',
  ] as const) {
    assert.equal(
      accessPermissionMetadata[key].classification,
      'provisioning-only',
    );
    assert.ok(!manageablePermissions.includes(key));
    assert.ok((developmentStaffPermissions as readonly string[]).includes(key));
    for (const bundle of Object.values(developmentStaffBundles))
      assert.ok(!(bundle as readonly string[]).includes(key));
  }
  assert.equal(manageablePermissions.length, 27);
});
test('ordinary copy requires Admin admission and write, never publish alone or fallback identity', () => {
  const before = phoneFixture(),
    after = structuredClone(before);
  after.presentation.branding.applicationName = 'Ordinary copy';
  const changes = classifyResidentChanges(before, after);
  assert.equal(changes.consequential, false);
  assert.doesNotThrow(() => {
    assertResidentDraftWrite(access, changes);
  });
  for (const permissions of [
    [],
    ['admin.configuration.read'],
    ['resident_experience.write'],
    ['resident_experience.publish'],
  ] as StaffAccess['permissions'][])
    assert.throws(() => {
      assertResidentDraftWrite({ ...access, permissions }, changes);
    }, ForbiddenException);
  assert.throws(() => {
    assertResidentDraftWrite({ ...access, development: true }, changes);
  }, ForbiddenException);
  assert.throws(() => {
    assertResidentDraftWrite({ ...access, tenantId: null }, changes);
  }, ForbiddenException);
});
test('server-derived contact, action, guidance and destination changes need both authorities', () => {
  const before = phoneFixture();
  for (const mutate of [
    (s: typeof before) => {
      assert.ok(s.contacts[0]);
      s.contacts[0].guidance = 'Changed';
    },
    (s: typeof before) => {
      assert.ok(s.actions[0]);
      s.actions[0].enabled = false;
    },
    (s: typeof before) => {
      assert.ok(s.presentation.navigation.links[0]);
      s.presentation.navigation.links[0].target = '/report';
    },
    (s: typeof before) => {
      s.presentation.footer.links = [
        {
          id: 'report',
          label: 'Report',
          actionType: 'internal',
          target: '/report',
        },
      ];
    },
  ]) {
    const after = structuredClone(before);
    mutate(after);
    const changes = classifyResidentChanges(before, after);
    assert.equal(changes.consequential, true);
    assert.throws(() => {
      assertResidentDraftWrite(access, changes);
    }, ForbiddenException);
    assert.doesNotThrow(() => {
      assertResidentDraftWrite(
        {
          ...access,
          permissions: [
            ...access.permissions,
            'resident_experience.contact.manage',
          ],
        },
        changes,
      );
    });
  }
});

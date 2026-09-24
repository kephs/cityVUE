import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  assertConfigurationRead,
  configurationPage,
  participationHealth,
} from '../../src/admin/admin-configuration.domain.js';
import { permissions, type StaffAccess } from '../../src/auth/auth.types.js';
import {
  developmentStaffBundles,
  developmentStaffPermissions,
} from '../../src/database/development-staff-input.js';
import { assertStaffRequestPermission } from '../../src/service-request/staff-request-scope.js';

const access: StaffAccess = {
  organizationId: randomUUID(),
  staffIdentityId: randomUUID(),
  tenantId: randomUUID(),
  objectId: randomUUID(),
  displayName: 'Fictional admin',
  permissions: ['admin.configuration.read'],
  scopes: ['access_as_user'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
test('F052 explicit permission is independent in both directions and no broad bundle grants it', () => {
  assertConfigurationRead(access);
  for (const permission of permissions.filter(
    (p) => p !== 'admin.configuration.read',
  )) {
    assert.throws(() => {
      assertConfigurationRead({ ...access, permissions: [permission] });
    });
    assert.throws(() => {
      assertStaffRequestPermission(access, permission);
    });
  }
  for (const bundle of Object.values(developmentStaffBundles))
    assert.ok(
      !bundle.some((p) => (p as string) === 'admin.configuration.read'),
    );
  assert.ok(developmentStaffPermissions.includes('admin.configuration.read'));
  for (const invalid of [
    undefined,
    { ...access, development: true },
    { ...access, tenantId: null },
    { ...access, objectId: null },
  ])
    assert.throws(() => {
      assertConfigurationRead(invalid);
    });
});
test('F052 pages reject forged/unbounded input and health does not invent warnings when collection is disabled', () => {
  assert.equal(configurationPage(undefined), 1);
  assert.equal(configurationPage('2'), 2);
  for (const v of ['0', '-1', '1.5', '1000000', 'NaN', '1 OR 1=1'])
    assert.throws(() => configurationPage(v));
  assert.equal(participationHealth(false, 0).severity, 'OK');
  assert.equal(participationHealth(true, 0).severity, 'WARNING');
  assert.equal(participationHealth(true, 3).severity, 'OK');
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSync } from 'class-validator';
import { CollectionChangeDto } from '../../src/admin/admin-intake-settings.controller.js';
import { assertIntakeSettingsWrite } from '../../src/admin/admin-intake-settings.service.js';
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
test('F053 requires independent read and write; existing capabilities and bundles cannot grant it', () => {
  for (const permission of permissions)
    assert.throws(() => {
      assertIntakeSettingsWrite({ ...base, permissions: [permission] });
    });
  assert.doesNotThrow(() => {
    assertIntakeSettingsWrite({
      ...base,
      permissions: ['admin.configuration.read', 'admin.intake_settings.write'],
    });
  });
  assert.throws(() => {
    assertIntakeSettingsWrite({
      ...base,
      development: true,
      permissions: ['admin.configuration.read', 'admin.intake_settings.write'],
    });
  });
  for (const bundle of Object.values(developmentStaffBundles))
    assert.ok(
      !(bundle as readonly string[]).includes('admin.intake_settings.write'),
    );
});
test('F053 DTO rejects unknown fields, coercion, missing and out-of-range revisions', () => {
  const check = (body: object) =>
    validateSync(Object.assign(new CollectionChangeDto(), body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
  assert.equal(check({ enabled: false, expectedRevision: 1 }).length, 0);
  for (const value of [undefined, null, -1, 0, 1.2, '1', 2147483648, Infinity])
    assert.ok(check({ enabled: true, expectedRevision: value }).length);
  for (const value of [undefined, null, 'true', 1, {}])
    assert.ok(check({ enabled: value, expectedRevision: 1 }).length);
  for (const key of [
    'organizationId',
    'privacyThreshold',
    'participationAreas',
    'issuePolicy',
  ])
    assert.ok(
      check({ enabled: true, expectedRevision: 1, [key]: 'forged' }).length,
    );
});

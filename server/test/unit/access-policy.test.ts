import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { permissions, type StaffAccess } from '../../src/auth/auth.types.js';
import {
  accessPermissionMetadata,
  accessPrerequisites,
  assertAccessAuthority,
  manageablePermissions,
  validateAccessDependencies,
  validateManagedPermissions,
} from '../../src/access/access-policy.js';
import { managedPermissionKeys } from '../../migrations/20261008000000-add-administrative-access-foundation.js';
import { recognizedPermissions } from '../../src/auth/effective-permissions.js';
import { developmentStaffPermissions } from '../../src/database/development-staff-input.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const access: StaffAccess = {
  tenantId: 'tenant',
  objectId: 'object',
  staffIdentityId: 'staff',
  organizationId: 'org',
  displayName: 'Synthetic',
  development: false,
  scopes: [],
  permissions: [...accessPrerequisites],
  departmentIds: [],
  divisionIds: [],
};
test('F057 permission classification is exhaustive and frozen database parity holds', () => {
  assert.equal(permissions.length, 32);
  assert.equal(manageablePermissions.length, 27);
  assert.equal(
    developmentStaffPermissions.some(
      (p) =>
        (p as string) === 'admin.access.read' ||
        (p as string) === 'admin.access.manage',
    ),
    false,
  );
  assert.deepEqual([...managedPermissionKeys].sort(), manageablePermissions);
  assert.deepEqual(
    Object.keys(accessPermissionMetadata).sort(),
    [...permissions].sort(),
  );
  for (const item of Object.values(accessPermissionMetadata)) {
    assert.ok(item.label && item.description && item.category);
    assert.equal(typeof item.sensitive, 'boolean');
  }
});
test('F057 read and manage require every prerequisite and trusted identity', () => {
  assert.doesNotThrow(() => {
    assertAccessAuthority(access, true);
  });
  for (const p of accessPrerequisites)
    assert.throws(() => {
      assertAccessAuthority(
        { ...access, permissions: access.permissions.filter((k) => k !== p) },
        true,
      );
    });
  assert.doesNotThrow(() => {
    assertAccessAuthority({
      ...access,
      permissions: access.permissions.filter(
        (k) => k !== 'admin.access.manage',
      ),
    });
  });
  assert.throws(() => {
    assertAccessAuthority({ ...access, development: true });
  });
  assert.throws(() => {
    assertAccessAuthority({ ...access, tenantId: null });
  });
  assert.throws(() => {
    assertAccessAuthority({ ...access, permissions: ['admin.access.read'] });
  });
});
test('F057 rejects provisioning-only and unknown keys and canonicalizes duplicate input', () => {
  for (const key of [
    ...permissions.filter((p) => !manageablePermissions.includes(p)),
    'forged.permission',
  ])
    assert.throws(() => validateManagedPermissions([key]));
  assert.deepEqual(
    validateManagedPermissions([
      'service_request.view',
      'service_request.view',
    ]),
    ['service_request.view'],
  );
});
test('F057 dependencies use locked plus desired contributions', () => {
  assert.throws(() => {
    validateAccessDependencies(['catalog.issue_action.manage'], []);
  });
  assert.doesNotThrow(() => {
    validateAccessDependencies(
      ['catalog.issue_action.manage'],
      ['admin.configuration.read', 'admin.issues.write'],
    );
  });
  assert.throws(() => {
    validateAccessDependencies([], ['service_request.note.create']);
  });
  assert.doesNotThrow(() => {
    validateAccessDependencies(
      ['service_request.note.read'],
      ['service_request.note.create'],
    );
  });
});
test('F057 preserves contextual audience semantics without inventing universal internal read', () => {
  assert.doesNotThrow(() => {
    validateAccessDependencies(['service_request.internal.update'], []);
  });
  assert.doesNotThrow(() => {
    validateAccessDependencies(['service_request.answers.read'], []);
  });
  assert.match(
    accessPermissionMetadata['service_request.answers.read'].contextual,
    /parent read/,
  );
  assert.throws(() => {
    validateAccessDependencies(['service_request.create_internal'], []);
  });
});
test('Shared RBAC registry filter rejects unknown keys and deduplicates', () => {
  assert.deepEqual(
    recognizedPermissions([
      'unknown',
      'admin.access.read',
      'admin.access.read',
    ]),
    ['admin.access.read'],
  );
});
test('Controlled access CLI fails closed without serializing private inputs', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.resolve(__dirname, '../../src/database/access-administrator-cli.js'),
      'bootstrap',
      '--confirm',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        NODE_ENV: 'production',
        DATABASE_URL: 'SYNTHETIC_PRIVATE_SENTINEL',
        F057_STAFF_ID: 'SYNTHETIC_PRIVATE_SENTINEL',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Access provisioning failed/);
  assert.equal(result.stderr.includes('SYNTHETIC_PRIVATE_SENTINEL'), false);
});

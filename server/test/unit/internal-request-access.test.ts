import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { assertInternalReadAccess } from '../../src/service-request/internal-request.repository.js';

const access: StaffAccess = {
  tenantId: '10000000-0000-4000-8000-000000000001',
  objectId: '10000000-0000-4000-8000-000000000002',
  organizationId: '10000000-0000-4000-8000-000000000003',
  staffIdentityId: '10000000-0000-4000-8000-000000000004',
  displayName: 'Fictional reader',
  scopes: ['access_as_user'],
  permissions: ['service_request.internal.read'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};

test('internal read rejects missing identity, organization, permission and development fallback', () => {
  for (const candidate of [
    undefined,
    { ...access, organizationId: '' },
    { ...access, organizationId: 'invalid' },
    { ...access, staffIdentityId: '' },
    { ...access, development: true },
    { ...access, tenantId: null },
    { ...access, objectId: null },
    { ...access, permissions: [] },
    {
      ...access,
      permissions: [
        'service_request.create_internal',
      ] as StaffAccess['permissions'],
    },
  ]) {
    assert.throws(() => {
      assertInternalReadAccess(candidate);
    }, ForbiddenException);
  }
  assert.doesNotThrow(() => {
    assertInternalReadAccess(access);
  });
});

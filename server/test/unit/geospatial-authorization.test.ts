import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import {
  GeospatialAuthorizationService,
  type AuthenticatedGeospatialRequest,
} from '../../src/geospatial/geospatial-authorization.service.js';
import { GeospatialReadService } from '../../src/geospatial/geospatial-read.service.js';

const orgA = '10000000-0000-4000-8000-000000000001';
const orgB = '20000000-0000-4000-8000-000000000002';
const staff: StaffAccess = {
  tenantId: 'synthetic-tenant',
  objectId: 'synthetic-object',
  staffIdentityId: 'synthetic-staff',
  organizationId: orgA,
  displayName: 'Synthetic staff',
  scopes: ['access_as_user'],
  permissions: ['geospatial.read'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};

function fixture() {
  const calls: string[] = [];
  const repository = {
    async getMapData(organizationId: string) {
      calls.push(organizationId);
      return { organizationId, features: [] };
    },
  };
  return {
    calls,
    service: new GeospatialReadService(
      new GeospatialAuthorizationService(),
      repository,
    ),
  };
}

test('authorized server-resolved principal reads only its Organization', async () => {
  const f = fixture();
  const request = {
    staffAccess: staff,
    id: '30000000-0000-4000-8000-000000000003',
  };
  assert.deepEqual(await f.service.read(request), {
    organizationId: orgA,
    features: [],
  });
  assert.deepEqual(await f.service.read(request, orgA), {
    organizationId: orgA,
    features: [],
  });
  assert.deepEqual(f.calls, [orgA, orgA]);
  assert.deepEqual(
    new GeospatialAuthorizationService().authorizeRead(request),
    {
      organizationId: orgA,
      principalId: 'synthetic-staff',
      permissions: ['geospatial.read'],
      requestId: request.id,
    },
  );
});

test('missing or malformed trusted context denies before repository access', async () => {
  const f = fixture();
  await assert.rejects(f.service.read({}), UnauthorizedException);
  for (const access of [
    { ...staff, organizationId: '' },
    { ...staff, organizationId: 'invalid' },
    { ...staff, staffIdentityId: '' },
    { ...staff, tenantId: null },
    { ...staff, objectId: null },
    { ...staff, permissions: [] },
    { ...staff, development: true },
  ] as StaffAccess[]) {
    await assert.rejects(
      f.service.read({ staffAccess: access }),
      ForbiddenException,
    );
  }
  assert.deepEqual(f.calls, []);
});

test('cross-Organization and browser-supplied IDs never establish authority', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.read({ staffAccess: staff }, orgB),
    ForbiddenException,
  );
  await assert.rejects(
    f.service.read({ staffAccess: staff }, ''),
    ForbiddenException,
  );
  // Headers, query and body are not read by the internal context resolver.
  await assert.rejects(
    f.service.read({
      headers: { 'x-organization-id': orgA },
      query: { organizationId: orgA },
      body: { organizationId: orgA },
    } as AuthenticatedGeospatialRequest),
    UnauthorizedException,
  );
  assert.deepEqual(f.calls, []);
});

test('authorization denial is generic and never calls the provider', async () => {
  const f = fixture();
  await assert.rejects(
    f.service.read({ staffAccess: staff }, orgB),
    (error: unknown) => {
      assert.equal((error as ForbiddenException).message, 'Access denied');
      assert.doesNotMatch((error as Error).message, /20000000|synthetic/i);
      return true;
    },
  );
  assert.deepEqual(f.calls, []);
});

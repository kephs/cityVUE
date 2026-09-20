import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { publicContactPolicy } from '../../src/service-request/public-request-contact.policy.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import {
  RequestContactService,
  type ContactRequestAccessPolicy,
} from '../../src/service-request/request-contact.service.js';

const id = '80000000-0000-4000-8000-000000000001';
const access: StaffAccess = {
  organizationId: '10000000-0000-4000-8000-000000000001',
  staffIdentityId: '90000000-0000-4000-8000-000000000001',
  tenantId: 'fictional',
  objectId: 'fictional',
  permissions: [
    'service_request.internal.read',
    'service_request.contact.read',
  ],
  displayName: 'Fictional staff',
  scopes: [],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
const policy: ContactRequestAccessPolicy = {
  permission: 'service_request.internal.read',
  resolve: async () => ({ id }),
};
test('F039 two independent permission keys and trusted identity are required before contact database access', async () => {
  let touched = false;
  const service = new RequestContactService({
    get client() {
      touched = true;
      throw new Error('Must not access database');
    },
  } as unknown as DatabaseService);
  for (const input of [
    undefined,
    { ...access, development: true },
    { ...access, tenantId: null },
    ...[
      [],
      ['service_request.contact.read'],
      ['service_request.internal.read'],
      ['service_request.internal.update'],
    ].map((permissions) => ({ ...access, permissions }) as StaffAccess),
  ])
    await assert.rejects(service.read(id, input, policy), ForbiddenException);
  await assert.rejects(
    service.read('invalid', access, policy),
    NotFoundException,
  );
  assert.equal(touched, false);
});

test('F039 PUBLIC contact service independently requires PUBLIC view and contact permission before querying', async () => {
  let touched = false;
  const service = new RequestContactService({
    get client() {
      touched = true;
      throw new Error('Must not query');
    },
  } as unknown as DatabaseService);
  for (const permissions of [
    [],
    ['service_request.contact.read'],
    ['service_request.view'],
    ['service_request.internal.read', 'service_request.contact.read'],
  ]) {
    await assert.rejects(
      service.read(
        id,
        { ...access, permissions } as StaffAccess,
        publicContactPolicy,
      ),
      ForbiddenException,
    );
  }
  assert.equal(touched, false);
});
test('F039 audience-independent policy cannot disclose contact for an unresolved or mismatched parent', async () => {
  const database = {
    client: {
      transaction: () => ({
        execute: (fn: (trx: object) => unknown) => fn({}),
      }),
    },
  } as unknown as DatabaseService;
  const service = new RequestContactService(database);
  for (const result of [undefined, { id: 'different' }])
    await assert.rejects(
      service.read(id, access, { ...policy, resolve: async () => result }),
      NotFoundException,
    );
});

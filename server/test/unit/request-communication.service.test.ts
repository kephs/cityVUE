import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { RequestCommunicationService } from '../../src/service-request/request-communication.service.js';
import {
  RequestCommunicationRepository,
  communicationCursor,
} from '../../src/service-request/request-communication.repository.js';
import { requestCapabilities } from '../../src/service-request/staff-request-policy.js';

const access = (permissions: Permission[]): StaffAccess => ({
  organizationId: randomUUID(),
  staffIdentityId: randomUUID(),
  tenantId: randomUUID(),
  objectId: randomUUID(),
  displayName: 'Fictional',
  permissions,
  departmentIds: [],
  divisionIds: [],
  scopes: [],
  development: false,
});
test('F042 service rejects missing keys or untrusted identity before any Communications database access', async () => {
  let touched = false;
  const service = new RequestCommunicationService(
    {
      get client() {
        touched = true;
        throw new Error('No database access expected');
      },
    } as unknown as DatabaseService,
    new RequestCommunicationRepository(),
  );
  const all: Permission[] = [
    'service_request.view',
    'service_request.communication.read',
    'service_request.communication.create',
  ];
  for (const actor of [
    undefined,
    { ...access(all), development: true },
    { ...access(all), tenantId: null },
    access([
      'service_request.communication.read',
      'service_request.communication.create',
    ]),
    access(['service_request.view']),
  ]) {
    await assert.rejects(service.list(randomUUID(), actor), ForbiddenException);
    await assert.rejects(
      service.create(randomUUID(), actor, 'Fictional', randomUUID()),
      ForbiddenException,
    );
  }
  for (const permissions of [
    ['service_request.view', 'service_request.communication.read'],
    ['service_request.view', 'service_request.communication.create'],
  ] as Permission[][])
    await assert.rejects(
      service.create(
        randomUUID(),
        access(permissions),
        'Fictional',
        randomUUID(),
      ),
      ForbiddenException,
    );
  assert.equal(touched, false);
});
test('F042 both audience capabilities require separate Communications keys and create requires read', () => {
  for (const [audience, parent] of [
    ['public', 'service_request.view'],
    ['internal', 'service_request.internal.read'],
  ] as const) {
    for (const [read, create] of [
      [false, false],
      [true, false],
      [false, true],
      [true, true],
    ]) {
      const actor = access([
        parent,
        ...(read ? (['service_request.communication.read'] as const) : []),
        ...(create ? (['service_request.communication.create'] as const) : []),
      ]);
      const caps = requestCapabilities(actor, audience, 'closed');
      assert.equal(caps.canReadCommunications, audience === 'public' && read);
      assert.equal(
        caps.canCreateCommunication,
        audience === 'public' && read && create,
      );
      assert.equal(caps.canReadContact, false);
    }
    assert.throws(() =>
      requestCapabilities(
        access([
          'service_request.communication.read',
          'service_request.communication.create',
        ]),
        audience,
        'open',
      ),
    );
  }
});
test('F042 keyset cursors preserve microseconds and reject malformed or impossible dates safely', () => {
  const value = { id: randomUUID(), createdAt: '2026-09-20T12:05:06.123456Z' };
  const encode = (input: unknown) =>
    Buffer.from(JSON.stringify(input)).toString('base64url');
  assert.deepEqual(communicationCursor(encode(value)), value);
  assert.equal(communicationCursor(), undefined);
  for (const input of [
    '',
    'a'.repeat(257),
    'invalid',
    encode(null),
    encode({ ...value, extra: 'forged' }),
    encode({ ...value, id: 'invalid' }),
    encode({ ...value, createdAt: '2026-02-31T12:05:06.123456Z' }),
    encode({ ...value, createdAt: '0000-01-01T12:05:06.123456Z' }),
  ])
    assert.throws(
      () => communicationCursor(input),
      /Invalid communications cursor/,
    );
});

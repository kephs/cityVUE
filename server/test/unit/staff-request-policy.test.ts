import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import {
  assertRequestOperation,
  publicWorkflowPermissions,
  requestCapabilities,
} from '../../src/service-request/staff-request-policy.js';
import { assertStaffRequestRead } from '../../src/service-request/staff-request-scope.js';

const actor = (permissions: Permission[]): StaffAccess => ({
  tenantId: randomUUID(),
  objectId: randomUUID(),
  organizationId: randomUUID(),
  staffIdentityId: randomUUID(),
  displayName: 'Fictional staff',
  permissions,
  scopes: [],
  departmentIds: [],
  divisionIds: [],
  development: false,
});

test('F049 anonymity removes Contact and new correspondence but preserves independent tracking and historical reads', () => {
  const access = actor([
    'service_request.view',
    'service_request.contact.read',
    'service_request.communication.read',
    'service_request.communication.create',
    'service_request.tracking.manage',
  ]);
  const anonymous = requestCapabilities(access, 'public', 'open', 'anonymous');
  assert.equal(anonymous.canReadContact, false);
  assert.equal(anonymous.canCreateCommunication, false);
  assert.equal(anonymous.canReadCommunications, true);
  assert.equal(anonymous.canManageRequesterTracking, true);
  const identified = requestCapabilities(
    access,
    'public',
    'open',
    'identified',
  );
  assert.equal(identified.canReadContact, true);
  assert.equal(identified.canCreateCommunication, true);
});

test('F040 read admission never infers another audience or contact from operation permissions', () => {
  for (const keys of [
    [],
    ['service_request.contact.read'],
    ['service_request.internal.update'],
    ['service_request.assign'],
  ] as Permission[][])
    assert.throws(() => {
      assertStaffRequestRead(actor(keys));
    });
  for (const [key, audience, other] of [
    ['service_request.view', 'public', 'internal'],
    ['service_request.internal.read', 'internal', 'public'],
  ] as const) {
    const access = actor([key]);
    assertStaffRequestRead(access);
    assertStaffRequestRead(access, audience);
    assert.throws(() => {
      assertStaffRequestRead(access, other);
    });
    assert.throws(() => {
      assertStaffRequestRead({ ...access, development: true });
    });
  }
});

test('F040 PUBLIC action capabilities require their exact key and a valid lifecycle state', () => {
  const access = actor([
    'service_request.view',
    ...Object.values(publicWorkflowPermissions),
  ]);
  for (const [status, expected] of [
    ['open', ['start_work', 'close']],
    ['in_progress', ['hold', 'close']],
    ['on_hold', ['resume', 'close']],
    ['closed', ['reopen']],
    ['cancelled', []],
  ] as const)
    assert.deepEqual(
      requestCapabilities(access, 'public', status).workflowActions,
      expected,
    );
  for (const action of Object.keys(
    publicWorkflowPermissions,
  ) as (keyof typeof publicWorkflowPermissions)[]) {
    assertRequestOperation(access, 'public', action);
    assert.throws(() => {
      assertRequestOperation(
        actor(['service_request.view', 'service_request.internal.update']),
        'public',
        action,
      );
    });
    assert.throws(() => {
      assertRequestOperation(
        actor([publicWorkflowPermissions[action]]),
        'public',
        action,
      );
    });
  }
  const readOnly = requestCapabilities(
    actor(['service_request.view']),
    'public',
    'open',
  );
  assert.deepEqual(readOnly, {
    canManageRequesterTracking: false,
    workflowActions: [],
    canRoute: false,
    canAssign: false,
    canManageWatchers: false,
    canWatchSelf: true,
    canReadContact: false,
    canReadAnswers: false,
    canReadNotes: false,
    canCreateNotes: false,
    canReadCommunications: false,
    canCreateCommunication: false,
  });
});

test('F040 routing, assignment, watcher management and contact stay independent', () => {
  for (const [operation, key, property] of [
    ['route', 'service_request.route', 'canRoute'],
    ['assign', 'service_request.assign', 'canAssign'],
    ['watchers', 'service_request.watchers.manage', 'canManageWatchers'],
  ] as const) {
    const access = actor(['service_request.view', key]);
    assertRequestOperation(access, 'public', operation);
    assert.equal(requestCapabilities(access, 'public', 'open')[property], true);
    assert.equal(
      requestCapabilities(access, 'public', 'open').canReadContact,
      false,
    );
    assert.throws(() => {
      assertRequestOperation(actor([key]), 'public', operation);
    });
  }
  const internal = actor([
    'service_request.internal.read',
    'service_request.internal.update',
  ]);
  assert.deepEqual(
    requestCapabilities(internal, 'internal', 'open').workflowActions,
    ['start_work', 'close'],
  );
  assert.throws(() => {
    assertRequestOperation(internal, 'public', 'assign');
  });
  assert.throws(() => {
    assertRequestOperation(
      actor(['service_request.internal.read', 'service_request.assign']),
      'internal',
      'assign',
    );
  });
});

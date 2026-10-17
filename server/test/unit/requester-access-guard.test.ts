import assert from 'node:assert/strict';
import test from 'node:test';
import type { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { RequesterAccessGuard } from '../../src/auth/requester-access.guard.js';
import { REQUESTER_IDENTITY_KEY } from '../../src/auth/auth.decorators.js';
import type { EntraTokenService } from '../../src/auth/entra-token.service.js';
import type { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import {
  assertRequesterIdentity,
  requesterRequestId,
} from '../../src/service-request/internal-requester-scope.js';
import type { RequesterAccess } from '../../src/auth/auth.types.js';

const ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const IDENTITY = '10000000-0000-4000-8000-000000000002';
const resolved: RequesterAccess = {
  tenantId: 'fictional-tenant',
  objectId: 'fictional-object',
  staffIdentityId: IDENTITY,
  organizationId: ORGANIZATION,
};

interface GuardRequest {
  headers: Record<string, string | undefined>;
  requesterAccess?: RequesterAccess;
  staffAccess?: unknown;
}

function harness(options: {
  optedIn?: boolean;
  headers?: Record<string, string | undefined>;
  validate?: () => Promise<unknown>;
  hasScope?: boolean;
  resolve?: () => Promise<RequesterAccess>;
  request?: GuardRequest;
}) {
  const request: GuardRequest = options.request ?? {
    headers: options.headers ?? { authorization: 'Bearer fictional.token' },
  };
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === REQUESTER_IDENTITY_KEY ? (options.optedIn ?? true) : undefined,
  } as unknown as Reflector;
  const tokens = {
    validate:
      options.validate ??
      (() =>
        Promise.resolve({
          tenantId: 'fictional-tenant',
          objectId: 'fictional-object',
          name: 'Fictional employee',
          scopes: ['access_as_user'],
          tokenVersion: '2.0',
        })),
    hasRequiredScope: () => options.hasScope ?? true,
  } as unknown as EntraTokenService;
  const authorization = {
    resolveRequesterIdentity:
      options.resolve ?? (() => Promise.resolve(resolved)),
  } as unknown as StaffAuthorizationService;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => () => undefined,
    getClass: () => class Fictional {},
  } as unknown as ExecutionContext;
  return {
    request,
    guard: new RequesterAccessGuard(reflector, tokens, authorization),
    context,
  };
}

test('F064.1 an opted-in route with a valid token receives only a narrow requester identity', async () => {
  const { guard, context, request } = harness({});
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(request.requesterAccess, resolved);
  // The context carries no permission, department, division or development
  // field, so no requester path can consult a staff grant.
  assert.deepEqual(Object.keys(request.requesterAccess ?? {}).sort(), [
    'objectId',
    'organizationId',
    'staffIdentityId',
    'tenantId',
  ]);
  assert.equal(request.staffAccess, undefined);
});

test('F064.1 a route that did not opt in is refused even though the guard is attached', async () => {
  const { guard, context } = harness({ optedIn: false });
  await assert.rejects(guard.canActivate(context), /Access denied/);
});

test('F064.1 a forged requester or staff context supplied by the caller is discarded', async () => {
  const forged: GuardRequest = {
    headers: { authorization: 'Bearer fictional.token' },
    requesterAccess: {
      tenantId: 'attacker',
      objectId: 'attacker',
      staffIdentityId: '10000000-0000-4000-8000-00000000dead',
      organizationId: '10000000-0000-4000-8000-00000000beef',
    },
    staffAccess: { permissions: ['service_request.internal.read'] },
  };
  const { guard, context, request } = harness({ request: forged });
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(request.requesterAccess, resolved);
  assert.equal(request.staffAccess, undefined);
});

test('F064.1 a forged context is discarded even when admission then fails', async () => {
  const forged: GuardRequest = {
    headers: {},
    requesterAccess: {
      tenantId: 'attacker',
      objectId: 'attacker',
      staffIdentityId: IDENTITY,
      organizationId: ORGANIZATION,
    },
  };
  const { guard, context, request } = harness({ request: forged });
  await assert.rejects(guard.canActivate(context));
  assert.equal(request.requesterAccess, undefined);
});

test('F064.1 missing, non-bearer and unprovisioned credentials are all refused', async () => {
  await assert.rejects(
    harness({ headers: {} }).guard.canActivate(
      harness({ headers: {} }).context,
    ),
  );
  const basic = harness({ headers: { authorization: 'Basic fictional' } });
  await assert.rejects(basic.guard.canActivate(basic.context));
  const invalid = harness({
    validate: () => Promise.reject(new Error('invalid token')),
  });
  await assert.rejects(invalid.guard.canActivate(invalid.context));
  const unprovisioned = harness({
    resolve: () => Promise.reject(new Error('not provisioned')),
  });
  await assert.rejects(unprovisioned.guard.canActivate(unprovisioned.context));
});

test('F064.1 a token without the required API scope is refused', async () => {
  const { guard, context, request } = harness({ hasScope: false });
  await assert.rejects(guard.canActivate(context), /scope/);
  assert.equal(request.requesterAccess, undefined);
});

test('F064.1 requester identity assertions reject anything but a complete trusted context', () => {
  assert.doesNotThrow(() => {
    assertRequesterIdentity(resolved);
  });
  for (const broken of [
    undefined,
    { ...resolved, tenantId: '' },
    { ...resolved, objectId: '' },
    { ...resolved, organizationId: 'not-a-uuid' },
    { ...resolved, staffIdentityId: 'not-a-uuid' },
  ])
    assert.throws(
      () => {
        assertRequesterIdentity(broken);
      },
      /Access denied/,
      `${JSON.stringify(broken)} must not be accepted`,
    );
});

test('F064.1 a malformed request id is indistinguishable from an absent one', () => {
  assert.equal(requesterRequestId(ORGANIZATION), ORGANIZATION);
  for (const malformed of ['', 'not-a-uuid', '../../etc/passwd', '%00'])
    assert.throws(() => requesterRequestId(malformed), { status: 404 });
});

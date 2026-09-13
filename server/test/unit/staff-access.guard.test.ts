import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { AppConfiguration } from '../../src/config/configuration.js';
import type { DatabaseService } from '../../src/database/database.service.js';
import { PERMISSION_KEY } from '../../src/auth/auth.decorators.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import type { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';

const access: StaffAccess = {
  tenantId: 'tenant',
  objectId: 'object',
  staffIdentityId: 'staff',
  organizationId: 'organization',
  displayName: 'Staff',
  scopes: ['access_as_user'],
  permissions: ['service_request.view'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
function fixture({
  enabled = true,
  scope = true,
  granted = true,
  validToken = true,
  provisioned = true,
} = {}) {
  const database = {
    get client(): never {
      throw new Error('Unexpected development fallback');
    },
  } as unknown as DatabaseService;
  const tokens = {
    enabled,
    validate: async () => {
      if (!validToken) throw new UnauthorizedException();
      return {};
    },
    hasRequiredScope: () => scope,
  } as unknown as EntraTokenService;
  const authorization = new StaffAuthorizationService(database);
  authorization.resolve = async () => {
    if (!provisioned) throw new ForbiddenException();
    return { ...access, permissions: granted ? access.permissions : [] };
  };
  const config = { get: () => false } as unknown as ConfigService<
    AppConfiguration,
    true
  >;
  const guard = new StaffAccessGuard(
    new Reflector(),
    tokens,
    authorization,
    config,
    database,
  );
  function context(bearer?: string) {
    const handler = () => undefined;
    Reflect.defineMetadata(PERMISSION_KEY, 'service_request.view', handler);
    const request: {
      headers: Record<string, string>;
      staffAccess?: StaffAccess;
    } = {
      headers: bearer ? { authorization: bearer } : {},
    };
    return {
      request,
      context: {
        getHandler: () => handler,
        getClass: () => StaffAccessGuard,
        switchToHttp: () => ({ getRequest: () => request }),
      } as unknown as ExecutionContext,
    };
  }
  return { guard, context };
}
test('staff guard rejects anonymous and invalid bearer requests with Entra enabled', async () => {
  for (const header of [undefined, 'Basic invalid']) {
    const f = fixture();
    await assert.rejects(
      f.guard.canActivate(f.context(header).context),
      UnauthorizedException,
    );
  }
  const invalid = fixture({ validToken: false });
  await assert.rejects(
    invalid.guard.canActivate(invalid.context('Bearer invalid').context),
    UnauthorizedException,
  );
});
test('staff guard rejects missing delegated scope, provisioning or resource permission', async () => {
  for (const options of [
    { scope: false },
    { provisioned: false },
    { granted: false },
  ]) {
    const f = fixture(options);
    await assert.rejects(
      f.guard.canActivate(f.context('Bearer test').context),
      ForbiddenException,
    );
  }
});
test('staff guard sets only resolved server identity after permission evaluation', async () => {
  const f = fixture();
  const ctx = f.context('Bearer test');
  assert.equal(await f.guard.canActivate(ctx.context), true);
  assert.deepEqual(ctx.request.staffAccess, access);
});
test('unconfigured identity does not implicitly enable development access', async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(
    f.guard.canActivate(f.context().context),
    NotFoundException,
  );
});

import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException, ForbiddenException } from '@nestjs/common';
import request from 'supertest';
import { AdminAccessController } from '../../src/admin/admin-access.controller.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { HttpExceptionFilter } from '../../src/common/errors/http-exception.filter.js';
import type { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import { accessPrerequisites } from '../../src/access/access-policy.js';

test('F057.3 HTTP authenticates and rejects unauthorized/forged commands before database mutation', async () => {
  const staffId = 'a1705713-3000-4000-9000-000000000001',
    target = '10000000-0000-4000-8000-000000000002';
  let touches = 0;
  const capturedErrors: unknown[] = [];
  const module = await Test.createTestingModule({
    controllers: [AdminAccessController],
    providers: [
      StaffAccessGuard,
      Reflector,
      {
        provide: DatabaseService,
        useValue: {
          get client() {
            touches++;
            return {};
          },
        },
      },
      { provide: ConfigService, useValue: { get: () => false } },
      {
        provide: EntraTokenService,
        useValue: {
          enabled: true,
          validate: async (token: string) => {
            if (token === 'invalid') throw new UnauthorizedException();
            return { objectId: token };
          },
          hasRequiredScope: () => true,
        },
      },
      {
        provide: StaffAuthorizationService,
        useValue: {
          resolve: async (p: { objectId: string }): Promise<StaffAccess> => ({
            organizationId: staffId,
            staffIdentityId: staffId,
            tenantId: staffId,
            objectId: staffId,
            displayName: 'Synthetic',
            development: p.objectId === 'fallback',
            scopes: [],
            departmentIds: [],
            divisionIds: [],
            permissions:
              p.objectId === 'manager' || p.objectId === 'fallback'
                ? [...accessPrerequisites]
                : p.objectId === 'reader'
                  ? ['admin.configuration.read', 'admin.access.read']
                  : p.objectId.startsWith('subset-')
                    ? accessPrerequisites.filter(
                        (_, index) =>
                          Number(p.objectId.slice(7)) & (1 << index),
                      )
                    : ['admin.access.manage'],
          }),
          assertPermission: (a: StaffAccess, p: Permission) => {
            if (!a.permissions.includes(p)) throw new ForbiddenException();
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(
    new HttpExceptionFilter({
      logger: { error: (...values: unknown[]) => capturedErrors.push(values) },
    } as unknown as PinoLoggerService),
  );
  await app.init();
  const body = {
    expectedAuthorizationRevision: '1',
    managedPermissionKeys: ['service_request.view'],
  };
  try {
    await request(app.getHttpServer())
      .patch(`/api/v1/admin/access/principals/${target}`)
      .send(body)
      .expect(401);
    for (const token of [
      'reader',
      'incomplete',
      'fallback',
      ...Array.from({ length: 7 }, (_, n) => `subset-${String(n)}`),
    ])
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/access/principals/${target}`)
        .set('Authorization', `Bearer ${token}`)
        .send(body)
        .expect(403);
    assert.equal(touches, 0);
    const privateMarkers = [
      'synthetic-token-secret',
      'synthetic-raw-claims',
      'synthetic-requester-data',
      'synthetic-protected-answer',
      'synthetic-private-location',
      'synthetic-tracking-secret',
    ];
    const privateResponse = await request(app.getHttpServer())
      .patch(`/api/v1/admin/access/principals/${target}`)
      .set('Authorization', 'Bearer manager')
      .send({ ...body, forgedPrivateData: privateMarkers })
      .expect(400);
    for (const marker of privateMarkers) {
      assert.ok(!JSON.stringify(privateResponse.body).includes(marker));
      assert.ok(!JSON.stringify(capturedErrors).includes(marker));
    }
    for (const extra of [
      { actorId: staffId },
      { organizationId: staffId },
      { roleId: staffId },
      { source: 'runtime' },
      { expectedAuthorizationRevision: 1 },
      { expectedAuthorizationRevision: '01' },
      { managedPermissionKeys: ['admin.access.manage'] },
      { managedPermissionKeys: ['unknown'] },
    ]) {
      const r = await request(app.getHttpServer())
        .patch(`/api/v1/admin/access/principals/${target}`)
        .set('Authorization', 'Bearer manager')
        .send({ ...body, ...extra })
        .expect(400);
      assert.ok(!JSON.stringify(r.body).includes('role_permission'));
      assert.ok((r.body as { code?: string }).code?.startsWith('ACCESS_'));
    }
    const self = await request(app.getHttpServer())
      .patch(`/api/v1/admin/access/principals/${staffId}`)
      .set('Authorization', 'Bearer manager')
      .send(body)
      .expect(403);
    assert.equal(
      (self.body as { code?: string }).code,
      'ACCESS_SELF_EDIT_FORBIDDEN',
    );
  } finally {
    await app.close();
  }
});

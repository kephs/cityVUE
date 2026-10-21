import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { AdminDepartmentController } from '../../src/admin/admin-department.controller.js';
import { AdminDepartmentService } from '../../src/admin/admin-department.service.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import {
  departmentAccess,
  departmentFixture,
  departmentTestDatabase,
} from '../helpers/admin-department.fixture.js';

test('Department HTTP routes use the real guard and service without external identity or database connections', async (t) => {
  const { client, database, driver } = departmentTestDatabase();
  const module = await Test.createTestingModule({
    controllers: [AdminDepartmentController],
    providers: [
      AdminDepartmentService,
      StaffAccessGuard,
      Reflector,
      { provide: DatabaseService, useValue: database },
      { provide: ConfigService, useValue: { get: () => true } },
      {
        provide: EntraTokenService,
        useValue: {
          enabled: false,
          validate: async (token: string) => {
            if (token === 'invalid') throw new UnauthorizedException();
            return { objectId: token };
          },
          hasRequiredScope: ({ objectId }: { objectId: string }) =>
            objectId !== 'no-scope',
        },
      },
      {
        provide: StaffAuthorizationService,
        useValue: {
          resolve: async ({
            objectId,
          }: {
            objectId: string;
          }): Promise<StaffAccess> => {
            if (objectId === 'unprovisioned') throw new ForbiddenException();
            return {
              ...departmentAccess,
              objectId,
              development: objectId === 'fallback',
              permissions:
                objectId === 'ordinary'
                  ? ['service_request.view']
                  : ['admin.configuration.read'],
            };
          },
          assertPermission: (a: StaffAccess, p: Permission) => {
            if (!a.permissions.includes(p)) throw new ForbiddenException();
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  const base = '/api/v1/admin/departments';
  try {
    for (const suffix of [
      '',
      `/${departmentFixture.id}`,
      `/${departmentFixture.id}/divisions`,
      `/${departmentFixture.id}/categories`,
    ]) {
      await t.test(`admission and caching ${suffix || 'list'}`, async () => {
        const before = driver.queries.length;
        await request(app.getHttpServer())
          .get(base + suffix)
          .expect(401);
        for (const [token, status] of [
          ['invalid', 401],
          ['no-scope', 403],
          ['unprovisioned', 403],
          ['ordinary', 403],
          ['fallback', 403],
        ] as const)
          await request(app.getHttpServer())
            .get(base + suffix)
            .set('Authorization', `Bearer ${token}`)
            .expect(status);
        assert.equal(driver.queries.length, before);
        const response = await request(app.getHttpServer())
          .get(base + suffix)
          .set('Authorization', 'Bearer reader')
          .expect(200)
          .expect('Cache-Control', 'no-store');
        assert.doesNotMatch(
          response.text,
          /organizationId|staffIdentityId|tenantId|routing|revision|permissions/,
        );
        await request(app.getHttpServer())
          .get(base + suffix + '?organizationId=other')
          .set('Authorization', 'Bearer reader')
          .expect(400);
      });
    }
    await t.test(
      'inactive organization, malformed queries and safe unavailable IDs',
      async () => {
        driver.active = false;
        await request(app.getHttpServer())
          .get(base)
          .set('Authorization', 'Bearer reader')
          .expect(403);
        driver.active = true;
        for (const query of [
          '?page=0',
          '?search=a&search=b',
          '?pageSize=999',
          '?sort=sql',
          '?search=' + 'x'.repeat(101),
        ])
          await request(app.getHttpServer())
            .get(base + query)
            .set('Authorization', 'Bearer reader')
            .expect(400);
        await request(app.getHttpServer())
          .get(base + '/bad')
          .set('Authorization', 'Bearer reader')
          .expect(400);
        driver.found = false;
        for (const suffix of ['', '/divisions', '/categories'])
          await request(app.getHttpServer())
            .get(base + '/' + departmentFixture.id + suffix)
            .set('Authorization', 'Bearer reader')
            .expect(404);
      },
    );
    await t.test('no mutation routes exist', async () => {
      for (const path of [base, base + '/' + departmentFixture.id])
        for (const method of ['post', 'put', 'patch', 'delete'] as const) {
          const http = request(app.getHttpServer());
          await http[method](path)
            .set('Authorization', 'Bearer reader')
            .send({ name: 'forged' })
            .expect(404);
        }
    });
  } finally {
    await app.close();
    await client.destroy();
  }
});

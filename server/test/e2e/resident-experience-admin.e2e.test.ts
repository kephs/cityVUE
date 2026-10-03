import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import request from 'supertest';
import { AdminResidentExperienceController } from '../../src/resident-experience/resident-experience.admin.controller.js';
import {
  AdminResidentExperienceService,
  assertResidentDraftWrite,
} from '../../src/resident-experience/resident-experience.admin.service.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import { assertConfigurationRead } from '../../src/admin/admin-configuration.domain.js';
import {
  classifyResidentChanges,
  validateResidentSnapshot,
} from '../../src/resident-experience/resident-experience.domain.js';
import { phoneFixture } from '../helpers/resident-experience.fixture.js';
import { projectPublishedResidentExperience } from '../../src/resident-experience/resident-experience.public.dto.js';

test('protected Resident Experience HTTP admission and route surface', async (t) => {
  const org = '00000000-0000-4000-8000-000000000059';
  let calls = 0;
  const snapshot = phoneFixture();
  const module = await Test.createTestingModule({
    controllers: [AdminResidentExperienceController],
    providers: [
      StaffAccessGuard,
      Reflector,
      { provide: ConfigService, useValue: { get: () => false } },
      { provide: DatabaseService, useValue: {} },
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
          resolve: async ({
            objectId,
          }: {
            objectId: string;
          }): Promise<StaffAccess> => ({
            organizationId: org,
            staffIdentityId: org,
            tenantId: 'tenant',
            objectId,
            displayName: 'Synthetic',
            development: objectId === 'fallback',
            scopes: [],
            departmentIds: [],
            divisionIds: [],
            permissions:
              objectId === 'none'
                ? []
                : objectId === 'reader' || objectId === 'fallback'
                  ? ['admin.configuration.read']
                  : objectId === 'writer'
                    ? ['admin.configuration.read', 'resident_experience.write']
                    : [
                        'admin.configuration.read',
                        'resident_experience.write',
                        'resident_experience.contact.manage',
                      ],
          }),
          assertPermission: (a: StaffAccess, p: Permission) => {
            if (!a.permissions.includes(p)) throw new ForbiddenException();
          },
        },
      },
      {
        provide: AdminResidentExperienceService,
        useValue: {
          summary: async (a: StaffAccess) => {
            assertConfigurationRead(a);
            assert.equal(a.organizationId, org);
            calls++;
            return { revision: 2, draft: snapshot };
          },
          preview: async (a: StaffAccess) => {
            assertConfigurationRead(a);
            calls++;
            return {
              revision: 2,
              unpublished: true,
              presentation: projectPublishedResidentExperience(snapshot),
            };
          },
          save: async (a: StaffAccess, input: { snapshot: unknown }) => {
            const next = validateResidentSnapshot(input.snapshot);
            assertResidentDraftWrite(
              a,
              classifyResidentChanges(snapshot, next),
            );
            calls++;
            return { revision: 3, changed: true };
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  await app.init();
  const base = '/api/v1/admin/resident-experience';
  try {
    await t.test(
      'anonymous, invalid, untrusted and missing permission are denied',
      async () => {
        for (const path of ['', '/preview']) {
          await request(app.getHttpServer())
            .get(base + path)
            .expect(401);
          for (const [token, status] of [
            ['invalid', 401],
            ['none', 403],
            ['fallback', 403],
          ] as const)
            await request(app.getHttpServer())
              .get(base + path)
              .set('Authorization', `Bearer ${token}`)
              .expect(status);
        }
        assert.equal(calls, 0);
      },
    );
    await t.test(
      'trusted server context, no-store and same DTO preview',
      async () => {
        const result = await request(app.getHttpServer())
          .get(base)
          .set('Authorization', 'Bearer reader')
          .set('X-Organization-Id', 'forged')
          .expect(200);
        assert.equal(result.headers['cache-control'], 'no-store');
        const preview = await request(app.getHttpServer())
          .get(base + '/preview')
          .set('Authorization', 'Bearer reader')
          .expect(200);
        assert.deepEqual(
          (preview.body as Record<string, unknown>).presentation,
          projectPublishedResidentExperience(snapshot),
        );
        assert.equal(preview.headers['cache-control'], 'no-store');
      },
    );
    await t.test('selectors and GET bodies are rejected', async () => {
      for (const path of ['', '/preview']) {
        await request(app.getHttpServer())
          .get(base + path + '?organizationId=forged')
          .set('Authorization', 'Bearer reader')
          .expect(400);
        await request(app.getHttpServer())
          .get(base + path)
          .set('Authorization', 'Bearer reader')
          .send({})
          .expect(400);
      }
    });
    await t.test(
      'save requires write and additional contact authority for consequential changes',
      async () => {
        const ordinary = structuredClone(snapshot);
        ordinary.presentation.metadata.title = 'Changed';
        await request(app.getHttpServer())
          .put(base + '/draft')
          .send({ expectedRevision: 2, snapshot: ordinary })
          .expect(401);
        await request(app.getHttpServer())
          .put(base + '/draft')
          .set('Authorization', 'Bearer reader')
          .send({ expectedRevision: 2, snapshot: ordinary })
          .expect(403);
        await request(app.getHttpServer())
          .put(base + '/draft')
          .set('Authorization', 'Bearer writer')
          .send({ expectedRevision: 2, snapshot: ordinary })
          .expect(200);
        ordinary.contacts = [];
        await request(app.getHttpServer())
          .put(base + '/draft')
          .set('Authorization', 'Bearer writer')
          .send({ expectedRevision: 2, snapshot: ordinary })
          .expect(400);
        ordinary.contacts = structuredClone(snapshot.contacts);
        assert.ok(ordinary.contacts[0]);
        ordinary.contacts[0].guidance = 'New guidance';
        await request(app.getHttpServer())
          .put(base + '/draft')
          .set('Authorization', 'Bearer writer')
          .send({ expectedRevision: 2, snapshot: ordinary })
          .expect(403);
        await request(app.getHttpServer())
          .put(base + '/draft')
          .set('Authorization', 'Bearer contact-manager')
          .send({ expectedRevision: 2, snapshot: ordinary })
          .expect(200);
      },
    );
    await t.test(
      'no publish/approval/history/rollback route exists',
      async () => {
        for (const suffix of ['publish', 'approve', 'history', 'rollback'])
          await request(app.getHttpServer())
            .post(base + '/' + suffix)
            .set('Authorization', 'Bearer contact-manager')
            .send({})
            .expect(404);
      },
    );
  } finally {
    await app.close();
  }
});

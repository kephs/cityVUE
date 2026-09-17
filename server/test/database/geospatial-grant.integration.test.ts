import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import request from 'supertest';
import { up as catalogUp } from '../../migrations/20260902000000-create-organization-service-catalog.js';
import { up as requestUp } from '../../migrations/20260902010000-create-service-request-foundation.js';
import { up as eligibilityUp } from '../../migrations/20260902030000-add-location-eligibility-snapshot.js';
import { up as staffUp } from '../../migrations/20260903010000-add-staff-assignment-workflow-foundation.js';
import { up as authUp } from '../../migrations/20260903020000-add-entra-rbac-foundation.js';
import { up as permissionUp } from '../../migrations/20260917000000-add-geospatial-read-permission.js';
import { DatabaseService } from '../../src/database/database.service.js';
import type { DatabaseSchema } from '../../src/database/database.types.js';
import { provisionDevelopmentGeospatialGrant } from '../../src/database/development-geospatial-grant.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import {
  SyntheticGeospatialRepository,
  SYNTHETIC_ORGANIZATION_A,
  SYNTHETIC_ORGANIZATION_B,
} from '../../src/geospatial/synthetic-geospatial.repository.js';

const url = process.env.TEST_DATABASE_URL;
const tenantId = '30000000-0000-4000-8000-000000000003';
const memberId = '40000000-0000-4000-8000-000000000004';
const readerId = '50000000-0000-4000-8000-000000000005';
const otherId = '60000000-0000-4000-8000-000000000006';
const unassignedId = '70000000-0000-4000-8000-000000000007';

test(
  'database-backed Organization and grant control protected geospatial HTTP reads',
  { skip: !url && 'TEST_DATABASE_URL is not configured' },
  async (t) => {
    assert.ok(url);
    process.env.NODE_ENV = 'test';
    process.env.CITYVUE_DEPLOYMENT_PROFILE = 'development';
    process.env.DATABASE_URL =
      'postgresql://cityvue:placeholder@localhost/test';
    process.env.LOG_LEVEL = 'silent';
    delete process.env.ENTRA_TENANT_ID;
    delete process.env.ENTRA_API_CLIENT_ID;
    delete process.env.ENTRA_EXPECTED_AUDIENCE;
    const schema = `geospatial_grant_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: url });
    await admin.query(`create schema "${schema}"`);
    const db = new Kysely<DatabaseSchema>({
      dialect: new PostgresDialect({
        pool: new Pool({
          connectionString: url,
          options: `-c search_path=${schema}`,
        }),
      }),
    });
    try {
      await catalogUp(db);
      await requestUp(db);
      await eligibilityUp(db);
      await staffUp(db);
      await authUp(db);
      await permissionUp(db);
      await db
        .insertInto('organization')
        .values([
          {
            id: SYNTHETIC_ORGANIZATION_A,
            name: 'Fictional A',
            short_name: 'A',
            slug: 'fictional-a',
            status: 'active',
            default_business_timezone: 'Etc/UTC',
          },
          {
            id: SYNTHETIC_ORGANIZATION_B,
            name: 'Fictional B',
            short_name: 'B',
            slug: 'fictional-b',
            status: 'active',
            default_business_timezone: 'Etc/UTC',
          },
        ])
        .execute();
      for (const [objectId, organizationId, grant] of [
        [memberId, SYNTHETIC_ORGANIZATION_A, false],
        [readerId, SYNTHETIC_ORGANIZATION_A, true],
        [otherId, SYNTHETIC_ORGANIZATION_B, true],
      ] as const)
        await provisionDevelopmentGeospatialGrant(db, {
          tenantId,
          objectId,
          organizationId,
          grant,
        });
      await provisionDevelopmentGeospatialGrant(db, {
        tenantId,
        objectId: readerId,
        organizationId: SYNTHETIC_ORGANIZATION_A,
        grant: true,
      });
      assert.equal(
        (await db.selectFrom('role_permission').selectAll().execute()).length,
        2,
      );
      assert.equal(
        (await db.selectFrom('staff_role_assignment').selectAll().execute())
          .length,
        2,
      );
      await assert.rejects(
        provisionDevelopmentGeospatialGrant(db, {
          tenantId,
          objectId: readerId,
          organizationId: SYNTHETIC_ORGANIZATION_B,
          grant: true,
        }),
        /assigned elsewhere/,
      );

      // Only signature verification is replaced. Real StaffAuthorizationService
      // and its PostgreSQL queries run through the F018 guard and F025 service.
      const [{ AppModule }, { configureApplication }] = await Promise.all([
        import('../../src/app.module.js'),
        import('../../src/bootstrap.js'),
      ]);
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DatabaseService)
        .useValue({ client: db, status: async () => 'up' })
        .overrideProvider(EntraTokenService)
        .useValue({
          enabled: false,
          validate: async (token: string) => {
            if (![memberId, readerId, otherId, unassignedId].includes(token))
              throw new UnauthorizedException();
            return {
              tenantId,
              objectId: token,
              name: 'Development staff',
              scopes: ['access_as_user'],
              tokenVersion: '2.0',
            };
          },
          hasRequiredScope: (principal: { scopes: string[] }) =>
            principal.scopes.includes('access_as_user'),
        })
        .compile();
      const app = module.createNestApplication();
      configureApplication(app);
      await app.init();
      const provider = t.mock.method(
        app.get(SyntheticGeospatialRepository),
        'getMapData',
      );
      const path = '/api/v1/geospatial';
      try {
        await request(app.getHttpServer()).get(path).expect(401);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer invalid')
          .expect(401);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + unassignedId)
          .expect(403);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + memberId)
          .set('X-Role', 'geospatial-reader')
          .expect(403);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + readerId)
          .set('X-Role', 'geospatial-reader')
          .query({ organizationId: SYNTHETIC_ORGANIZATION_B })
          .expect(403);
        assert.equal(provider.mock.callCount(), 0);
        const success = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + readerId)
          .query({ organizationId: SYNTHETIC_ORGANIZATION_A })
          .expect(200);
        assert.equal(
          (success.body as { organizationId: string }).organizationId,
          SYNTHETIC_ORGANIZATION_A,
        );
        assert.equal(provider.mock.callCount(), 1);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + otherId)
          .query({ organizationId: SYNTHETIC_ORGANIZATION_B })
          .expect(200);
        assert.deepEqual(
          provider.mock.calls.map((call) => call.arguments[0]),
          [SYNTHETIC_ORGANIZATION_A, SYNTHETIC_ORGANIZATION_B],
        );
        await db
          .updateTable('staff_role_assignment')
          .set({ active: false })
          .where('organization_id', '=', SYNTHETIC_ORGANIZATION_A)
          .execute();
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + readerId)
          .expect(403);
        assert.equal(provider.mock.callCount(), 2);
        await db
          .updateTable('staff_identity')
          .set({ active: false })
          .where('entra_object_id', '=', memberId)
          .execute();
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer ' + memberId)
          .expect(403);
        assert.equal(provider.mock.callCount(), 2);
      } finally {
        await app.close();
      }
    } finally {
      await db.destroy();
      await admin.query(`drop schema "${schema}" cascade`);
      await admin.end();
    }
  },
);

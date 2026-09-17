import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { AppConfiguration } from '../../src/config/configuration.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import type { Permission, StaffAccess } from '../../src/auth/auth.types.js';
import {
  SYNTHETIC_ORGANIZATION_A,
  SYNTHETIC_ORGANIZATION_B,
  SyntheticGeospatialRepository,
} from '../../src/geospatial/synthetic-geospatial.repository.js';
import type { GeospatialMapData } from '../../src/geospatial/geospatial.types.js';
import {
  PinoLoggerService,
  createOperationalLogger,
} from '../../src/common/logging/pino-logger.service.js';

// Test-only identity adapter and neutral role mapping. Nothing here is registered in src.
const roles: Record<string, { organizationId: string; grants: string[] }> = {
  'reader-a': {
    organizationId: SYNTHETIC_ORGANIZATION_A,
    grants: ['geospatial-reader'],
  },
  'reader-b': {
    organizationId: SYNTHETIC_ORGANIZATION_B,
    grants: ['geospatial-reader'],
  },
  'viewer-a': { organizationId: SYNTHETIC_ORGANIZATION_A, grants: [] },
  'missing-org': { organizationId: '', grants: ['geospatial-reader'] },
  'bad-org': { organizationId: 'not-a-uuid', grants: ['geospatial-reader'] },
  'development-actor': {
    organizationId: SYNTHETIC_ORGANIZATION_A,
    grants: ['geospatial-reader'],
  },
};

test('protected geospatial HTTP path authenticates, authorizes and scopes before provider access', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.CITYVUE_DEPLOYMENT_PROFILE = 'development';
  process.env.DATABASE_URL = 'postgresql://cityvue:placeholder@localhost/test';
  process.env.LOG_LEVEL = 'silent';
  delete process.env.ENTRA_TENANT_ID;
  delete process.env.ENTRA_API_CLIENT_ID;
  delete process.env.ENTRA_EXPECTED_AUDIENCE;
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const lines: string[] = [];
  const logger = Object.assign(
    Object.create(PinoLoggerService.prototype) as PinoLoggerService,
    {
      logger: createOperationalLogger(
        'info',
        { service: 'cityvue-api', version: '0.1.0', environment: 'test' },
        {
          write: (line) => {
            lines.push(line);
          },
        },
      ),
    },
  );
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('External network forbidden');
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({
      get client(): never {
        throw new Error('Database access forbidden in geospatial E2E');
      },
      status: async () => 'up',
    })
    .overrideProvider(EntraTokenService)
    .useValue({
      enabled: false,
      validate: async (token: string) => {
        if (token === 'bad') throw new UnauthorizedException();
        return {
          tenantId: 'fictional-tenant',
          objectId: token,
          scopes: token === 'no-scope' ? [] : ['access_as_user'],
        };
      },
      hasRequiredScope: (principal: { scopes: string[] }) =>
        principal.scopes.includes('access_as_user'),
    })
    .overrideProvider(StaffAuthorizationService)
    .useValue({
      resolve: async (principal: {
        objectId: string;
      }): Promise<StaffAccess> => {
        const entry = roles[principal.objectId];
        if (!entry) throw new ForbiddenException('Access denied');
        return {
          tenantId: 'fictional-tenant',
          objectId: principal.objectId,
          staffIdentityId: 'fictional-staff',
          organizationId: entry.organizationId,
          displayName: 'Fictional staff',
          scopes: ['access_as_user'],
          permissions: entry.grants.includes('geospatial-reader')
            ? ['geospatial.read']
            : [],
          departmentIds: [],
          divisionIds: [],
          development: principal.objectId === 'development-actor',
        };
      },
      assertPermission: (staff: StaffAccess, permission: Permission) => {
        StaffAuthorizationService.prototype.assertPermission(staff, permission);
      },
    })
    .overrideProvider(PinoLoggerService)
    .useValue(logger)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app);
  await app.init();
  const provider = app.get(SyntheticGeospatialRepository);
  const providerCall = t.mock.method(provider, 'getMapData');
  const config = app.get(ConfigService<AppConfiguration, true>);
  const path = '/api/v1/geospatial';
  try {
    await t.test(
      'anonymous and bad tokens return 401 with zero provider calls',
      async () => {
        await request(app.getHttpServer()).get(path).expect(401);
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer bad')
          .expect(401);
        assert.equal(providerCall.mock.callCount(), 0);
      },
    );
    await t.test(
      'missing grant and scope return 403 before provider access',
      async () => {
        for (const identity of ['viewer-a', 'no-scope']) {
          await request(app.getHttpServer())
            .get(path)
            .set('Authorization', 'Bearer ' + identity)
            .expect(403);
        }
        assert.equal(providerCall.mock.callCount(), 0);
      },
    );
    await t.test(
      'missing, malformed and development identity context fail before provider access',
      async () => {
        for (const identity of [
          'missing-org',
          'bad-org',
          'development-actor',
        ]) {
          await request(app.getHttpServer())
            .get(path)
            .set('Authorization', 'Bearer ' + identity)
            .expect(403);
        }
        assert.equal(providerCall.mock.callCount(), 0);
      },
    );
    await t.test(
      'cross-Organization hints deny generically and invoke no provider',
      async () => {
        const denied = await request(app.getHttpServer())
          .get(path)
          .query({ organizationId: SYNTHETIC_ORGANIZATION_B })
          .set('Authorization', 'Bearer reader-a')
          .expect(403);
        assert.deepEqual(denied.body, {
          statusCode: 403,
          error: 'Forbidden',
          requestId: denied.headers['x-correlation-id'],
        });
        await request(app.getHttpServer())
          .get(path)
          .query({ organizationId: 'invalid' })
          .set('Authorization', 'Bearer reader-a')
          .expect(403);
        assert.equal(providerCall.mock.callCount(), 0);
      },
    );
    await t.test(
      'authorized scoped data uses a neutral, minimal response',
      async () => {
        const a = await request(app.getHttpServer())
          .get(path)
          .query({ organizationId: SYNTHETIC_ORGANIZATION_A })
          .set('Authorization', 'Bearer reader-a')
          .set('X-Organization-Id', SYNTHETIC_ORGANIZATION_B)
          .expect(200);
        assert.equal(a.headers['cache-control'], 'no-store');
        const aData = a.body as GeospatialMapData;
        assert.deepEqual(Object.keys(aData).sort(), [
          'boundary',
          'organizationId',
          'requests',
        ]);
        assert.equal(aData.organizationId, SYNTHETIC_ORGANIZATION_A);
        assert.equal(aData.boundary.geometry.type, 'Polygon');
        assert.equal(aData.requests.type, 'FeatureCollection');
        const firstFeature = aData.requests.features[0];
        assert.ok(firstFeature);
        assert.equal(firstFeature.geometry.type, 'Point');
        assert.deepEqual(Object.keys(firstFeature.properties).sort(), [
          'category',
          'id',
          'status',
          'title',
        ]);
        const b = await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer reader-b')
          .expect(200);
        const bData = b.body as GeospatialMapData;
        assert.equal(bData.organizationId, SYNTHETIC_ORGANIZATION_B);
        assert.notDeepEqual(aData.requests.features, bData.requests.features);
        assert.deepEqual(
          providerCall.mock.calls.map((call) => call.arguments[0]),
          [SYNTHETIC_ORGANIZATION_A, SYNTHETIC_ORGANIZATION_B],
        );
      },
    );
    await t.test(
      'synthetic provider is unavailable under production or client profile',
      async () => {
        const before = providerCall.mock.callCount();
        config.set('app', {
          ...config.get('app', { infer: true }),
          environment: 'production',
        });
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer reader-a')
          .expect(503);
        config.set('app', {
          ...config.get('app', { infer: true }),
          environment: 'test',
        });
        config.set('deployment', {
          ...config.get('deployment', { infer: true }),
          profile: 'client',
        });
        await request(app.getHttpServer())
          .get(path)
          .set('Authorization', 'Bearer reader-a')
          .expect(503);
        assert.equal(providerCall.mock.callCount(), before + 2);
      },
    );
    assert.equal(network.mock.callCount(), 0);
    assert.doesNotMatch(
      lines.join(''),
      /fictional-tenant|fictional-staff|Bearer|reader-a|X-Organization-Id/i,
    );
  } finally {
    await app.close();
  }
});

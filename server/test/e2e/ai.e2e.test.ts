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
import { AiModelRegistry } from '../../src/ai/ai-model-registry.js';
import {
  createOperationalLogger,
  PinoLoggerService,
} from '../../src/common/logging/pino-logger.service.js';

test('AI HTTP boundary retains authentication, RBAC, fail-closed flags, sanitized logs and OpenAPI', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://cityvue:placeholder@localhost:5432/cityvue_test';
  process.env.LOG_LEVEL = 'silent';
  process.env.AI_ENABLED = 'false';
  process.env.AI_CHAT_ENABLED = 'false';
  process.env.ENABLE_DEVELOPMENT_STAFF_ACTIONS = 'true';
  delete process.env.ENTRA_TENANT_ID;
  delete process.env.ENTRA_API_CLIENT_ID;
  delete process.env.ENTRA_EXPECTED_AUDIENCE;
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  let tokensEnabled = false;
  let access: StaffAccess = {
    tenantId: 'test-tenant',
    objectId: 'test-object',
    staffIdentityId: 'test-staff',
    organizationId: 'test-org',
    displayName: 'EMPLOYEE_SENTINEL',
    scopes: ['access_as_user'],
    permissions: ['ai.workspace.access'],
    departmentIds: [],
    divisionIds: [],
    development: false,
  };
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
        throw new Error(
          'Development fallback/database must not be used by this test',
        );
      },
      status: async () => 'up',
    })
    .overrideProvider(EntraTokenService)
    .useValue({
      get enabled() {
        return tokensEnabled;
      },
      validate: async (token: string) => {
        if (token === 'bad') throw new UnauthorizedException('TOKEN_SECRET');
        return {
          tenantId: 'test-tenant',
          objectId: token,
          scopes: token === 'no-scope' ? [] : ['access_as_user'],
        };
      },
      hasRequiredScope: (principal: { scopes: string[] }) =>
        principal.scopes.includes('access_as_user'),
    })
    .overrideProvider(StaffAuthorizationService)
    .useValue({
      resolve: async (principal: { objectId: string }) => {
        if (principal.objectId === 'unprovisioned')
          throw new ForbiddenException('STAFF_SECRET');
        if (principal.objectId === 'dependency-failure')
          throw new Error('DATABASE_SECRET');
        return access;
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
  const config = app.get(ConfigService<AppConfiguration, true>);
  try {
    await t.test(
      'anonymous access rejected even with local fallback enabled and Entra unconfigured',
      async () => {
        for (const path of ['status', 'models']) {
          await request(app.getHttpServer())
            .get('/api/v1/ai/' + path)
            .expect(401);
        }
      },
    );
    tokensEnabled = true;
    await t.test(
      'bad tokens, missing scopes and unprovisioned identities fail closed',
      async () => {
        for (const [token, status] of [
          ['bad', 401],
          ['no-scope', 403],
          ['unprovisioned', 403],
        ] as const) {
          const response = await request(app.getHttpServer())
            .get('/api/v1/ai/models')
            .set('Authorization', 'Bearer ' + token)
            .expect(status);
          assert.deepEqual(Object.keys(response.body).sort(), [
            'error',
            'requestId',
            'statusCode',
          ]);
        }
      },
    );
    await t.test(
      'authenticated staff with unrelated or admin-only permissions are rejected',
      async () => {
        for (const permissions of [
          [],
          ['service_request.view'],
          ['ai.administration.access'],
        ] as StaffAccess['permissions'][]) {
          access = { ...access, permissions };
          for (const path of ['status', 'models']) {
            await request(app.getHttpServer())
              .get('/api/v1/ai/' + path)
              .set('Authorization', 'Bearer allowed')
              .expect(403);
          }
        }
        access = { ...access, permissions: ['ai.workspace.access'] };
      },
    );
    await t.test(
      'authorized disabled status is controlled and model listing remains unavailable',
      async () => {
        const response = await request(app.getHttpServer())
          .get('/api/v1/ai/status')
          .set('Authorization', 'Bearer allowed')
          .expect(200);
        assert.deepEqual(response.body, {
          enabled: false,
          chatEnabled: false,
          availability: 'unavailable',
        });
        assert.equal(response.headers['cache-control'], 'no-store');
        const disabled = await request(app.getHttpServer())
          .get('/api/v1/ai/models')
          .set('Authorization', 'Bearer allowed')
          .expect(503);
        assert.deepEqual(disabled.body, {
          statusCode: 503,
          error: 'ServiceUnavailable',
          requestId: disabled.headers['x-correlation-id'],
        });
      },
    );
    config.set('ai', { enabled: true, chatEnabled: false });
    await t.test(
      'enabled foundation returns empty approved metadata, never credentials or claims',
      async () => {
        await request(app.getHttpServer())
          .get('/api/v1/ai/models')
          .set('Authorization', 'Bearer allowed')
          .expect(200, []);
        const registry = app.get(AiModelRegistry);
        t.mock.method(registry, 'list', () => [
          {
            id: 'test-only',
            displayName: 'Test only',
            providerId: 'test-only',
            description: 'Test fixture',
            enabled: false,
            availability: 'unavailable' as const,
            capabilities: [],
            classificationPolicyId: null,
            apiKey: 'PROVIDER_SECRET',
          },
        ]);
        const result = await request(app.getHttpServer())
          .get('/api/v1/ai/models')
          .set('Authorization', 'Bearer allowed')
          .expect(200);
        assert.doesNotMatch(
          JSON.stringify(result.body),
          /SECRET|tenant|object|EMPLOYEE/,
        );
        assert.equal(
          (result.body as { enabled: boolean }[])[0]?.enabled,
          false,
        );
      },
    );
    await t.test(
      'dependency errors and prompt-bearing requests retain safe correlation without body logging',
      async () => {
        lines.length = 0;
        const response = await request(app.getHttpServer())
          .get('/api/v1/ai/status?prompt=PROMPT_SENTINEL')
          .set('Authorization', 'Bearer dependency-failure')
          .set('x-correlation-id', 'UNTRUSTED_SENTINEL')
          .expect(500);
        const requestId = String(response.headers['x-correlation-id']);
        assert.match(requestId, /^[0-9a-f-]{36}$/);
        assert.deepEqual(response.body, {
          statusCode: 500,
          error: 'Internal Server Error',
          requestId,
        });
        await request(app.getHttpServer())
          .post('/api/v1/ai/chat')
          .set('Authorization', 'Bearer allowed')
          .send({ prompt: 'PROMPT_SENTINEL', content: 'RESPONSE_SENTINEL' })
          .expect(404);
        assert.doesNotMatch(lines.join(''), /SENTINEL|DATABASE_SECRET|Bearer/);
        assert.ok(
          lines.some((line) => {
            const record = JSON.parse(line) as Record<string, unknown>;
            return (
              record.requestId === requestId &&
              record.route === '/api/v1/ai/status' &&
              record.statusCode === 500
            );
          }),
        );
      },
    );
    await t.test(
      'OpenAPI marks staff endpoints as bearer protected and documents model/status schemas',
      async () => {
        const document = await request(app.getHttpServer())
          .get('/api/docs-json')
          .expect(200);
        const schema = document.body as {
          paths: Record<string, { get: { security: unknown } }>;
          components: { schemas: Record<string, unknown> };
        };
        for (const path of ['status', 'models']) {
          assert.deepEqual(schema.paths['/api/v1/ai/' + path]?.get.security, [
            { bearer: [] },
          ]);
        }
        assert.ok(schema.components.schemas.AiModelDto);
        assert.ok(schema.components.schemas.AiStatusDto);
      },
    );
    assert.equal(network.mock.callCount(), 0);
  } finally {
    await app.close();
  }
});

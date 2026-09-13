import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AiGenerationDto } from '../../src/ai/ai-request.dto.js';
import { AiRouterService } from '../../src/ai/ai-router.service.js';
import { AiModelRegistry } from '../../src/ai/ai-model-registry.js';
import { AiProviderRegistry } from '../../src/ai/ai-provider-registry.js';
import { AiQuotaPolicyRegistry } from '../../src/ai/ai-quota.service.js';
import { AiUsageService } from '../../src/ai/ai-usage.service.js';
import { StaffAccessGuard } from '../../src/auth/staff-access.guard.js';
import {
  CurrentStaff,
  RequireEntra,
  RequirePermission,
} from '../../src/auth/auth.decorators.js';
import { EntraTokenService } from '../../src/auth/entra-token.service.js';
import { StaffAuthorizationService } from '../../src/auth/staff-authorization.service.js';
import { DatabaseService } from '../../src/database/database.service.js';
import type { StaffAccess, Permission } from '../../src/auth/auth.types.js';
import type { RequestWithId } from '../../src/common/logging/request-logging.middleware.js';
import {
  PinoLoggerService,
  createOperationalLogger,
} from '../../src/common/logging/pino-logger.service.js';
import {
  TestAiProvider,
  testAiProvider,
} from '../fixtures/ai-test-provider.js';
import type {
  AiUsageMetadata,
  AiUsageResult,
} from '../../src/ai/ai-governance.types.js';
let router: AiRouterService;
// This controller exists only in test compilation, never in AiModule or src.
@Controller('ai/test-harness')
@UseGuards(StaffAccessGuard)
@RequireEntra()
@RequirePermission('ai.workspace.access')
class Harness {
  @Post() generate(
    @Body() input: AiGenerationDto,
    @CurrentStaff() staff: StaffAccess,
    @Req() req: RequestWithId,
  ) {
    return router.generate(input, { staff, requestId: req.id });
  }
}
test('test-only HTTP harness verifies DTO, Entra/RBAC, correlated lifecycle and logging privacy', async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://cityvue:placeholder@localhost/test';
  process.env.LOG_LEVEL = 'silent';
  process.env.AI_ENABLED = 'false';
  process.env.AI_TEST_EXECUTION_ENABLED = 'false';
  process.env.AI_CHAT_ENABLED = 'false';
  delete process.env.ENTRA_TENANT_ID;
  delete process.env.ENTRA_API_CLIENT_ID;
  delete process.env.ENTRA_EXPECTED_AUDIENCE;
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  let permissions: Permission[] = ['ai.workspace.access'];
  const logs: string[] = [];
  const records: unknown[] = [];
  const logger = Object.assign(
    Object.create(PinoLoggerService.prototype) as PinoLoggerService,
    {
      logger: createOperationalLogger(
        'info',
        { service: 'cityvue-api', version: '0.1.0', environment: 'test' },
        { write: (line) => logs.push(line) },
      ),
    },
  );
  const provider = testAiProvider();
  let fail = false;
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [Harness],
  })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(EntraTokenService)
    .useValue({
      enabled: true,
      validate: async (token: string) => {
        if (token !== 'allowed') throw new UnauthorizedException();
        return {};
      },
      hasRequiredScope: () => true,
    })
    .overrideProvider(StaffAuthorizationService)
    .useValue({
      resolve: async () => ({
        tenantId: 'tenant',
        objectId: 'object',
        staffIdentityId: randomUUID(),
        organizationId: randomUUID(),
        displayName: 'STAFF_SECRET',
        scopes: ['access_as_user'],
        permissions,
        departmentIds: [],
        divisionIds: [],
        development: false,
      }),
      assertPermission: (staff: StaffAccess, permission: Permission) => {
        StaffAuthorizationService.prototype.assertPermission(staff, permission);
      },
    })
    .overrideProvider(AiModelRegistry)
    .useValue({
      list: () => [
        {
          id: 'test-model',
          displayName: 'Test',
          description: 'Test',
          providerId: 'test-only',
          enabled: true,
          availability: 'available',
          capabilities: ['text-generation'],
          classificationPolicyId: 'test',
          governance: {
            staffOnly: true,
            classificationPolicyId: 'test',
            quotaPolicyId: 'test-quota',
            requiredPermissions: ['ai.workspace.access'],
          },
        },
      ],
    })
    .overrideProvider(AiProviderRegistry)
    .useValue({
      resolve: () => ({
        ...provider,
        generate: async (...args: Parameters<TestAiProvider['generate']>) => {
          if (fail) throw new Error('RESPONSE_SECRET PROVIDER_SECRET');
          return provider.generate(...args);
        },
      }),
    })
    .overrideProvider(AiQuotaPolicyRegistry)
    .useValue({
      get: () => ({
        id: 'test-quota',
        rules: [{ scope: 'user', period: 'daily', requestLimit: 1 }],
      }),
    })
    .overrideProvider(AiUsageService)
    .useValue({
      begin: async (m: AiUsageMetadata, _p: unknown, denied: unknown) => {
        records.push({ metadata: m, denied });
        return 'usage';
      },
      finish: async (_id: string, _org: string, r: AiUsageResult) => {
        records.push(r);
      },
    })
    .overrideProvider(PinoLoggerService)
    .useValue(logger)
    .compile();
  const app = module.createNestApplication();
  configureApplication(app);
  await app.init();
  router = app.get(AiRouterService);
  app.get(ConfigService).set('ai', {
    enabled: true,
    chatEnabled: false,
    testExecutionEnabled: true,
  });
  const input = {
    selection: { kind: 'explicit', modelId: 'test-model' },
    messages: [{ author: 'employee', text: 'PROMPT_SECRET' }],
  };
  try {
    await t.test(
      'anonymous, invalid token and insufficient permission are rejected before usage',
      async () => {
        await request(app.getHttpServer())
          .post('/api/v1/ai/test-harness')
          .send(input)
          .expect(401);
        await request(app.getHttpServer())
          .post('/api/v1/ai/test-harness')
          .set('Authorization', 'Bearer bad')
          .send(input)
          .expect(401);
        permissions = [];
        await request(app.getHttpServer())
          .post('/api/v1/ai/test-harness')
          .set('Authorization', 'Bearer allowed')
          .send(input)
          .expect(403);
        permissions = ['ai.workspace.access'];
        assert.equal(records.length, 0);
      },
    );
    await t.test(
      'nested unknown fields, credentials and system roles fail strict global DTO validation',
      async () => {
        for (const body of [
          { ...input, apiKey: 'PROVIDER_SECRET' },
          { ...input, selection: { ...input.selection, endpoint: 'SECRET' } },
          { ...input, messages: [{ author: 'system', text: 'PROMPT_SECRET' }] },
        ])
          await request(app.getHttpServer())
            .post('/api/v1/ai/test-harness')
            .set('Authorization', 'Bearer allowed')
            .send(body)
            .expect(400);
        assert.equal(records.length, 0);
      },
    );
    await t.test(
      'authorized lifecycle uses the server correlation ID and metadata-only recording',
      async () => {
        const result = await request(app.getHttpServer())
          .post('/api/v1/ai/test-harness')
          .set('Authorization', 'Bearer allowed')
          .set('x-correlation-id', 'UNTRUSTED_SECRET')
          .send(input)
          .expect(201);
        assert.equal(
          (result.body as { requestId: string }).requestId,
          result.headers['x-correlation-id'],
        );
        assert.equal(
          (records[0] as { metadata: AiUsageMetadata }).metadata.requestId,
          (result.body as { requestId: string }).requestId,
        );
        assert.doesNotMatch(
          JSON.stringify(records),
          /SECRET|Deterministic|content|messages/,
        );
      },
    );
    await t.test(
      'provider failures retain safe error envelopes without payload logging',
      async () => {
        fail = true;
        const result = await request(app.getHttpServer())
          .post('/api/v1/ai/test-harness')
          .set('Authorization', 'Bearer allowed')
          .send(input)
          .expect(503);
        assert.deepEqual(Object.keys(result.body).sort(), [
          'error',
          'requestId',
          'statusCode',
        ]);
        assert.doesNotMatch(
          JSON.stringify(result.body) + JSON.stringify(records) + logs.join(''),
          /SECRET|PROMPT|RESPONSE|Bearer/,
        );
      },
    );
  } finally {
    await app.close();
  }
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import { ForbiddenException } from '@nestjs/common';
import { validateEnvironment } from '../../src/config/environment.js';
import { buildErrorResponse } from '../../src/common/errors/http-exception.filter.js';
import { validateAiRequest } from '../../src/ai/ai-request.dto.js';
import {
  AiRouterService,
  normalizeAiResponse,
} from '../../src/ai/ai-router.service.js';
import { AiPolicyService } from '../../src/ai/ai-policy.service.js';
import {
  AiQuotaService,
  AiQuotaPolicyRegistry,
} from '../../src/ai/ai-quota.service.js';
import { AiProviderRegistry } from '../../src/ai/ai-provider-registry.js';
import type { AiUsageService } from '../../src/ai/ai-usage.service.js';
import type {
  AiUsageMetadata,
  AiUsageResult,
} from '../../src/ai/ai-governance.types.js';
import type { AiModelDescriptor, AiProvider } from '../../src/ai/ai.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';
import { testAiProvider } from '../fixtures/ai-test-provider.js';
const staff: StaffAccess = {
  tenantId: 'tenant',
  objectId: 'object',
  organizationId: randomUUID(),
  staffIdentityId: randomUUID(),
  displayName: 'STAFF_SECRET',
  scopes: ['access_as_user'],
  permissions: ['ai.workspace.access'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
const input = {
  selection: { kind: 'explicit', modelId: 'test-model' },
  messages: [{ author: 'employee', text: 'PROMPT_SECRET' }],
};
function fixture(
  options: {
    environment?: string;
    enabled?: boolean;
    execution?: boolean;
    provider?: AiProvider | null;
    quota?: boolean;
  } = {},
) {
  const model: AiModelDescriptor = {
    id: 'test-model',
    providerId: 'test-only',
    displayName: 'Test only',
    description: 'Fixture',
    enabled: true,
    availability: 'available',
    capabilities: ['text-generation'],
    classificationPolicyId: 'test-data',
    governance: {
      staffOnly: true,
      classificationPolicyId: 'test-data',
      quotaPolicyId: 'test-quota',
      requiredPermissions: ['ai.workspace.access'],
    },
  };
  const config = new ConfigService<AppConfiguration, true>({
    app: { environment: options.environment ?? 'test' },
    ai: {
      enabled: options.enabled ?? true,
      chatEnabled: false,
      testExecutionEnabled: options.execution ?? true,
    },
  });
  const registry = { list: () => [model] };
  const quotas = new AiQuotaService({
    get: () =>
      options.quota === false
        ? undefined
        : {
            id: 'test-quota',
            rules: [{ scope: 'user', period: 'daily', requestLimit: 1 }],
          },
  });
  const records: unknown[] = [];
  let calls = 0;
  const provider =
    options.provider === undefined ? testAiProvider() : options.provider;
  const providers = {
    resolve: () =>
      provider
        ? {
            ...provider,
            generate: async (...args: Parameters<AiProvider['generate']>) => {
              calls++;
              return provider.generate(...args);
            },
          }
        : undefined,
  };
  const usage = {
    begin: async (m: AiUsageMetadata, _p: unknown, denied?: string | null) => {
      records.push({
        metadata: { ...m },
        event: denied ? 'denied' : 'accepted',
        category: denied ?? null,
      });
      return 'usage';
    },
    finish: async (_id: string, _org: string, r: AiUsageResult) => {
      records.push({ ...r });
    },
  } as unknown as AiUsageService;
  const policy = new AiPolicyService(config, registry);
  const router = new AiRouterService(
    policy,
    registry,
    providers,
    quotas,
    usage,
    config,
  );
  return {
    model,
    policy,
    router,
    records,
    usage,
    context: { requestId: randomUUID(), staff },
    calls: () => calls,
  };
}
test('request DTO constrains portable message roles and rejects extra credentials/settings at every level', () => {
  assert.deepEqual(validateAiRequest(input), input);
  for (const bad of [
    null,
    [],
    {},
    { ...input, providerId: 'vendor' },
    { ...input, apiKey: 'SECRET' },
    { ...input, requestId: randomUUID() },
    { ...input, staffIdentityId: randomUUID() },
    { ...input, settings: { system: 'SECRET' } },
    { ...input, selection: { ...input.selection, endpoint: 'SECRET' } },
    { ...input, selection: { kind: 'auto', modelId: 'test-model' } },
    { ...input, messages: [] },
    { ...input, messages: [{ author: 'system', text: 'SECRET' }] },
    { ...input, messages: [{ author: 'employee', text: ' ' }] },
    { ...input, messages: [{ author: 'employee', text: 'a'.repeat(16001) }] },
    {
      ...input,
      messages: [{ author: 'employee', text: 'x', credentials: 'SECRET' }],
    },
  ])
    assert.throws(() => validateAiRequest(bad));
});
test('governed test request correlates accepted/completed metadata and strips raw provider extras', async () => {
  const provider = testAiProvider();
  const f = fixture({
    provider: {
      ...provider,
      generate: async (...args) => ({
        ...(await provider.generate(...args)),
        raw: 'RESPONSE_SECRET',
        credentials: 'SECRET',
      }),
    },
  });
  const response = await f.router.generate(input, f.context);
  assert.equal(response.requestId, f.context.requestId);
  assert.equal(response.providerId, 'test-only');
  assert.equal(response.status, 'completed');
  assert.equal(f.calls(), 1);
  assert.deepEqual(response.usage, {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  });
  assert.doesNotMatch(
    JSON.stringify(response),
    /RESPONSE_SECRET|credentials|raw/,
  );
  assert.doesNotMatch(
    JSON.stringify(f.records),
    /PROMPT_SECRET|Deterministic|STAFF_SECRET|content|messages|tenant|object/,
  );
  assert.deepEqual((f.records[0] as { metadata: AiUsageMetadata }).metadata, {
    requestId: f.context.requestId,
    organizationId: staff.organizationId,
    staffIdentityId: staff.staffIdentityId,
    modelId: 'test-model',
    providerId: 'test-only',
    quotaPolicyId: 'test-quota',
  });
});
test('response normalization rejects wrong correlation, identifiers, token counts, finish reasons and oversized output', async () => {
  const provider = testAiProvider();
  const id = randomUUID();
  const raw = await provider.generate(input as never, {
    requestId: id,
    signal: new AbortController().signal,
  });
  for (const patch of [
    { requestId: randomUUID() },
    { modelId: 'other' },
    { providerId: 'other' },
    { finishReason: 'vendor-specific' },
    { status: 'vendor' },
    { usage: {} },
    { usage: { inputTokens: -1, outputTokens: 0, totalTokens: 0 } },
    { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 3 } },
    { content: 'x'.repeat(64001) },
  ])
    assert.throws(() =>
      normalizeAiResponse(
        { ...raw, ...patch },
        id,
        'test-model',
        'test-only',
        1,
      ),
    );
});
test('policy rejects disabled AI, unsupported/disabled models and missing governance before provider invocation', async () => {
  for (const scenario of [
    'global',
    'unknown',
    'disabled',
    'permission',
    'classification',
  ]) {
    const f = fixture({ enabled: scenario !== 'global' });
    let request = input;
    if (scenario === 'unknown')
      request = {
        ...input,
        selection: { kind: 'explicit', modelId: 'prompt-secret' },
      };
    if (scenario === 'disabled') f.model.enabled = false;
    if (scenario === 'permission') {
      assert.ok(f.model.governance);
      f.model.governance.requiredPermissions.push('ai.administration.access');
    }
    if (scenario === 'classification') f.model.classificationPolicyId = null;
    await assert.rejects(f.router.generate(request, f.context));
    assert.equal(f.calls(), 0);
    assert.doesNotMatch(
      JSON.stringify(f.records),
      /prompt-secret|PROMPT_SECRET/,
    );
    assert.equal((f.records[0] as { event: string }).event, 'denied');
  }
});
test('public/development identities and missing workspace permission cannot reach usage or providers', async () => {
  for (const change of [
    { development: true },
    { tenantId: null },
    { objectId: null },
    { permissions: [] },
  ]) {
    const f = fixture();
    await assert.rejects(
      f.router.generate(input, {
        ...f.context,
        staff: { ...staff, ...change },
      }),
      ForbiddenException,
    );
    assert.equal(f.calls(), 0);
    assert.equal(f.records.length, 0);
  }
});
test('production and default execution gates block even an injected mock; live adapters are never invoked', async () => {
  for (const options of [
    { environment: 'production' },
    { execution: false },
    {
      provider: {
        ...testAiProvider(),
        kind: 'live' as const,
        generate: async () => {
          throw Error('SECRET');
        },
      },
    },
  ]) {
    const f = fixture(options);
    await assert.rejects(f.router.generate(input, f.context));
    assert.equal(f.calls(), 0);
  }
  assert.equal(new AiProviderRegistry().resolve('anything'), undefined);
});
test('missing, unavailable and wrong-model providers fail safely after admission', async () => {
  for (const provider of [
    null,
    {
      ...testAiProvider(),
      availability: 'unavailable' as const,
      generate: (...args: Parameters<AiProvider['generate']>) =>
        testAiProvider().generate(...args),
    },
    {
      ...testAiProvider(),
      modelIds: [],
      generate: (...args: Parameters<AiProvider['generate']>) =>
        testAiProvider().generate(...args),
    },
  ]) {
    const f = fixture({ provider });
    await assert.rejects(f.router.generate(input, f.context));
    assert.equal(f.calls(), 0);
    assert.equal(
      (f.records[1] as AiUsageResult).failureCategory,
      'provider_unavailable',
    );
  }
});
test('provider exception messages and malformed request contents never reach recorded failure metadata or error envelopes', async () => {
  for (const malformed of [false, true]) {
    const f = fixture({
      provider: {
        ...testAiProvider(),
        generate: async () => {
          throw new Error('PROMPT_SECRET RESPONSE_SECRET TOKEN_SECRET');
        },
      },
    });
    await assert.rejects(
      f.router.generate(
        malformed ? { ...input, secret: 'TOKEN_SECRET' } : input,
        f.context,
      ),
      (error) => {
        assert.doesNotMatch(
          JSON.stringify(buildErrorResponse(error, f.context.requestId)),
          /SECRET/,
        );
        return true;
      },
    );
    assert.doesNotMatch(JSON.stringify(f.records), /SECRET/);
  }
});
test('timeout aborts provider signal, records failure and never exposes late output', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | undefined;
  const f = fixture({
    provider: {
      ...testAiProvider(),
      generate: async (_r, c) => {
        signal = c.signal;
        return new Promise(() => {
          /* Intentionally unresolved to exercise cancellation. */
        });
      },
    },
  });
  const pending = assert.rejects(f.router.generate(input, f.context));
  for (let i = 0; i < 10; i++) await Promise.resolve();
  t.mock.timers.tick(5000);
  await pending;
  assert.equal(signal?.aborted, true);
  assert.equal(
    (f.records[1] as AiUsageResult).failureCategory,
    'provider_timeout',
  );
});
test('recording failure blocks execution/response and exposes no database exception', async () => {
  for (const phase of ['begin', 'finish'] as const) {
    const f = fixture();
    f.usage[phase] = async () => {
      throw new Error('DATABASE_SECRET');
    };
    await assert.rejects(f.router.generate(input, f.context), (error) => {
      assert.doesNotMatch(
        JSON.stringify(buildErrorResponse(error, f.context.requestId)),
        /SECRET/,
      );
      return true;
    });
    if (phase === 'begin') assert.equal(f.calls(), 0);
  }
});
test('quota has no default policy, fails closed for unresolved dimensions, and enforces exact daily/monthly boundaries', () => {
  const empty = new AiQuotaService(new AiQuotaPolicyRegistry());
  assert.throws(() => empty.policy(undefined));
  assert.throws(() => empty.policy('production'));
  for (const scope of ['role', 'department']) {
    const q = new AiQuotaService({
      get: () => ({
        id: 'p',
        rules: [{ scope: scope as 'role', period: 'daily', requestLimit: 1 }],
      }),
    });
    assert.throws(() => q.policy('p'));
  }
  for (const period of ['daily', 'monthly'] as const) {
    const rule = { scope: 'user' as const, period, requestLimit: 2 };
    assert.doesNotThrow(() => {
      empty.assertCapacity(rule, 1);
    });
    assert.throws(() => {
      empty.assertCapacity(rule, 2);
    });
    assert.throws(() => {
      empty.assertCapacity({ ...rule, requestLimit: 0 }, 0);
    });
    assert.equal(
      empty.windowStart(rule, new Date('2026-09-13T23:59:59Z')).toISOString(),
      period === 'daily'
        ? '2026-09-13T00:00:00.000Z'
        : '2026-09-01T00:00:00.000Z',
    );
  }
});
test('unconfigured quota rejects routing before execution', async () => {
  const f = fixture({ quota: false });
  await assert.rejects(f.router.generate(input, f.context));
  assert.equal(f.calls(), 0);
  assert.equal(
    (f.records[0] as { category: string }).category,
    'quota_unconfigured',
  );
});
test('test execution flag defaults off and cannot be enabled in production or without AI', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://cityvue:placeholder@localhost/test',
  };
  assert.equal(validateEnvironment(base).AI_TEST_EXECUTION_ENABLED, false);
  assert.throws(() =>
    validateEnvironment({ ...base, AI_TEST_EXECUTION_ENABLED: 'true' }),
  );
  assert.throws(() =>
    validateEnvironment({
      ...base,
      NODE_ENV: 'production',
      AI_ENABLED: 'true',
      AI_TEST_EXECUTION_ENABLED: 'true',
    }),
  );
});

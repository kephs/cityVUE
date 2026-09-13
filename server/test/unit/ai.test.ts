import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { validateEnvironment } from '../../src/config/environment.js';
import { AiModelRegistry } from '../../src/ai/ai-model-registry.js';
import { AiPolicyService } from '../../src/ai/ai-policy.service.js';
import { AiRouterService } from '../../src/ai/ai-router.service.js';
import type {
  AiGenerationRequest,
  AiModelDescriptor,
} from '../../src/ai/ai.types.js';
import type { StaffAccess } from '../../src/auth/auth.types.js';

const staff: StaffAccess = {
  tenantId: 'test-tenant',
  objectId: 'test-object',
  organizationId: 'test-org',
  staffIdentityId: 'test-staff',
  displayName: 'Test employee',
  scopes: ['access_as_user'],
  permissions: ['ai.workspace.access'],
  departmentIds: [],
  divisionIds: [],
  development: false,
};
const request: AiGenerationRequest = {
  selection: { kind: 'explicit', modelId: 'test-model' },
  messages: [{ author: 'employee', text: 'PROMPT_SENTINEL' }],
};
const model: AiModelDescriptor = {
  id: 'test-model',
  displayName: 'Test only',
  providerId: 'test-only',
  description: 'Not an approved provider',
  enabled: false,
  availability: 'unavailable',
  capabilities: ['text-generation'],
  classificationPolicyId: null,
};
function policy(enabled = false, models: AiModelDescriptor[] = []) {
  return new AiPolicyService(
    new ConfigService({ ai: { enabled, chatEnabled: false } }),
    { list: () => models },
  );
}

test('AI configuration defaults closed and rejects chat activation and invalid feature flags', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://cityvue:placeholder@localhost/test',
  };
  const defaults = validateEnvironment(base);
  assert.equal(defaults.AI_ENABLED, false);
  assert.equal(defaults.AI_CHAT_ENABLED, false);
  for (const flags of [
    { AI_CHAT_ENABLED: 'true' },
    { AI_ENABLED: 'invalid' },
    { AI_ENABLED: 'true' },
  ]) {
    assert.throws(() => validateEnvironment({ ...base, ...flags }));
  }
  assert.equal(
    validateEnvironment({
      ...base,
      AI_ENABLED: 'true',
      ENTRA_TENANT_ID: '11111111-1111-4111-8111-111111111111',
      ENTRA_API_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
      ENTRA_EXPECTED_AUDIENCE: 'test-audience',
    }).AI_ENABLED,
    true,
  );
});

test('disabled workspace exposes only safe status and blocks model reads and routing', () => {
  const subject = policy();
  assert.deepEqual(subject.status(staff), {
    enabled: false,
    chatEnabled: false,
    availability: 'unavailable',
  });
  assert.throws(() => subject.models(staff), ServiceUnavailableException);
  assert.throws(
    () =>
      new AiRouterService(subject).generate(request, {
        staff,
        requestId: 'test',
      }),
    ServiceUnavailableException,
  );
});

test('AI requires an Entra-backed identity and explicit workspace permission, including in development', () => {
  for (const change of [
    { development: true },
    { tenantId: null },
    { objectId: null },
    { permissions: [] },
    { permissions: ['ai.administration.access'] as StaffAccess['permissions'] },
  ]) {
    assert.throws(
      () => policy(true).models({ ...staff, ...change }),
      ForbiddenException,
    );
  }
});

test('administration requires its own permission and does not imply workspace admission', () => {
  assert.throws(() => {
    policy().assertAdministrationAccess(staff);
  }, ForbiddenException);
  assert.doesNotThrow(() => {
    policy().assertAdministrationAccess({
      ...staff,
      permissions: ['ai.workspace.access', 'ai.administration.access'],
    });
  });
});

test('registry is empty and metadata projection cannot expose internal secrets', () => {
  assert.deepEqual(new AiModelRegistry().list(), []);
  const internal = {
    ...model,
    apiKey: 'SECRET_SENTINEL',
    endpoint: 'PRIVATE_ENDPOINT',
    claims: { secret: true },
  };
  assert.deepEqual(policy(true, [internal]).models(staff), [model]);
});

test('router always evaluates policy; unknown, disabled, auto and even enabled models cannot generate', (t) => {
  const network = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('Network is forbidden');
  });
  const subject = policy(true, [model]);
  const evaluation = t.mock.method(subject, 'authorizeGeneration');
  assert.throws(
    () =>
      new AiRouterService(subject).generate(request, {
        staff,
        requestId: 'test',
      }),
    ForbiddenException,
  );
  assert.equal(evaluation.mock.callCount(), 1);
  for (const modelId of ['unknown', 'auto']) {
    assert.throws(
      () =>
        subject.authorizeGeneration(
          { ...request, selection: { kind: 'explicit', modelId } },
          staff,
        ),
      ForbiddenException,
    );
  }
  const enabled = policy(true, [
    {
      ...model,
      enabled: true,
      availability: 'available',
      classificationPolicyId: 'test-only',
    },
  ]);
  assert.throws(
    () =>
      new AiRouterService(enabled).generate(request, {
        staff,
        requestId: 'test',
      }),
    ServiceUnavailableException,
  );
  assert.equal(network.mock.callCount(), 0);
});

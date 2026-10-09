import 'reflect-metadata';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service.js';
import { TenantDomainRepository } from '../../src/tenancy/tenant-domain.repository.js';

const production = {
  NODE_ENV: 'production',
  CITYVUE_DEPLOYMENT_PROFILE: 'client',
  DATABASE_URL: 'postgresql://localhost/fictional_serving_test',
  DATABASE_SSL_MODE: 'verify-full',
  TENANT_RESOLUTION_STRATEGY: 'registry',
  TENANT_HOST_SOURCE: 'forwarded',
  TENANT_TRUSTED_PROXY_CIDRS: '127.0.0.1,::1',
  REQRO_PUBLIC_HOSTNAMES: 'requests.example.gov',
  CORS_ORIGINS: 'https://requests.example.gov',
  LOG_LEVEL: 'silent',
};

test('real HTTP entry point refuses unsafe production configuration with sanitized diagnostics', () => {
  const modulePath = resolve(__dirname, '../../src/main.js');
  const child = spawnSync(process.execPath, [modulePath], {
    cwd: resolve(__dirname, '../../..'),
    env: {
      ...process.env,
      ...production,
      REQRO_PUBLIC_HOSTNAMES: 'sensitive-marker/invalid',
      DEVELOPMENT_ORGANIZATION_ID: undefined,
    },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(child.error, undefined);
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /Production serving configuration rejected/);
  assert.match(child.stderr, /REQRO_PUBLIC_HOSTNAMES/);
  assert.doesNotMatch(child.stderr, /sensitive-marker|at .*\.js:/);
});

test('production HTTP startup preserves zero-binding state and non-credentialed exact CORS', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, production);
  delete process.env.DEVELOPMENT_ORGANIZATION_ID;
  let app: INestApplication | undefined;
  try {
    const [{ AppModule }, { configureApplication }] = await Promise.all([
      import('../../src/app.module.js'),
      import('../../src/bootstrap.js'),
    ]);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(DatabaseService)
      .useValue({ status: async () => 'up' })
      .overrideProvider(TenantDomainRepository)
      .useValue({ findResolvable: async () => [] })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/alerts/active')
      .set('X-Forwarded-Host', 'requests.example.gov')
      .expect(404);
    const allowed = await request(app.getHttpServer())
      .options('/api/v1/alerts/active')
      .set('Origin', 'https://requests.example.gov')
      .set('Access-Control-Request-Method', 'GET')
      .expect(204);
    assert.equal(
      allowed.headers['access-control-allow-origin'],
      'https://requests.example.gov',
    );
    assert.equal(
      allowed.headers['access-control-allow-credentials'],
      undefined,
    );
    const denied = await request(app.getHttpServer())
      .options('/api/v1/alerts/active')
      .set('Origin', 'https://other.example.gov')
      .set('Access-Control-Request-Method', 'GET');
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  } finally {
    await app?.close();
    for (const key of Object.keys(process.env))
      if (!(key in previous)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, previous);
  }
});

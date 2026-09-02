import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service.js';

let app: INestApplication;

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://cityvue:placeholder@localhost:5432/cityvue_test';
  process.env.LOG_LEVEL = 'silent';

  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .compile();

  app = module.createNestApplication();
  configureApplication(app);
  await app.init();
});

after(async () => {
  await app.close();
});

test('GET /api/v1/health reports readiness and returns a request ID', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/v1/health')
    .set('x-correlation-id', 'e2e-request-1234')
    .expect(200);

  assert.deepEqual(response.body, {
    status: 'ok',
    service: 'cityvue-api',
    version: '0.1.0',
    database: 'up',
  });
  assert.equal(response.headers['x-correlation-id'], 'e2e-request-1234');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('GET /api/v1/health/live does not require PostgreSQL readiness', async () => {
  await request(app.getHttpServer()).get('/api/v1/health/live').expect(200, {
    status: 'ok',
    service: 'cityvue-api',
    version: '0.1.0',
  });
});

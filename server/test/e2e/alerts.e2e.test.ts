import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AlertsRepository } from '../../src/alerts/alerts.repository.js';
import { DatabaseService } from '../../src/database/database.service.js';

let app: INestApplication;
let rows: Record<string, unknown>[] = [];
let fail = false;
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
    .overrideProvider(AlertsRepository)
    .useValue({
      listActive: async (organizationId: string, now: Date) => {
        assert.ok(organizationId);
        assert.ok(now instanceof Date);
        if (fail) throw new Error('private database details');
        return rows;
      },
    })
    .compile();
  app = module.createNestApplication();
  configureApplication(app);
  await app.init();
});
after(async () => app.close());
test('anonymous empty read has no cache and correlation/security headers', async () => {
  const result = await request(app.getHttpServer())
    .get('/api/v1/alerts/active')
    .expect(200);
  assert.deepEqual(result.body, []);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.ok(result.headers['x-correlation-id']);
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
});
test('public API projects content only, suppresses unsafe rows and image URLs', async () => {
  const now = new Date();
  rows = [
    {
      id: 'public-id',
      type: 'notice',
      severity: 'info',
      title: 'Notice',
      message: 'Update',
      starts_at: now,
      expires_at: null,
      published_at: now,
      updated_at: now,
      link_url: null,
      link_label: null,
      created_by: 'private-actor',
      organization_id: 'private-org',
      image_url: 'https://example.com/tracker',
    },
  ];
  const result = await request(app.getHttpServer())
    .get('/api/v1/alerts/active')
    .expect(200);
  const first = (result.body as Record<string, unknown>[])[0];
  assert.ok(first);
  assert.deepEqual(
    Object.keys(first).sort(),
    [
      'id',
      'type',
      'severity',
      'title',
      'message',
      'startsAt',
      'expiresAt',
      'publishedAt',
      'updatedAt',
      'linkUrl',
      'linkLabel',
    ].sort(),
  );
  rows = [{ ...rows[0], link_url: 'javascript:alert(1)' }];
  const invalid = await request(app.getHttpServer())
    .get('/api/v1/alerts/active')
    .expect(200);
  assert.deepEqual(invalid.body, []);
});
test('administrative routes remain unregistered', async () => {
  for (const path of [
    '/api/v1/alerts',
    '/api/v1/alerts/active',
    '/api/v1/alerts/id/publish',
    '/api/v1/alerts/id/deactivate',
  ])
    await request(app.getHttpServer())
      .post(path)
      .send({ title: 'Injected' })
      .expect(404);
  await request(app.getHttpServer()).patch('/api/v1/alerts/id').expect(404);
  await request(app.getHttpServer()).delete('/api/v1/alerts/id').expect(404);
});
test('repository failures use sanitized platform errors', async () => {
  fail = true;
  const result = await request(app.getHttpServer())
    .get('/api/v1/alerts/active')
    .expect(500);
  assert.doesNotMatch(JSON.stringify(result.body), /private database details/);
  fail = false;
});

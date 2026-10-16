import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service.js';
import { InternalRequesterService } from '../../src/service-request/internal-requester.service.js';

const MINE = '/api/v1/my/internal-service-requests';
const REQUEST_ID = '10000000-0000-4000-8000-000000000055';

test('F064.1 requester portal admission, privacy headers and sanitized failures over actual HTTP', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/cityvue_test';
  process.env.DEVELOPMENT_ORGANIZATION_ID =
    '10000000-0000-4000-8000-000000000001';
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const detail = {
    id: REQUEST_ID,
    reference: 'SYNTHETIC-64',
    issue: { name: 'Fictional internal service', icon: null },
    status: 'in_progress',
    submittedAt: '2026-09-24T00:00:00.000Z',
    lastUpdateAt: '2026-09-24T01:00:00.000Z',
    serviceLocation: null,
    description: 'Fictional internal description',
    updates: [
      {
        id: '10000000-0000-4000-8000-000000000056',
        body: 'Fictional internal update',
        createdAt: '2026-09-24T01:00:00.000Z',
        direction: 'outbound',
        channel: 'portal',
        deliveryState: 'recorded',
        sender: { displayName: 'Service team' },
      },
    ],
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(InternalRequesterService)
    .useValue({
      list: async () => ({
        items: [detail],
        page: 1,
        pageSize: 25,
        hasMore: false,
      }),
      detail: async () => detail,
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.init();
  try {
    // Entra is not configured in this harness, so no caller can be admitted:
    // the requester routes have no development fallback of any kind.
    for (const path of [MINE, `${MINE}/${REQUEST_ID}`]) {
      const anonymous = await request(app.getHttpServer()).get(path);
      assert.ok(
        [401, 403].includes(anonymous.status),
        `${path} must refuse an unauthenticated caller, got ${String(anonymous.status)}`,
      );
      assert.equal(anonymous.headers['cache-control'], 'no-store');
      assert.equal(anonymous.headers['referrer-policy'], 'no-referrer');
      assert.equal(anonymous.headers['x-robots-tag'], 'noindex, nofollow');
      assert.ok(!JSON.stringify(anonymous.body).includes('SECRET'));
    }
    // A guest tracking credential is not an admission mechanism here.
    const credentialed = await request(app.getHttpServer())
      .get(`${MINE}/${REQUEST_ID}`)
      .set('X-Requester-Tracking', 'F064_TRACKING_SECRET');
    assert.ok([401, 403].includes(credentialed.status));
    assert.ok(!JSON.stringify(credentialed.body).includes('SECRET'));
    // A forged context cannot be injected through the query string or body.
    const forged = await request(app.getHttpServer()).get(
      `${MINE}?organizationId=10000000-0000-4000-8000-000000000001&staffIdentityId=10000000-0000-4000-8000-000000000002`,
    );
    assert.ok([401, 403].includes(forged.status));
    assert.ok(!JSON.stringify(forged.body).includes('F064_'));
  } finally {
    await app.close();
  }
});

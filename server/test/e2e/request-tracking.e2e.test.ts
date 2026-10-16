import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service.js';
import { RequestTrackingService } from '../../src/service-request/request-tracking.service.js';
import {
  PinoLoggerService,
  createOperationalLogger,
} from '../../src/common/logging/pino-logger.service.js';

test('F044 actual HTTP rate limiting, privacy headers and sanitized failures protect credential header/path/query/body', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/cityvue_test';
  process.env.DEVELOPMENT_ORGANIZATION_ID =
    '10000000-0000-4000-8000-000000000001';
  process.env.RATE_LIMIT_MAX = '4';
  process.env.RATE_LIMIT_TTL_MS = '60000';
  const lines: string[] = [];
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const logger = {
    log() {
      /* Nest bootstrap chatter is excluded from this HTTP capture. */
    },
    error() {
      /* Nest bootstrap chatter is excluded from this HTTP capture. */
    },
    warn() {
      /* Nest bootstrap chatter is excluded from this HTTP capture. */
    },
    debug() {
      /* Nest bootstrap chatter is excluded from this HTTP capture. */
    },
    verbose() {
      /* Nest bootstrap chatter is excluded from this HTTP capture. */
    },
    fatal() {
      /* Nest bootstrap chatter is excluded from this HTTP capture. */
    },
    logger: createOperationalLogger(
      'info',
      { service: 'cityvue-api', version: '0.1.0', environment: 'test' },
      {
        write: (line) => {
          lines.push(line);
        },
      },
    ),
  } as unknown as PinoLoggerService;
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(RequestTrackingService)
    .useValue({
      track: (value: unknown) => {
        if (value === 'F044_SYNTHETIC_ERROR_SECRET')
          throw new Error('F044_SYNTHETIC_ERROR_SECRET');
        throw new NotFoundException();
      },
    })
    .overrideProvider(PinoLoggerService)
    .useValue(logger)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.init();
  try {
    for (let i = 0; i < 5; i++) {
      const response = await request(app.getHttpServer())
        .get('/api/v1/requester-tracking?token=F044_QUERY_SECRET')
        .set(
          'X-Requester-Tracking',
          i === 0 ? 'F044_SYNTHETIC_ERROR_SECRET' : 'F044_HEADER_SECRET',
        )
        .expect(i === 0 ? 500 : i === 4 ? 429 : 404);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['referrer-policy'], 'no-referrer');
      assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
      assert.ok(!JSON.stringify(response.body).includes('SECRET'));
    }
    await request(app.getHttpServer())
      .get('/api/v1/F044_PATH_SECRET')
      .expect(404);
    await request(app.getHttpServer())
      .post(
        '/api/v1/staff/service-requests/10000000-0000-4000-8000-000000000001/requester-tracking/issue',
      )
      .send({ credential: 'F044_BODY_SECRET' })
      .expect(401)
      .expect('Cache-Control', 'no-store');
    const serialized = lines.join('');
    assert.ok(serialized.includes('/api/v1/requester-tracking'));
    for (const marker of [
      'F044_QUERY_SECRET',
      'F044_SYNTHETIC_ERROR_SECRET',
      'F044_HEADER_SECRET',
      'F044_PATH_SECRET',
      'F044_BODY_SECRET',
    ])
      assert.ok(!serialized.includes(marker));
  } finally {
    await app.close();
    delete process.env.RATE_LIMIT_MAX;
    delete process.env.RATE_LIMIT_TTL_MS;
  }
});

test('F063.1 a successful resident read carries updates with privacy headers intact and no staff identity', async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://localhost:5432/cityvue_test';
  process.env.DEVELOPMENT_ORGANIZATION_ID =
    '10000000-0000-4000-8000-000000000001';
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const projection = {
    reference: 'SYNTHETIC-63',
    issue: { name: 'Fictional service', icon: null },
    status: 'in_progress',
    submittedAt: '2026-09-21T00:00:00.000Z',
    serviceLocation: null,
    description: 'Fictional description',
    updates: [
      {
        id: '10000000-0000-4000-8000-000000000009',
        body: 'Fictional update for the requester',
        createdAt: '2026-09-21T01:00:00.000Z',
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
    .overrideProvider(RequestTrackingService)
    .useValue({ track: async () => projection })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.init();
  try {
    const response = await request(app.getHttpServer())
      .get('/api/v1/requester-tracking')
      .set('X-Requester-Tracking', 'A'.repeat(43))
      .expect(200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.equal(response.headers['x-robots-tag'], 'noindex, nofollow');
    const body = response.body as typeof projection;
    assert.deepEqual(body.updates, projection.updates);
    assert.equal(body.updates.length, 1);
    assert.equal(body.updates[0]?.sender.displayName, 'Service team');
    const serialized = JSON.stringify(body);
    for (const forbidden of [
      'author_display_name',
      'author_staff_identity_id',
      'staffIdentityId',
      'submission_key',
      'organization_id',
      'A'.repeat(43),
    ])
      assert.ok(
        !serialized.includes(forbidden),
        `${forbidden} must not appear in a resident response`,
      );
  } finally {
    await app.close();
  }
});

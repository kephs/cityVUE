import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { NotFoundException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ResidentExperienceRepository } from '../../src/resident-experience/resident-experience.repository.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { phoneFixture } from '../helpers/resident-experience.fixture.js';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import {
  createOperationalLogger,
  PinoLoggerService,
} from '../../src/common/logging/pino-logger.service.js';

let app: INestApplication;
let snapshot: unknown = null;
let failure: Error | null = null;
let reads = 0;
const organizationId = '00000000-0000-4000-8000-000000000059';
const logLines: string[] = [];
before(async () => {
  process.env.NODE_ENV = 'test';
  // Configuration-only placeholder; DatabaseService is replaced and never connects.
  process.env.DATABASE_URL =
    'postgresql://cityvue:placeholder@localhost:5432/cityvue_test';
  process.env.DEVELOPMENT_ORGANIZATION_ID = organizationId;
  process.env.LOG_LEVEL = 'silent';
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const logService = new PinoLoggerService({
    get: (key: string) => (key === 'logging.level' ? 'silent' : 'test'),
  } as unknown as ConfigService<AppConfiguration, true>);
  Object.defineProperty(logService, 'logger', {
    value: createOperationalLogger(
      'trace',
      { service: 'cityvue-api', version: '0.1.0', environment: 'test' },
      {
        write: (line) => {
          logLines.push(line);
        },
      },
    ),
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PinoLoggerService)
    .useValue(logService)
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(ResidentExperienceRepository)
    .useValue({
      getPublished: async (org: string) => {
        reads++;
        assert.equal(org, organizationId);
        if (failure) throw failure;
        return snapshot;
      },
    })
    .compile();
  app = module.createNestApplication();
  configureApplication(app);
  await app.init();
});
after(async () => {
  await app.close();
});
test('anonymous unpublished response is explicit and no-store', async () => {
  const response = await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .expect(200);
  assert.deepEqual(response.body, { schemaVersion: 1, configuration: null });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});
for (const selector of [
  'organizationId=forged',
  'preview=1',
  'draft=1',
  'revision=other',
  'unknown=1',
]) {
  test(`rejects unsupported selector ${selector}`, async () => {
    const beforeReads = reads;
    await request(app.getHttpServer())
      .get(`/api/v1/resident-experience?${selector}`)
      .expect(400);
    assert.equal(reads, beforeReads);
  });
}
test('body selectors are rejected; Host and browser headers cannot choose Organization', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .send({ organizationId: 'forged' })
    .expect(400);
  snapshot = phoneFixture();
  const result = await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .set('Host', 'other.example.org')
    .set('X-Forwarded-Host', 'other.example.org')
    .set('X-Organization-Id', 'forged')
    .expect(200);
  assert.doesNotMatch(
    JSON.stringify(result.body),
    /organizationId|organization_id|actor|revision_id|contacts|guidance|draft|correlation|approval/,
  );
  assert.match(JSON.stringify(result.body), /Call \+1 \(202\) 555-0100/);
});

test('empty JSON containers and unparsed text bodies are rejected before reading', async () => {
  const beforeReads = reads;
  for (const body of [{}, []])
    await request(app.getHttpServer())
      .get('/api/v1/resident-experience')
      .send(body)
      .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .set('Content-Type', 'text/plain')
    .send('draft=1')
    .expect(400);
  assert.equal(reads, beforeReads);
});
for (const malformed of ['asset', 'missing-asset', 'action'])
  test(`malformed ${malformed} fails safely`, async () => {
    const input = phoneFixture();
    if (malformed === 'asset')
      input.presentation.hero.assetKey = 'https://private.example/image';
    if (malformed === 'missing-asset')
      Reflect.deleteProperty(input.presentation.hero, 'assetKey');
    if (malformed === 'action') {
      assert.ok(input.actions[0]);
      input.actions[0].target = '/admin';
    }
    snapshot = input;
    const result = await request(app.getHttpServer())
      .get('/api/v1/resident-experience')
      .expect(503);
    assert.doesNotMatch(
      JSON.stringify(result.body),
      /private.example|presentation|555-0100|\/admin/,
    );
  });
test('inactive Organization and persistence failures expose no private diagnostics', async () => {
  failure = new NotFoundException();
  await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .expect(404);
  failure = new Error('private SQL and content');
  const result = await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .expect(503);
  assert.doesNotMatch(JSON.stringify(result.body), /private SQL|content/);
  failure = null;
});
test('no public mutations, previews or publication endpoints are registered', async () => {
  for (const method of ['post', 'put', 'patch', 'delete'] as const) {
    const client = request(app.getHttpServer());
    await client[method]('/api/v1/resident-experience').send({}).expect(404);
  }
  for (const suffix of ['draft', 'preview', 'publish', 'history']) {
    await request(app.getHttpServer())
      .get(`/api/v1/resident-experience/${suffix}`)
      .expect(404);
  }
});

test('normal request and failure logs exclude public content, selectors, authorization and raw errors', async () => {
  const marker = 'RESIDENT_PRIVATE_LOG_SENTINEL';
  logLines.length = 0;
  snapshot = phoneFixture();
  await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .set('Authorization', `Bearer ${marker}`)
    .expect(200);
  await request(app.getHttpServer())
    .get(`/api/v1/resident-experience?draft=${marker}`)
    .expect(400);
  await request(app.getHttpServer())
    .get('/api/v1/resident-experience')
    .send({ presentation: marker, actorId: marker, organizationId: marker })
    .expect(400);
  failure = new Error(`SQL https://example.org/${marker} ${organizationId}`);
  try {
    await request(app.getHttpServer())
      .get('/api/v1/resident-experience')
      .expect(503);
  } finally {
    failure = null;
  }
  const logs = logLines.join('');
  assert.match(logs, /Resident experience unavailable/);
  assert.match(logs, /request completed|request errored/);
  assert.doesNotMatch(
    logs,
    /RESIDENT_PRIVATE_LOG_SENTINEL|555-0100|Synthetic|Bearer|https:|presentation|contacts|actorId|organizationId|draft=|SQL/,
  );
  assert.ok(!logs.includes(organizationId));
});

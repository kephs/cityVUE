import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
  Controller,
  Get,
  Header,
  HttpException,
  Param,
  Post,
  Redirect,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service.js';
import { AttachmentService } from '../../src/attachments/attachment.service.js';

// Test-only routes exercise the real bootstrap/parser/filter/throttler lifecycle.
// No production guard or authorization provider is replaced.
@Controller('cache-contract')
class CacheContractController {
  @Get()
  get() {
    return { ok: true };
  }

  @Post()
  create() {
    return { created: true };
  }

  @Get('error/:status')
  error(@Param('status') status: string) {
    throw new HttpException('Synthetic failure', Number(status));
  }

  @Get('explicit')
  @Header('Cache-Control', 'private, no-store')
  explicit() {
    return { ok: true };
  }

  @Get('prior')
  prior() {
    return { ok: true };
  }

  @Get('redirect')
  @Redirect('/api/v1/health/live', 302)
  redirect() {
    return undefined;
  }

  @Get('limited')
  @Throttle({ default: { limit: 1, ttl: 60000 } })
  limited() {
    return { ok: true };
  }
}

const csp =
  "default-src 'self';base-uri 'self';font-src 'self' https: data:;" +
  "form-action 'self';frame-ancestors 'self';img-src 'self' data:;" +
  "object-src 'none';script-src 'self';script-src-attr 'none';" +
  "style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests";
const baseline = {
  'content-security-policy': csp,
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
function checkHeaders(headers: Record<string, unknown>, cache = 'no-store') {
  assert.equal(headers['cache-control'], cache);
  for (const [name, value] of Object.entries(baseline))
    assert.equal(headers[name], value, name);
  assert.equal(headers['content-security-policy-report-only'], undefined);
  assert.equal(headers['permissions-policy'], undefined);
}

let app: INestApplication;
const previous = { ...process.env };
const bytes = Buffer.from('synthetic image response');
const origin = 'http://localhost:5173';

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    CITYVUE_DEPLOYMENT_PROFILE: 'development',
    TENANT_RESOLUTION_STRATEGY: 'development',
    TENANT_HOST_SOURCE: 'direct',
    DATABASE_URL:
      'postgresql://cityvue:placeholder@localhost:5432/cityvue_test',
    DEVELOPMENT_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: origin,
    RATE_LIMIT_MAX: '200',
    RATE_LIMIT_TTL_MS: '60000',
  });
  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  const module = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [CacheContractController],
  })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(AttachmentService)
    .useValue({
      preview: async () => ({
        bytes,
        metadata: { mediaType: 'image/png', byteSize: bytes.length },
      }),
    })
    .compile();
  app = module.createNestApplication({ logger: false });
  // An earlier explicit policy is also preserved, independently of later ones.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/api/v1/cache-contract/prior')
      res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
  configureApplication(app);
  await app.init();
});

after(async () => {
  await app.close();
  for (const key of Object.keys(process.env))
    if (!(key in previous)) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, previous);
});

test('ordinary 200/201 and real health responses get the default and unchanged Helmet headers', async () => {
  for (const path of [
    '/api/v1/cache-contract',
    '/api/v1/health/live',
    '/api/v1/health/ready',
  ]) {
    const response = await request(app.getHttpServer()).get(path).expect(200);
    checkHeaders(response.headers);
    assert.match(
      String(response.headers['content-type']),
      /^application\/json/,
    );
  }
  const response = await request(app.getHttpServer())
    .post('/api/v1/cache-contract')
    .send({})
    .expect(201);
  checkHeaders(response.headers);
  assert.deepEqual(response.body, { created: true });
});

for (const status of [400, 401, 403, 404, 409, 429, 500]) {
  test(`HTTP ${String(status)} through the real exception filter remains no-store with baseline headers`, async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/cache-contract/error/${String(status)}`)
      .expect(status);
    checkHeaders(response.headers);
    const body = response.body as { statusCode: unknown };
    assert.equal(body.statusCode, status);
    assert.match(
      String(response.headers['content-type']),
      /^application\/json/,
    );
  });
}

test('malformed JSON is no-store even when body parsing fails before controller dispatch', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/cache-contract')
    .set('Content-Type', 'application/json')
    .send('{"broken":')
    .expect(400);
  checkHeaders(response.headers);
  assert.match(String(response.headers['content-type']), /^application\/json/);
});

test('unmatched API routes and dedicated API listener 404s cannot become cached HTML', async () => {
  for (const path of [
    '/api/v1/no-such-resource',
    '/api/unknown',
    '/not-a-static-origin',
  ]) {
    const response = await request(app.getHttpServer()).get(path).expect(404);
    checkHeaders(response.headers);
    assert.match(
      String(response.headers['content-type']),
      /^application\/json/,
    );
  }
});

test('existing earlier middleware and later controller cache policies both win over the default', async () => {
  for (const path of ['prior', 'explicit']) {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/cache-contract/${path}`)
      .expect(200);
    checkHeaders(response.headers, 'private, no-store');
  }
});

test('real attachment preview keeps its specialized cache header, MIME and bytes', async () => {
  const response = await request(app.getHttpServer())
    .get(
      '/api/v1/intake/attachments/batches/10000000-0000-4000-8000-000000000101/files/10000000-0000-4000-8000-000000000102',
    )
    .set('Origin', origin)
    .set('X-Reqro-Attachment', 'a'.repeat(43))
    .expect(200);
  checkHeaders(response.headers, 'private, no-store');
  assert.match(String(response.headers['content-type']), /^image\/png/);
  assert.equal(response.headers['content-disposition'], 'attachment');
  assert.deepEqual(response.body, bytes);
});

test('real attachment origin and workforce guards preserve private no-store on denials', async () => {
  const deniedOrigin = await request(app.getHttpServer())
    .get('/api/v1/intake/attachments/policy')
    .set('Origin', 'https://unapproved.example')
    .expect(403);
  checkHeaders(deniedOrigin.headers, 'private, no-store');
  const noIdentity = await request(app.getHttpServer())
    .get(
      '/api/v1/staff/attachments/requests/10000000-0000-4000-8000-000000000001/evidence',
    )
    .expect(401);
  checkHeaders(noIdentity.headers, 'private, no-store');
});

test('real throttler rejection retains default no-store and baseline headers', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/cache-contract/limited')
    .expect(200);
  const response = await request(app.getHttpServer())
    .get('/api/v1/cache-contract/limited')
    .expect(429);
  checkHeaders(response.headers);
});

test('redirect and CORS preflight get no-store without changing their destination or CORS contract', async () => {
  const redirect = await request(app.getHttpServer())
    .get('/api/v1/cache-contract/redirect')
    .expect(302);
  checkHeaders(redirect.headers);
  assert.equal(redirect.headers.location, '/api/v1/health/live');
  const preflight = await request(app.getHttpServer())
    .options('/api/v1/cache-contract')
    .set('Origin', origin)
    .set('Access-Control-Request-Method', 'POST')
    .expect(204);
  checkHeaders(preflight.headers);
  assert.equal(preflight.headers['access-control-allow-origin'], origin);
  assert.equal(
    preflight.headers['access-control-allow-credentials'],
    undefined,
  );
});

/**
 * SEC-001 reassessment evidence (bounded, non-destructive).
 *
 * Exercises the real HTTP stack: real controllers, real global/controller/route
 * guards, real throttler and the real FileInterceptor. Only AttachmentService
 * and DatabaseService are replaced, so no PostgreSQL connection is required and
 * no production source is modified.
 *
 * The question under test is ordering: does Multer parse an attacker-supplied
 * multipart body before or after origin, capability-token and identity checks?
 * Payloads are intentionally tiny; nothing here is a load or DoS test.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseService } from '../../src/database/database.service.js';
import { AttachmentService } from '../../src/attachments/attachment.service.js';
import { attachmentLimits } from '../../src/attachments/attachment.domain.js';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const BATCH_ID = '10000000-0000-4000-8000-000000000101';
const FILE_ID = '10000000-0000-4000-8000-000000000102';
const TOKEN = 'a'.repeat(43);
const BOUNDARY = 'sec001HttpReassessmentBoundary';
const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

const textPart = (name: string, value: string) =>
  Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
const filePart = (name: string, filename: string, body: Buffer) =>
  Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
    ),
    body,
    Buffer.from('\r\n'),
  ]);
const multipart = (...parts: Buffer[]) =>
  Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]);

/** The advisory field-name shape, as text fields. Tiny and deterministic. */
const advisoryFields = multipart(
  textPart('items[4294967294]', '1'),
  textPart('items[text]', '1'),
);

let app: INestApplication;
/** Observations from the stubbed service, reset per test. */
const observed = {
  admitted: 0,
  handled: 0,
  lastFileSize: -1,
  admitMode: 'allow' as 'allow' | 'reject' | 'unavailable',
  acquireMode: 'allow' as 'allow' | 'unavailable',
};
const reset = (
  admitMode: (typeof observed)['admitMode'] = 'allow',
  acquireMode: (typeof observed)['acquireMode'] = 'allow',
) => {
  observed.admitted = 0;
  observed.handled = 0;
  observed.lastFileSize = -1;
  observed.admitMode = admitMode;
  observed.acquireMode = acquireMode;
};

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    'postgresql://cityvue:placeholder@localhost:5432/cityvue_test';
  process.env.LOG_LEVEL = 'silent';
  process.env.CORS_ORIGINS = ALLOWED_ORIGIN;
  process.env.RATE_LIMIT_MAX = '200';
  process.env.RATE_LIMIT_TTL_MS = '60000';

  const [{ AppModule }, { configureApplication }] = await Promise.all([
    import('../../src/app.module.js'),
    import('../../src/bootstrap.js'),
  ]);
  // Mirrors the real service contract the controller and guards depend on.
  const attachments = {
    acquire() {
      if (observed.acquireMode === 'unavailable')
        throw new ServiceUnavailableException('Attachments are unavailable.');
      return () => undefined;
    },
    async admit() {
      if (observed.admitMode === 'unavailable')
        throw new ServiceUnavailableException('Attachments are unavailable.');
      if (observed.admitMode === 'reject') throw new NotFoundException();
      observed.admitted++;
    },
    async upload(
      _claim: unknown,
      _fileId: string,
      file: { buffer: Buffer } | undefined,
    ) {
      observed.handled++;
      observed.lastFileSize = file ? file.buffer.length : -1;
      return {
        id: FILE_ID,
        filename: 'synthetic.png',
        mediaType: 'image/png',
        byteSize: observed.lastFileSize,
        state: 'CLEAN',
      };
    },
  };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseService)
    .useValue({ status: async () => 'up' })
    .overrideProvider(AttachmentService)
    .useValue(attachments)
    .compile();
  app = module.createNestApplication({ logger: false });
  configureApplication(app);
  await app.init();
});

after(async () => {
  await app.close();
});

const intakeUpload = () =>
  request(app.getHttpServer())
    .post(`/api/v1/intake/attachments/batches/${BATCH_ID}/files/${FILE_ID}`)
    .set('Content-Type', CONTENT_TYPE);
const staffUpload = () =>
  request(app.getHttpServer())
    .post(`/api/v1/staff/attachments/batches/${BATCH_ID}/files/${FILE_ID}`)
    .set('Content-Type', CONTENT_TYPE);

test('SEC-001 control: a well-formed anonymous upload reaches the handler, so absence assertions are meaningful', async () => {
  reset();
  const response = await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(
      multipart(filePart('file', 'synthetic.png', Buffer.from('synthetic'))),
    )
    .expect(201);

  assert.equal(observed.admitted, 1);
  assert.equal(observed.handled, 1, 'the control request must reach Multer');
  assert.equal(observed.lastFileSize, 9);
  assert.equal(response.headers['cache-control'], 'private, no-store');
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
});

test('SEC-001 a disallowed Origin is rejected before Multer parses the advisory field shapes', async () => {
  reset();
  await intakeUpload()
    .set('Origin', 'https://attacker.example')
    .set('x-reqro-attachment', TOKEN)
    .send(advisoryFields)
    .expect(403);

  assert.equal(observed.admitted, 0, 'origin must be checked before admission');
  assert.equal(observed.handled, 0, 'Multer must never parse this body');
});

test('SEC-001 an unusable batch capability is rejected before Multer parses the advisory field shapes', async () => {
  reset('reject');
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', 'not-a-valid-token')
    .send(advisoryFields)
    .expect(404);
  assert.equal(observed.handled, 0, 'Multer must never parse this body');

  reset('reject');
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .send(advisoryFields)
    .expect(404);
  assert.equal(observed.handled, 0, 'a missing token must not reach Multer');
});

test('SEC-001 a disabled attachment surface fails closed before Multer parses', async () => {
  reset('allow', 'unavailable');
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(advisoryFields)
    .expect(503);

  assert.equal(observed.admitted, 0);
  assert.equal(observed.handled, 0, 'Multer must never parse this body');
});

test('SEC-001 the staff upload route requires workforce identity before Multer parses', async () => {
  reset();
  await staffUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(advisoryFields)
    .expect(401);

  assert.equal(observed.admitted, 0);
  assert.equal(observed.handled, 0, 'Multer must never parse this body');
});

test('SEC-001 an admitted request carrying the advisory field shapes is rejected without reaching the handler', async () => {
  reset();
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(advisoryFields)
    .expect(400);

  assert.equal(observed.admitted, 1, 'the capability check ran first');
  assert.equal(
    observed.handled,
    0,
    'the field-count limit must stop the request before the handler',
  );

  // The process survived and the route still works.
  reset();
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(multipart(filePart('file', 'synthetic.png', Buffer.from('ok'))))
    .expect(201);
  assert.equal(observed.handled, 1);
});

test('SEC-001 parser limits and malformed multipart surface sanitized HTTP failures', async () => {
  reset();
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(
      multipart(
        filePart('file', 'a.png', Buffer.alloc(attachmentLimits.fileBytes, 0)),
      ),
    )
    .expect(413);
  assert.equal(observed.handled, 0);

  reset();
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(
      multipart(
        filePart('file', 'a.png', Buffer.from('one')),
        filePart('file', 'b.png', Buffer.from('two')),
      ),
    )
    .expect(400);
  assert.equal(observed.handled, 0);

  reset();
  await intakeUpload()
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(multipart(filePart('f'.repeat(41), 'a.png', Buffer.from('one'))))
    .expect(400);
  assert.equal(observed.handled, 0);

  reset();
  const malformed = await request(app.getHttpServer())
    .post(`/api/v1/intake/attachments/batches/${BATCH_ID}/files/${FILE_ID}`)
    .set('Content-Type', 'multipart/form-data')
    .set('Origin', ALLOWED_ORIGIN)
    .set('x-reqro-attachment', TOKEN)
    .send(multipart(filePart('file', 'a.png', Buffer.from('one'))))
    .expect(400);
  assert.equal(observed.handled, 0);
  // Parser internals must not leak through the sanitized error contract.
  assert.deepEqual(Object.keys(malformed.body as object).sort(), [
    'error',
    'requestId',
    'statusCode',
  ]);
});

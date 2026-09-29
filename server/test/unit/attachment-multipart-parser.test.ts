/**
 * SEC-001 reassessment evidence (bounded, non-destructive).
 *
 * These tests read the ACTUAL FileInterceptor that
 * `IntakeAttachmentController.upload` is decorated with, via Nest's route
 * metadata, and drive its real Multer instance. No production source is
 * modified and no production configuration is duplicated: the limits and
 * storage engine asserted here are the ones the running application uses.
 *
 * Purpose: determine whether the recorded Multer advisories are reachable
 * through Reqro's configured parser. Inputs are deliberately tiny and
 * deterministic; nothing here is a load or DoS test.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { INTERCEPTORS_METADATA } from '@nestjs/common/constants';
import { IntakeAttachmentController } from '../../src/attachments/attachment.controller.js';
import { attachmentLimits } from '../../src/attachments/attachment.domain.js';

interface MulterLimits {
  fileSize?: number;
  files?: number;
  fields?: number;
  parts?: number;
  fieldNameSize?: number;
  headerPairs?: number;
}
type MulterNext = (error?: unknown) => void;
type MulterMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: MulterNext,
) => void;
interface MulterInstance {
  limits?: MulterLimits;
  storage: object;
  fileFilter: (
    req: unknown,
    file: unknown,
    callback: (error: Error | null, accept?: boolean) => void,
  ) => void;
  single: (field: string) => MulterMiddleware;
}
interface ConfiguredInterceptor {
  multer: MulterInstance;
}
interface ParsedRequest {
  body?: Record<string, unknown>;
  file?: { originalname: string; size: number };
}
/** Multer assigns `Object.create(null)`, so key inspection replaces deep equality. */
const appendedFields = (request: ParsedRequest) =>
  Object.keys(request.body ?? {});
interface ObservedError {
  code?: string;
  message?: string;
}

/** The production interceptor instance, taken from the real route metadata. */
function productionInterceptor(): ConfiguredInterceptor {
  const handler = Object.getOwnPropertyDescriptor(
    IntakeAttachmentController.prototype,
    'upload',
  )?.value as object | undefined;
  assert.ok(handler, 'the intake upload handler must be resolvable');
  const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, handler) as
    (new (options?: unknown) => unknown)[] | undefined;
  assert.ok(
    interceptors?.length === 1,
    'the intake upload route must declare exactly one interceptor',
  );
  const Interceptor = interceptors[0];
  assert.ok(Interceptor, 'the intake upload interceptor must be resolvable');
  // MulterModule is not registered, so Nest injects `{}` for MULTER_MODULE_OPTIONS.
  return new Interceptor() as ConfiguredInterceptor;
}

const BOUNDARY = 'sec001ReassessmentBoundary';
const textPart = (name: string, value: string) =>
  Buffer.from(
    `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
  );
const filePart = (name: string, filename: string, type: string, body: Buffer) =>
  Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    body,
    Buffer.from('\r\n'),
  ]);
const closing = Buffer.from(`--${BOUNDARY}--\r\n`);
const multipart = (...parts: Buffer[]) => Buffer.concat([...parts, closing]);

/** Runs the real configured parser over a synthetic request body. */
function parse(
  middleware: MulterMiddleware,
  body: Buffer,
  contentType = `multipart/form-data; boundary=${BOUNDARY}`,
): Promise<{ error: ObservedError | undefined; request: ParsedRequest }> {
  const stream = new PassThrough();
  const request = stream as unknown as IncomingMessage & ParsedRequest;
  request.headers = {
    'content-type': contentType,
    'content-length': String(body.length),
  };
  return new Promise((resolve) => {
    middleware(request, {} as ServerResponse, (error?: unknown) => {
      resolve({ error: error as ObservedError | undefined, request });
    });
    stream.end(body);
  });
}

test('SEC-001 the production intake interceptor uses memory storage and a synchronous file filter', () => {
  const { multer } = productionInterceptor();

  // CVE-2026-77037 (aborted-upload file-descriptor leak) is diskStorage-only.
  assert.equal(multer.storage.constructor.name, 'MemoryStorage');
  assert.equal(
    Object.hasOwn(multer.storage, 'getDestination'),
    false,
    'a DiskStorage engine must never be constructed for this route',
  );

  // CVE-2026-77063 (fileSize bypass) requires an asynchronous fileFilter.
  let filtered = false;
  multer.fileFilter({}, { fieldname: 'file' }, () => {
    filtered = true;
  });
  assert.equal(
    filtered,
    true,
    'the configured fileFilter must complete synchronously',
  );
});

test('SEC-001 the production intake interceptor declares the limits the reassessment relies on', () => {
  const limits = productionInterceptor().multer.limits;
  assert.deepEqual(limits, {
    fileSize: attachmentLimits.fileBytes,
    files: 1,
    fields: 0,
    parts: 2,
    fieldNameSize: 40,
    headerPairs: 20,
  });
  assert.equal(attachmentLimits.fileBytes, 5 * 1024 * 1024);
});

test('SEC-001 the configured parser never reaches append-field, so the field-name advisories are unreachable', async () => {
  const middleware = productionInterceptor().multer.single('file');

  // Control first: prove `fields: 0` suppresses field emission for a benign
  // name. If this assertion ever fails, the advisory shapes below are not
  // safe to send and this test stops before sending them.
  const control = await parse(middleware, multipart(textPart('benign', '1')));
  assert.equal(control.error?.code, 'LIMIT_FIELD_COUNT');
  assert.deepEqual(
    appendedFields(control.request),
    [],
    'no text field may ever be appended to the request body',
  );

  // CVE-2026-82333: `items[4294967294]` then a non-numeric key on the same
  // base object drives a synchronous sparse-array conversion inside
  // append-field. Rejected at the field-count limit before append-field runs.
  const arrayIndex = await parse(
    middleware,
    multipart(textPart('items[4294967294]', '1'), textPart('items[text]', '1')),
  );
  assert.equal(arrayIndex.error?.code, 'LIMIT_FIELD_COUNT');
  assert.deepEqual(appendedFields(arrayIndex.request), []);

  // CVE-2026-77078: crafted text field names raise an uncaught
  // `RangeError: Invalid array length` inside append-field. Reaching
  // append-field at all would terminate this process rather than reject.
  const rangeError = await parse(
    middleware,
    multipart(textPart('items[0]', '1'), textPart('items[4294967295]', '1')),
  );
  assert.equal(rangeError.error?.code, 'LIMIT_FIELD_COUNT');
  assert.deepEqual(appendedFields(rangeError.request), []);

  // Fields accompanying a legitimate file part are rejected the same way.
  const withFile = await parse(
    middleware,
    multipart(
      filePart('file', 'a.png', 'image/png', Buffer.from('nope')),
      textPart('items[4294967294]', '1'),
      textPart('items[text]', '1'),
    ),
  );
  assert.equal(withFile.error?.code, 'LIMIT_FIELD_COUNT');
  assert.deepEqual(appendedFields(withFile.request), []);

  // The parser is still usable: none of the above degraded the process.
  const accepted = await parse(
    middleware,
    multipart(filePart('file', 'a.png', 'image/png', Buffer.from('small'))),
  );
  assert.equal(accepted.error, undefined);
  assert.equal(accepted.request.file?.size, 5);
});

test('SEC-001 the configured parser enforces file size, count and field-name length', async () => {
  const middleware = productionInterceptor().multer.single('file');

  const oversized = await parse(
    middleware,
    multipart(
      filePart(
        'file',
        'a.png',
        'image/png',
        Buffer.alloc(attachmentLimits.fileBytes + 1, 0),
      ),
    ),
  );
  assert.equal(oversized.error?.code, 'LIMIT_FILE_SIZE');

  // Busboy flags a file the moment it reaches `fileSize`, so the largest body
  // the parser accepts is one byte below the configured limit. The domain rule
  // in assertAttachmentCount rejects above the limit, so the parser is stricter
  // by a single byte. Recorded as observed behavior, not as a finding.
  const belowLimit = await parse(
    middleware,
    multipart(
      filePart(
        'file',
        'a.png',
        'image/png',
        Buffer.alloc(attachmentLimits.fileBytes - 1, 0),
      ),
    ),
  );
  assert.equal(belowLimit.error, undefined);
  assert.equal(belowLimit.request.file?.size, attachmentLimits.fileBytes - 1);

  const exactlyAtLimit = await parse(
    middleware,
    multipart(
      filePart(
        'file',
        'a.png',
        'image/png',
        Buffer.alloc(attachmentLimits.fileBytes, 0),
      ),
    ),
  );
  assert.equal(exactlyAtLimit.error?.code, 'LIMIT_FILE_SIZE');

  const twoFiles = await parse(
    middleware,
    multipart(
      filePart('file', 'a.png', 'image/png', Buffer.from('one')),
      filePart('file', 'b.png', 'image/png', Buffer.from('two')),
    ),
  );
  assert.equal(twoFiles.error?.code, 'LIMIT_FILE_COUNT');

  const longFieldName = await parse(
    middleware,
    multipart(
      filePart('f'.repeat(41), 'a.png', 'image/png', Buffer.from('one')),
    ),
  );
  assert.equal(longFieldName.error?.code, 'LIMIT_FIELD_KEY');

  const unexpectedField = await parse(
    middleware,
    multipart(filePart('other', 'a.png', 'image/png', Buffer.from('one'))),
  );
  assert.equal(unexpectedField.error?.code, 'LIMIT_UNEXPECTED_FILE');
});

test('SEC-001 malformed multipart input is rejected without terminating the process', async () => {
  const middleware = productionInterceptor().multer.single('file');

  const noBoundary = await parse(
    middleware,
    multipart(filePart('file', 'a.png', 'image/png', Buffer.from('one'))),
    'multipart/form-data',
  );
  assert.match(String(noBoundary.error?.message), /Boundary not found/);

  const malformedHeader = await parse(
    middleware,
    Buffer.from(`--${BOUNDARY}\r\nnot-a-header\r\n\r\nvalue\r\n`),
  );
  assert.ok(malformedHeader.error, 'a malformed part header must be rejected');

  const truncated = await parse(
    middleware,
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      Buffer.from('partial'),
    ]),
  );
  assert.match(String(truncated.error?.message), /Unexpected end of form/);

  const missingName = await parse(
    middleware,
    Buffer.concat([
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data\r\n\r\nvalue\r\n`,
      ),
      closing,
    ]),
  );
  assert.ok(
    missingName.error === undefined || typeof missingName.error === 'object',
    'a nameless part must not terminate the process',
  );

  // The parser still works after every malformed input above.
  const accepted = await parse(
    middleware,
    multipart(filePart('file', 'a.png', 'image/png', Buffer.from('ok'))),
  );
  assert.equal(accepted.error, undefined);
});

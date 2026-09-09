import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../src/config/configuration.js';
import {
  createOperationalLogger,
  PinoLoggerService,
} from '../../src/common/logging/pino-logger.service.js';
import {
  commandFailure,
  safeErrorContext,
} from '../../src/common/logging/log-sanitization.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { selectRequestId } from '../../src/common/logging/request-logging.middleware.js';
import { requestLogContext } from '../../src/common/logging/log-sanitization.js';
import type { Request } from 'express';

const sentinel = 'HARMLESS_SECRET_SENTINEL';
const safeId = '3e4666bf-d5e5-4aa7-b8ce-cefe41c7568a';
const metadata = {
  service: 'cityvue-api',
  version: 'test',
  environment: 'test',
};

function capture() {
  const lines: string[] = [];
  const logger = createOperationalLogger('trace', metadata, {
    write: (line) => {
      lines.push(line);
    },
  });
  return {
    logger,
    lines,
    records: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

test('direct, child, nested, error, string and interpolation paths omit secret payloads', () => {
  const output = capture();
  const secrets = Object.fromEntries(
    [
      'password',
      'passwd',
      'secret',
      'clientSecret',
      'client_secret',
      'token',
      'accessToken',
      'access_token',
      'refreshToken',
      'refresh_token',
      'idToken',
      'id_token',
      'apiKey',
      'api_key',
      'authorization',
      'cookie',
      'set-cookie',
      'privateKey',
      'private_key',
      'Authorization',
      'Proxy-Authorization',
      'X-API-Key',
    ].map((key) => [key, sentinel]),
  );
  const error = Object.assign(
    new Error(`postgresql://user:${sentinel}@localhost/db`),
    { code: 'ECONNREFUSED', context: secrets },
  );
  const context = {
    ...secrets,
    headers: secrets,
    req: { headers: secrets, url: `/?token=${sentinel}` },
    res: { headers: secrets },
    nested: secrets,
    err: error,
    requestId: safeId,
    method: 'GET',
    statusCode: 503,
  };
  output.logger.error(context, 'Unhandled request error');
  output.logger.info(JSON.stringify(context));
  output.logger.info('CityVUE API started %s', sentinel);
  output.logger.error(error);
  output.logger
    .child(context)
    .child({ nested: secrets })
    .info('request completed');
  output.logger.info({
    context: {
      toJSON() {
        throw new Error('Must not stringify arbitrary context');
      },
    },
  });
  assert.doesNotMatch(output.lines.join(''), new RegExp(sentinel));
  assert.equal(output.records()[0]?.requestId, safeId);
  assert.equal(output.records()[0]?.method, 'GET');
  assert.equal(output.records()[0]?.statusCode, 503);
  assert.equal(output.records()[0]?.errorCode, 'ECONNREFUSED');
  assert.equal(output.records()[0]?.errorName, 'Error');
  assert.equal(output.records()[0]?.msg, 'Unhandled request error');
  assert.equal(output.records()[0]?.service, 'cityvue-api');
  assert.equal(typeof output.records()[0]?.time, 'number');
  assert.equal(output.records()[0]?.level, 50);
});

test('retained values cannot smuggle secrets through IDs, route fields, or metadata', () => {
  const output = capture();
  const untrusted = {
    requestId: sentinel,
    reqId: sentinel,
    route: '/reset-password/' + sentinel,
    component: sentinel,
    name: sentinel,
    version: sentinel,
    service: sentinel,
  };
  output.logger.info(untrusted, 'request completed');
  output.logger.child(untrusted).info('request completed');
  output.logger.info(
    { requestId: selectRequestId(sentinel) },
    'request completed',
  );
  const metadataLines: string[] = [];
  createOperationalLogger(
    'info',
    {
      service: 'postgresql://user:' + sentinel + '@localhost/db',
      version: sentinel,
      environment: sentinel,
    },
    {
      write: (line) => {
        metadataLines.push(line);
      },
    },
  ).info('CityVUE API started');
  const metadataRecord = JSON.parse(metadataLines[0] ?? '{}') as Record<
    string,
    unknown
  >;
  assert.equal(metadataRecord.service, 'cityvue-api');
  assert.equal(metadataRecord.version, 'unknown');
  assert.equal(metadataRecord.environment, 'unknown');
  assert.doesNotMatch(
    output.lines.join('') + metadataLines.join(''),
    new RegExp(sentinel),
  );
  assert.equal(output.records()[0]?.route, undefined);
  assert.equal(output.records()[1]?.route, undefined);
  assert.equal(output.records()[0]?.requestId, undefined);
  assert.equal(typeof output.records()[2]?.requestId, 'string');
  output.logger.child({ reqId: sentinel }).info('request completed');
  assert.equal(output.records()[3]?.requestId, undefined);
  assert.doesNotMatch(output.lines.join(''), new RegExp(sentinel));
  const normal: string[] = [];
  createOperationalLogger(
    'info',
    { service: 'cityvue-api', version: '0.1.0', environment: 'production' },
    {
      write: (line) => {
        normal.push(line);
      },
    },
  ).info('CityVUE API started');
  assert.equal(
    (JSON.parse(normal[0] ?? '{}') as Record<string, unknown>).version,
    '0.1.0',
  );
});

test('route provenance survives only a direct trusted HTTP context, never copies or child bindings', () => {
  const output = capture();
  const req = {
    id: safeId,
    method: 'GET',
    route: { path: '/records/:id' },
    headers: {},
  } as unknown as Request;
  const context = requestLogContext(req);
  output.logger.info(context, 'request completed');
  output.logger.info(
    { ...context, route: '/reset-password/' + sentinel },
    'request completed',
  );
  output.logger.child(context).info('request completed');
  output.logger.info({}, 'request completed');
  assert.equal(output.records()[0]?.route, '/records/:id');
  for (const item of output.records().slice(1))
    assert.equal(item.route, undefined);
  assert.doesNotMatch(output.lines.join(''), new RegExp(sentinel));
});

test('Nest wrappers retain safe structured fields without stringifying message objects or stacks', () => {
  const output = capture();
  const config = {
    get: (key: string) => (key === 'logging.level' ? 'silent' : 'test'),
  } as unknown as ConfigService<AppConfiguration, true>;
  const service = new PinoLoggerService(config);
  Object.defineProperty(service, 'logger', { value: output.logger });
  for (const method of [
    'log',
    'error',
    'warn',
    'debug',
    'verbose',
    'fatal',
  ] as const) {
    service[method](
      { requestId: safeId, password: sentinel },
      `stack ${sentinel}`,
      { token: sentinel },
    );
    service[method](`postgresql://user:${sentinel}@localhost/db`);
  }
  assert.doesNotMatch(output.lines.join(''), new RegExp(sentinel));
  assert.equal(output.records()[0]?.requestId, safeId);
  assert.equal(output.records()[0]?.component, 'nest');
});

test('error names/codes are classifications, never arbitrary error strings', () => {
  assert.deepEqual(safeErrorContext({ name: sentinel, code: sentinel }), {
    errorName: 'UnknownError',
    errorCode: 'unknown',
  });
  const line = commandFailure(
    'Migration command failed',
    Object.assign(new Error(`Invalid server configuration: ${sentinel}`), {
      code: '28P01',
    }),
  );
  assert.doesNotMatch(line, new RegExp(sentinel));
  assert.match(line, /28P01/);
  assert.match(line, /Invalid server configuration/);
});

test('readiness and idle pool errors use the safe policy without connecting', async () => {
  const output = capture();
  const values: Record<string, unknown> = {
    'app.environment': 'test',
    'database.url': `postgresql://user:${sentinel}@localhost/db`,
    'database.sslMode': 'disable',
    'database.poolMax': 1,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<AppConfiguration, true>;
  const service = new DatabaseService(config, {
    logger: output.logger,
  } as PinoLoggerService);
  const pool = (
    service as unknown as {
      pool: { emit: (event: string, error: Error) => void };
    }
  ).pool;
  const error = Object.assign(new Error(sentinel), {
    code: 'ECONNREFUSED',
    detail: sentinel,
  });
  Object.defineProperty(pool, 'connect', {
    value: () => Promise.reject(error),
  });
  try {
    pool.emit('error', error);
    assert.equal(await service.status(), 'down');
    assert.equal(output.records().length, 2);
    for (const item of output.records())
      assert.equal(item.errorCode, 'ECONNREFUSED');
    assert.doesNotMatch(output.lines.join(''), new RegExp(sentinel));
  } finally {
    await service.onApplicationShutdown();
  }
});

test('migration, seed and API startup configuration failures never echo credentials or CA paths', () => {
  for (const script of [
    'database/migration-cli.js',
    'database/seed-development.js',
    'main.js',
  ]) {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, '../../src', script), 'status'],
      {
        env: {
          SystemRoot: process.env.SystemRoot,
          NODE_ENV: 'production',
          DATABASE_SSL_MODE: 'verify-full',
          DATABASE_URL: `postgresql://user:${sentinel}@localhost/db?sslmode=disable`,
          DATABASE_SSL_CA_FILE: sentinel,
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(
      result.status,
      1,
      `${script}: ${result.error?.name ?? 'unexpected exit'}`,
    );
    assert.doesNotMatch(result.stdout + result.stderr, new RegExp(sentinel));
    assert.match(result.stderr, /Invalid server configuration/);
    assert.doesNotMatch(result.stderr, /ECONNREFUSED/);
  }
});

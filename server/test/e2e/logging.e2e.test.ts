import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Controller, Post, Req, Res } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import {
  createOperationalLogger,
  type PinoLoggerService,
} from '../../src/common/logging/pino-logger.service.js';
import { RequestLoggingMiddleware } from '../../src/common/logging/request-logging.middleware.js';
import { HttpExceptionFilter } from '../../src/common/errors/http-exception.filter.js';

const sentinels = [
  'AUTH_SENTINEL',
  'COOKIE_SENTINEL',
  'SET_COOKIE_SENTINEL',
  'PASSWORD_SENTINEL',
  'ACCESS_TOKEN_SENTINEL',
  'CLIENT_SECRET_SENTINEL',
  'API_KEY_SENTINEL',
  'QUERY_SENTINEL',
  'ERROR_CONTEXT_SENTINEL',
  'URL_PASSWORD_SENTINEL',
  'PATH_SENTINEL',
  'BODY_SENTINEL',
];

@Controller('logging-test')
class LoggingTestController {
  @Post('records/:id')
  execute(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Set-Cookie', 'session=SET_COOKIE_SENTINEL');
    res.setHeader('X-API-Key', 'API_KEY_SENTINEL');
    req.log.info(
      {
        context: req.body,
        headers: {
          Authorization: 'AUTH_SENTINEL',
          'Set-Cookie': 'SET_COOKIE_SENTINEL',
        },
      },
      'request completed',
    );
    if (req.headers['x-test-error']) {
      throw Object.assign(
        new Error('postgresql://user:URL_PASSWORD_SENTINEL@localhost/db'),
        {
          code: 'ECONNRESET',
          context: { secret: 'ERROR_CONTEXT_SENTINEL' },
          access_token: 'ACCESS_TOKEN_SENTINEL',
        },
      );
    }
    return { value: 'BODY_SENTINEL' };
  }
}

test('real HTTP success/error logs retain correlation and templates while omitting sensitive request/response data', async () => {
  const lines: string[] = [];
  const logger = {
    logger: createOperationalLogger(
      'info',
      { service: 'cityvue-api', version: 'test', environment: 'test' },
      {
        write: (line) => {
          lines.push(line);
        },
      },
    ),
  } as PinoLoggerService;
  const module = await Test.createTestingModule({
    controllers: [LoggingTestController],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  const middleware = new RequestLoggingMiddleware(logger);
  app.use((req: Request, _res: Response, next: () => void) => {
    req.id = 'PRESET_ID_SENTINEL';
    next();
  });
  app.use(middleware.use.bind(middleware));
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  await app.init();
  try {
    for (const fails of [false, true]) {
      lines.length = 0;
      const response = await request(app.getHttpServer())
        .post(
          '/logging-test/records/PATH_SENTINEL?token=QUERY_SENTINEL&access_token=ACCESS_TOKEN_SENTINEL&api_key=API_KEY_SENTINEL&key=QUERY_SENTINEL&secret=QUERY_SENTINEL&password=PASSWORD_SENTINEL&person=QUERY_SENTINEL',
        )
        .set('Authorization', 'Bearer AUTH_SENTINEL')
        .set('Proxy-Authorization', 'Bearer AUTH_SENTINEL')
        .set('Cookie', 'session=COOKIE_SENTINEL')
        .set('X-API-Key', 'API_KEY_SENTINEL')
        .set('x-correlation-id', 'HARMLESS_API_TOKEN_SENTINEL_123456')
        .set('x-test-error', fails ? 'yes' : '')
        .send({
          nested: {
            password: 'PASSWORD_SENTINEL',
            access_token: 'ACCESS_TOKEN_SENTINEL',
            clientSecret: 'CLIENT_SECRET_SENTINEL',
            apiKey: 'API_KEY_SENTINEL',
            url: 'postgresql://user:URL_PASSWORD_SENTINEL@localhost/db',
          },
        })
        .expect(fails ? 500 : 201);
      const requestId = String(response.headers['x-correlation-id']);
      assert.match(
        requestId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      assert.doesNotMatch(lines.join(''), /HARMLESS_API_TOKEN_SENTINEL_123456/);
      assert.doesNotMatch(lines.join(''), /PRESET_ID_SENTINEL/);
      if (fails)
        assert.deepEqual(response.body, {
          statusCode: 500,
          error: 'Internal Server Error',
          requestId,
        });
      const records = lines.map(
        (line) => JSON.parse(line) as Record<string, unknown>,
      );
      assert.ok(records.every((item) => item.requestId === requestId));
      const completion = records.find(
        (item) =>
          item.statusCode === (fails ? 500 : 201) &&
          typeof item.durationMs === 'number',
      );
      assert.ok(completion);
      assert.equal(completion.requestId, requestId);
      assert.equal(completion.method, 'POST');
      assert.equal(completion.route, '/logging-test/records/:id');
      assert.equal(completion.requestContentType, 'application/json');
      assert.equal(completion.responseContentType, 'application/json');
      if (fails)
        assert.ok(
          records.some(
            (item) =>
              item.errorCode === 'ECONNRESET' &&
              item.msg === 'Unhandled request error',
          ),
        );
      for (const sentinel of sentinels)
        assert.doesNotMatch(lines.join(''), new RegExp(sentinel));
    }
    lines.length = 0;
    await request(app.getHttpServer())
      .get('/PATH_SENTINEL?token=QUERY_SENTINEL')
      .expect(404);
    assert.doesNotMatch(lines.join(''), /PATH_SENTINEL|QUERY_SENTINEL/);
    assert.match(lines.join(''), /unmatched/);
    lines.length = 0;
    const inboundUuid = '3e4666bf-d5e5-4aa7-b8ce-cefe41c7568a';
    const uuidResponse = await request(app.getHttpServer())
      .post('/logging-test/records/123')
      .set('x-correlation-id', inboundUuid)
      .send({})
      .expect(201);
    assert.notEqual(uuidResponse.headers['x-correlation-id'], inboundUuid);
    assert.doesNotMatch(lines.join(''), new RegExp(inboundUuid));
    assert.ok(
      lines.some(
        (line) =>
          (JSON.parse(line) as Record<string, unknown>).requestId ===
          uuidResponse.headers['x-correlation-id'],
      ),
    );
  } finally {
    await app.close();
  }
});

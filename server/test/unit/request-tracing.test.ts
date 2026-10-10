import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import {
  Controller,
  Get,
  Post,
  Param,
  ForbiddenException,
  Module,
  type NestModule,
  type MiddlewareConsumer,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { Request, Response } from 'express';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace';
import {
  RequestTracing,
  createTraceRuntime,
  type TraceRuntimeFactory,
} from '../../src/observability/request-tracing.js';
import {
  RequestTracingModule,
  TRACE_RUNTIME_FACTORY,
} from '../../src/observability/request-tracing.module.js';
import { RequestTracingMiddleware } from '../../src/observability/request-tracing.middleware.js';
import { LoggingModule } from '../../src/common/logging/logging.module.js';
import { RequestLoggingMiddleware } from '../../src/common/logging/request-logging.middleware.js';
import { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';
import { HttpExceptionFilter } from '../../src/common/errors/http-exception.filter.js';
import { validateEnvironment } from '../../src/config/environment.js';

const secret = 'PRIVATE_SENTINEL';
const uuid = '12345678-1234-4123-8123-123456789abc';
const incomingTraceId = '0123456789abcdef0123456789abcdef';

@Controller()
class FixtureController {
  @Get('service-requests/:serviceRequestId')
  read(@Param('serviceRequestId') id: string) {
    if (id === 'failure') throw new Error(secret);
    if (id === 'refused') throw new ForbiddenException(secret);
    return { ok: true };
  }
  @Post('service-requests')
  create() {
    return { ok: true, privateResponse: secret };
  }
  @Get(['health', 'health/live', 'health/ready'])
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [LoggingModule, RequestTracingModule],
  controllers: [FixtureController],
})
class HarnessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestLoggingMiddleware, RequestTracingMiddleware)
      .forRoutes('*');
  }
}

async function harness(enabled: boolean, factory?: TraceRuntimeFactory) {
  const exporter = new InMemorySpanExporter();
  const processor = new SimpleSpanProcessor({ exporter });
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            telemetry: { requestTracingEnabled: enabled },
            logging: { level: 'silent' },
            app: { name: 'cityvue-api', version: '0.1.0', environment: 'test' },
          }),
        ],
      }),
      HarnessModule,
    ],
  })
    .overrideProvider(TRACE_RUNTIME_FACTORY)
    .useValue(factory ?? (() => createTraceRuntime([processor])))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter(app.get(PinoLoggerService)));
  await app.init();
  return { app, exporter, processor };
}

test('default/explicit tracing configuration is validated without enabling a production exporter', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:placeholder@localhost/test',
    DEVELOPMENT_ORGANIZATION_ID: uuid,
  };
  assert.equal(validateEnvironment(base).REQRO_REQUEST_TRACING_ENABLED, false);
  assert.equal(
    validateEnvironment({ ...base, REQRO_REQUEST_TRACING_ENABLED: 'true' })
      .REQRO_REQUEST_TRACING_ENABLED,
    true,
  );
  assert.equal(
    validateEnvironment({ ...base, REQRO_REQUEST_TRACING_ENABLED: 'false' })
      .REQRO_REQUEST_TRACING_ENABLED,
    false,
  );
  assert.throws(() =>
    validateEnvironment({
      ...base,
      REQRO_REQUEST_TRACING_ENABLED: 'not-a-boolean',
    }),
  );
});

test('disabled tracing preserves request handling and never initializes the SDK', async () => {
  let initialized = 0;
  const h = await harness(false, () => {
    initialized++;
    throw new Error(secret);
  });
  try {
    await request(h.app.getHttpServer())
      .get(`/api/v1/service-requests/${uuid}`)
      .expect(200, { ok: true });
    assert.equal(initialized, 0);
    assert.equal(h.exporter.getFinishedSpans().length, 0);
  } finally {
    await h.app.close();
  }
});

test('SDK initialization failure does not prevent Nest startup or request handling', async () => {
  const h = await harness(true, () => {
    throw new Error(secret);
  });
  try {
    await request(h.app.getHttpServer())
      .get(`/api/v1/service-requests/${uuid}`)
      .expect(200);
  } finally {
    await h.app.close();
  }
});

test('completed request produces one server root with only approved attributes and distinct server correlation', async () => {
  const h = await harness(true);
  try {
    const response = await request(h.app.getHttpServer())
      .get(`/api/v1/service-requests/${uuid}?token=${secret}`)
      .set('authorization', `Bearer ${secret}`)
      .set('cookie', `private=${secret}`)
      .set('Host', `${secret}.example.invalid`)
      .set('X-Forwarded-Host', `${secret}.example.invalid`)
      .set('x-correlation-id', uuid)
      .set('x-organization-id', secret)
      .set('traceparent', `00-${incomingTraceId}-0123456789abcdef-01`)
      .set('tracestate', `private=${secret}`)
      .set('baggage', `private=${secret}`)
      .expect(200);
    await h.processor.forceFlush();
    const spans = h.exporter.getFinishedSpans();
    assert.equal(spans.length, 1);
    const span = spans[0];
    assert.ok(span);
    const correlation: unknown = response.headers['x-correlation-id'];
    assert.equal(typeof correlation, 'string');
    assert.notEqual(correlation, uuid);
    assert.equal(span.name, 'GET /api/v1/service-requests/:serviceRequestId');
    assert.equal(span.kind, SpanKind.SERVER);
    assert.equal(span.parentSpanContext, undefined);
    assert.notEqual(span.spanContext().traceId, incomingTraceId);
    assert.notEqual(span.spanContext().traceId, correlation);
    assert.notEqual(span.spanContext().spanId, correlation);
    assert.deepEqual(span.attributes, {
      'http.request.method': 'GET',
      'http.route': '/api/v1/service-requests/:serviceRequestId',
      'http.response.status_code': 200,
      'reqro.outcome': 'succeeded',
      'reqro.reason': 'none',
      'reqro.correlation_id': correlation,
    });
    assert.deepEqual(span.resource.attributes, {
      'service.name': 'cityvue-api',
    });
    assert.deepEqual(span.links, []);
    assert.deepEqual(span.events, []);
    assert.equal(JSON.stringify(span.attributes).includes(secret), false);
    assert.equal(JSON.stringify(span.attributes).includes(uuid), false);
  } finally {
    await h.app.close();
  }
});

test('all inbound tracing headers leave tenant, staff authority, audit identity and correlation untouched', async () => {
  const exporter = new InMemorySpanExporter();
  const processor = new SimpleSpanProcessor({ exporter });
  const tracing = new RequestTracing(true, () =>
    createTraceRuntime([processor]),
  );
  const tenantResolution = Object.freeze({
    status: 'resolved',
    context: Object.freeze({
      organizationId: 'trusted-organization',
      correlationId: uuid,
    }),
  });
  const staffAccess = Object.freeze({
    objectId: 'trusted-entra-object',
    staffIdentityId: 'trusted-audit-actor',
    organizationId: 'trusted-organization',
    permissions: Object.freeze(['service_request.view']),
  });
  const original = Object.freeze({
    id: uuid,
    method: 'GET',
    route: Object.freeze({
      path: '/api/v1/service-requests/:serviceRequestId',
    }),
    tenantResolution,
    staffAccess,
    headers: Object.freeze({
      authorization: 'Bearer trusted-fixture',
      traceparent: `00-${incomingTraceId}-0123456789abcdef-01`,
      tracestate: `identity=${secret}`,
      baggage: `organizationId=${secret},actorId=${secret},permission=admin.access.manage`,
    }),
  });
  const reads: PropertyKey[] = [];
  const writes: PropertyKey[] = [];
  const observed = new Proxy(original, {
    get: (target, key, receiver) => {
      reads.push(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
    set: (_target, key) => {
      writes.push(key);
      return false;
    },
    defineProperty: (_target, key) => {
      writes.push(key);
      return false;
    },
    deleteProperty: (_target, key) => {
      writes.push(key);
      return false;
    },
  });
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: true,
  });
  let nextCalls = 0;
  try {
    new RequestTracingMiddleware(tracing).use(
      observed as unknown as Request,
      response as unknown as Response,
      () => {
        nextCalls++;
      },
    );
    response.emit('finish');
    await processor.forceFlush();
    assert.equal(nextCalls, 1);
    assert.deepEqual(reads, ['id', 'method', 'route']);
    assert.deepEqual(writes, []);
    assert.strictEqual(original.tenantResolution, tenantResolution);
    assert.strictEqual(original.staffAccess, staffAccess);
    assert.equal(original.staffAccess.staffIdentityId, 'trusted-audit-actor');
    assert.equal(original.headers.authorization, 'Bearer trusted-fixture');
    assert.equal(original.id, uuid);
    const spans = exporter.getFinishedSpans();
    assert.equal(spans.length, 1);
    const span = spans[0];
    assert.ok(span);
    assert.equal(span.parentSpanContext, undefined);
    assert.equal(span.spanContext().traceState, undefined);
    assert.notEqual(span.spanContext().traceId, incomingTraceId);
    assert.equal(span.attributes['reqro.correlation_id'], uuid);
    assert.deepEqual(span.links, []);
    assert.deepEqual(span.events, []);
    assert.doesNotMatch(
      JSON.stringify(span.attributes),
      /PRIVATE_SENTINEL|trusted-organization|trusted-entra-object|trusted-audit-actor|admin.access.manage/,
    );
  } finally {
    await tracing.onModuleDestroy();
  }
});

test('request and response bodies never enter traces', async () => {
  const h = await harness(true);
  try {
    await request(h.app.getHttpServer())
      .post('/api/v1/service-requests')
      .send({
        residentName: secret,
        email: secret,
        phone: secret,
        address: secret,
        organizationId: secret,
        connectorId: secret,
        entraObjectId: secret,
        operatorIdentity: secret,
        attachmentClaims: secret,
        trackingCredential: secret,
        vendorPayload: secret,
      })
      .expect(201);
    await h.processor.forceFlush();
    const [span] = h.exporter.getFinishedSpans();
    assert.ok(span);
    assert.equal(span.attributes['http.response.status_code'], 201);
    assert.equal(JSON.stringify(span.attributes).includes(secret), false);
    assert.deepEqual(
      Object.keys(span.attributes).sort(),
      [
        'http.request.method',
        'http.response.status_code',
        'http.route',
        'reqro.correlation_id',
        'reqro.outcome',
        'reqro.reason',
      ].sort(),
    );
  } finally {
    await h.app.close();
  }
});

test('bounded status and outcome classify failures without exception text, stack or events', async () => {
  const h = await harness(true);
  try {
    await request(h.app.getHttpServer())
      .get('/api/v1/service-requests/failure')
      .expect(500);
    await request(h.app.getHttpServer())
      .get('/api/v1/service-requests/refused')
      .expect(403);
    await h.processor.forceFlush();
    const [failed, refused] = h.exporter.getFinishedSpans();
    assert.ok(failed);
    assert.ok(refused);
    assert.deepEqual(failed.status, { code: SpanStatusCode.ERROR });
    assert.equal(failed.attributes['reqro.outcome'], 'failed');
    assert.equal(failed.attributes['reqro.reason'], 'unknown');
    assert.equal(refused.attributes['reqro.outcome'], 'refused');
    for (const span of [failed, refused]) {
      assert.deepEqual(span.events, []);
      assert.equal(
        JSON.stringify({
          attributes: span.attributes,
          status: span.status,
        }).includes(secret),
        false,
      );
    }
  } finally {
    await h.app.close();
  }
});

test('health probes keep existing responses and emit no spans; unmatched URLs stay bounded', async () => {
  const h = await harness(true);
  try {
    for (const suffix of ['', '/live', '/ready'])
      await request(h.app.getHttpServer())
        .get(`/api/v1/health${suffix}`)
        .expect(200);
    await h.processor.forceFlush();
    assert.equal(h.exporter.getFinishedSpans().length, 0);
    await request(h.app.getHttpServer())
      .get(`/api/v1/private/${secret}?private=${secret}`)
      .expect(404);
    await h.processor.forceFlush();
    const [span] = h.exporter.getFinishedSpans();
    assert.ok(span);
    assert.equal(span.name, 'GET unmatched');
    assert.equal(span.attributes['http.response.status_code'], 404);
  } finally {
    await h.app.close();
  }
});

test('runtime recording and shutdown errors cannot escape into the application', async () => {
  const h = await harness(true, () => ({
    record: () => {
      throw new Error(secret);
    },
    shutdown: async () => {
      throw new Error(secret);
    },
  }));
  try {
    await request(h.app.getHttpServer())
      .get(`/api/v1/service-requests/${uuid}`)
      .expect(200);
  } finally {
    await h.app.close();
  }
});

test('aborted responses end once, have no response status, and discard untrusted field values', async () => {
  const exporter = new InMemorySpanExporter();
  const processor = new SimpleSpanProcessor({ exporter });
  const tracing = new RequestTracing(true, () =>
    createTraceRuntime([processor]),
  );
  const middleware = new RequestTracingMiddleware(tracing);
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
  });
  let nextCalls = 0;
  middleware.use(
    {
      id: secret,
      method: secret,
      route: { path: `/private/${secret}` },
    } as unknown as Request,
    response as unknown as Response,
    () => {
      nextCalls++;
    },
  );
  response.emit('close');
  response.emit('finish');
  await processor.forceFlush();
  const spans = exporter.getFinishedSpans();
  assert.equal(nextCalls, 1);
  assert.equal(spans.length, 1);
  const span = spans[0];
  assert.ok(span);
  assert.equal(span.name, 'other unmatched');
  assert.equal(span.attributes['http.response.status_code'], 0);
  assert.equal(span.attributes['reqro.correlation_id'], undefined);
  assert.equal(response.listenerCount('finish'), 0);
  assert.equal(response.listenerCount('close'), 0);
  await tracing.onModuleDestroy();
});

test('disabled middleware never inspects the request; default runtime has no export side effects', async (t) => {
  const unexpectedNetwork = () => {
    throw new Error('Unexpected telemetry network call');
  };
  const calls = [
    t.mock.method(net, 'connect', unexpectedNetwork),
    t.mock.method(net, 'createConnection', unexpectedNetwork),
    t.mock.method(tls, 'connect', unexpectedNetwork),
    t.mock.method(http, 'request', unexpectedNetwork),
    t.mock.method(https, 'request', unexpectedNetwork),
    t.mock.method(globalThis, 'fetch', unexpectedNetwork),
  ];
  let nextCalls = 0;
  new RequestTracingMiddleware(new RequestTracing(false)).use(
    null as unknown as Request,
    null as unknown as Response,
    () => {
      nextCalls++;
    },
  );
  assert.equal(nextCalls, 1);
  const tracing = new RequestTracing(true);
  tracing.observe({
    startTime: new Date(),
    endTime: new Date(),
    method: 'GET',
    routeTemplate: 'unmatched',
    statusCode: 200,
    aborted: false,
    correlationId: undefined,
  });
  await tracing.onModuleDestroy();
  for (const call of calls) assert.equal(call.mock.callCount(), 0);
});

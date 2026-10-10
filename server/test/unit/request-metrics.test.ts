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
import { MetricReader, DataPointType } from '@opentelemetry/sdk-metrics';
import {
  RequestMetrics,
  createMetricsRuntime,
  type MetricsRuntimeFactory,
} from '../../src/observability/request-metrics.js';
import {
  RequestMetricsModule,
  METRICS_RUNTIME_FACTORY,
} from '../../src/observability/request-metrics.module.js';
import { RequestMetricsMiddleware } from '../../src/observability/request-metrics.middleware.js';
import { validateEnvironment } from '../../src/config/environment.js';
import { validateMetricLabels } from '../../src/observability/metric-label-policy.js';
import { LoggingModule } from '../../src/common/logging/logging.module.js';
import { RequestLoggingMiddleware } from '../../src/common/logging/request-logging.middleware.js';
import { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';
import { HttpExceptionFilter } from '../../src/common/errors/http-exception.filter.js';

class MemoryReader extends MetricReader {
  protected onForceFlush(): Promise<void> {
    return Promise.resolve();
  }
  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }
}
const secret = 'PRIVATE_SENTINEL';
const uuid = '12345678-1234-4123-8123-123456789abc';

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
  imports: [LoggingModule, RequestMetricsModule],
  controllers: [FixtureController],
})
class HarnessModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RequestLoggingMiddleware, RequestMetricsMiddleware)
      .forRoutes('*');
  }
}
async function harness(enabled: boolean, factory?: MetricsRuntimeFactory) {
  const reader = new MemoryReader();
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [
          () => ({
            telemetry: { requestMetricsEnabled: enabled },
            logging: { level: 'silent' },
            app: { name: 'cityvue-api', version: '0.1.0', environment: 'test' },
          }),
        ],
      }),
      HarnessModule,
    ],
  })
    .overrideProvider(METRICS_RUNTIME_FACTORY)
    .useValue(factory ?? (() => createMetricsRuntime([reader])))
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter(app.get(PinoLoggerService)));
  await app.init();
  return { app, reader };
}
async function collect(reader: MemoryReader) {
  const result = await reader.collect();
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.resourceMetrics.resource.attributes, {
    'service.name': 'cityvue-api',
  });
  return result.resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
}

test('metrics config defaults disabled and validates explicit boolean opt-in', () => {
  const base = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:placeholder@localhost/test',
    DEVELOPMENT_ORGANIZATION_ID: uuid,
  };
  assert.equal(validateEnvironment(base).REQRO_REQUEST_METRICS_ENABLED, false);
  for (const value of ['true', 'false']) {
    assert.equal(
      validateEnvironment({ ...base, REQRO_REQUEST_METRICS_ENABLED: value })
        .REQRO_REQUEST_METRICS_ENABLED,
      value === 'true',
    );
  }
  assert.throws(() =>
    validateEnvironment({ ...base, REQRO_REQUEST_METRICS_ENABLED: 'invalid' }),
  );
});

test('disabled metrics preserve requests without initializing SDK', async () => {
  let calls = 0;
  const h = await harness(false, () => {
    calls++;
    throw new Error(secret);
  });
  try {
    await request(h.app.getHttpServer())
      .get('/api/v1/service-requests/fixture')
      .expect(200, { ok: true });
    assert.equal(calls, 0);
  } finally {
    await h.app.close();
  }
});

test('initialization failure preserves startup and normal requests', async () => {
  const h = await harness(true, () => {
    throw new Error(secret);
  });
  try {
    await request(h.app.getHttpServer())
      .get('/api/v1/service-requests/fixture')
      .expect(200);
  } finally {
    await h.app.close();
  }
});

test('count and duration aggregate on normalized route with no private metadata', async () => {
  const h = await harness(true);
  try {
    for (const id of [uuid, secret]) {
      await request(h.app.getHttpServer())
        .get(`/api/v1/service-requests/${id}?email=${secret}`)
        .set('Host', `${secret}.example.invalid`)
        .set('X-Forwarded-Host', `${secret}.example.invalid`)
        .set('authorization', `Bearer ${secret}`)
        .set('cookie', `private=${secret}`)
        .set('x-correlation-id', uuid)
        .set('x-organization-id', secret)
        .set(
          'traceparent',
          '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
        )
        .set('baggage', `residentId=${secret}`)
        .expect(200);
    }
    const metrics = await collect(h.reader);
    assert.equal(metrics.length, 2);
    const count = metrics.find(
      (m) => m.descriptor.name === 'reqro.http.server.requests',
    );
    const duration = metrics.find(
      (m) => m.descriptor.name === 'reqro.http.server.request.duration',
    );
    assert.ok(count && duration);
    assert.equal(count.dataPointType, DataPointType.SUM);
    assert.equal(count.dataPoints.length, 1);
    assert.equal(count.dataPoints[0]?.value, 2);
    assert.equal(duration.dataPointType, DataPointType.HISTOGRAM);
    assert.equal(duration.descriptor.unit, 'ms');
    assert.equal(duration.dataPoints[0]?.value.count, 2);
    assert.ok((duration.dataPoints[0].value.sum ?? -1) >= 0);
    for (const metric of metrics) {
      assert.deepEqual(metric.dataPoints[0]?.attributes, {
        method: 'GET',
        routeTemplate: '/api/v1/service-requests/:serviceRequestId',
        statusClass: '2xx',
      });
      assert.equal(
        validateMetricLabels(metric.dataPoints[0].attributes).ok,
        true,
      );
    }
    assert.doesNotMatch(
      JSON.stringify(metrics),
      /PRIVATE_SENTINEL|12345678-1234|0123456789abcdef|correlationId|traceId|spanId|organizationId|residentId|hostname|cookie|authorization/i,
    );
  } finally {
    await h.app.close();
  }
});

test('request/response bodies and error payloads are absent; statuses remain bounded', async () => {
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
        integrationIntentId: secret,
        aggregateId: secret,
        externalRecordId: secret,
        operatorIdentity: secret,
        entraObjectId: secret,
      })
      .expect(201);
    await request(h.app.getHttpServer())
      .get('/api/v1/service-requests/failure')
      .expect(500);
    await request(h.app.getHttpServer())
      .get('/api/v1/service-requests/refused')
      .expect(403);
    const metrics = await collect(h.reader);
    const count = metrics.find(
      (m) => m.descriptor.name === 'reqro.http.server.requests',
    );
    assert.deepEqual(
      count?.dataPoints.map((p) => p.attributes.statusClass).sort(),
      ['2xx', '4xx', '5xx'],
    );
    assert.doesNotMatch(
      JSON.stringify(metrics),
      /PRIVATE_SENTINEL|integrationIntentId|aggregateId|externalRecordId|operatorIdentity|entraObjectId/,
    );
  } finally {
    await h.app.close();
  }
});

test('health routes are excluded and unrecognized URLs use bounded fallback', async () => {
  const h = await harness(true);
  try {
    for (const suffix of ['', '/live', '/ready'])
      await request(h.app.getHttpServer())
        .get(`/api/v1/health${suffix}`)
        .expect(200);
    assert.deepEqual(await collect(h.reader), []);
    await request(h.app.getHttpServer())
      .get(`/private/${secret}?token=${secret}`)
      .expect(404);
    for (const metric of await collect(h.reader)) {
      assert.deepEqual(metric.dataPoints[0]?.attributes, {
        method: 'GET',
        routeTemplate: 'unmatched',
        statusClass: '4xx',
      });
    }
  } finally {
    await h.app.close();
  }
});

test('record and shutdown failures cannot fail requests', async () => {
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
      .get('/api/v1/service-requests/fixture')
      .expect(200);
  } finally {
    await h.app.close();
  }
});

test('middleware reads only method/template, uses monotonic duration and records completion once', async (t) => {
  const reader = new MemoryReader();
  const metrics = new RequestMetrics(true, () =>
    createMetricsRuntime([reader]),
  );
  const times = [100, 112.5];
  t.mock.method(performance, 'now', () => times.shift() ?? 112.5);
  const reads: PropertyKey[] = [];
  const original = {
    method: secret,
    route: { path: `/private/${secret}` },
    id: uuid,
    body: { secret },
    headers: { secret },
  };
  const req = new Proxy(original, {
    get: (target, key, receiver) => {
      reads.push(key);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });
  const response = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
  });
  let next = 0;
  try {
    new RequestMetricsMiddleware(metrics).use(
      req as unknown as Request,
      response as unknown as Response,
      () => {
        next++;
      },
    );
    response.emit('close');
    response.emit('finish');
    assert.equal(next, 1);
    assert.deepEqual(reads, ['method', 'route']);
    assert.equal(response.listenerCount('finish'), 0);
    assert.equal(response.listenerCount('close'), 0);
    const data = await collect(reader);
    for (const metric of data)
      assert.deepEqual(metric.dataPoints[0]?.attributes, {
        method: 'other',
        routeTemplate: 'unmatched',
        statusClass: 'no_response',
      });
    const duration = data.find(
      (m) => m.dataPointType === DataPointType.HISTOGRAM,
    );
    assert.ok(duration);
    assert.equal(duration.dataPoints[0]?.value.sum, 12.5);
    assert.equal(duration.dataPoints[0].value.count, 1);
  } finally {
    await metrics.onModuleDestroy();
  }
});

test('SDK boundary rejects unknown labels through F061 policy and invalid durations', async () => {
  const reader = new MemoryReader();
  const runtime = createMetricsRuntime([reader]);
  try {
    for (const labels of [
      { unknown: secret },
      { traceId: secret },
      { organizationId: secret },
      { routeTemplate: '/private/id' },
    ]) {
      assert.equal(validateMetricLabels(labels).ok, false);
      runtime.record(labels, 10);
    }
    for (const duration of [-1, NaN, Infinity])
      runtime.record({ method: 'GET' }, duration);
    assert.deepEqual(await collect(reader), []);
    runtime.record(
      { method: 'GET', routeTemplate: 'unmatched', statusClass: '2xx' },
      25,
    );
    assert.equal((await collect(reader)).length, 2);
  } finally {
    await runtime.shutdown();
  }
});

test('disabled middleware touches no request metadata and default runtime performs zero network calls', async (t) => {
  const unexpected = () => {
    throw new Error('Unexpected network');
  };
  const calls = [
    t.mock.method(net, 'connect', unexpected),
    t.mock.method(net, 'createConnection', unexpected),
    t.mock.method(tls, 'connect', unexpected),
    t.mock.method(http, 'request', unexpected),
    t.mock.method(https, 'request', unexpected),
    t.mock.method(globalThis, 'fetch', unexpected),
  ];
  let next = 0;
  new RequestMetricsMiddleware(new RequestMetrics(false)).use(
    null as unknown as Request,
    null as unknown as Response,
    () => {
      next++;
    },
  );
  assert.equal(next, 1);
  const metrics = new RequestMetrics(true);
  metrics.observe({
    method: 'GET',
    routeTemplate: 'unmatched',
    statusCode: 200,
    aborted: false,
    durationMs: 10,
  });
  await metrics.onModuleDestroy();
  for (const call of calls) assert.equal(call.mock.callCount(), 0);
});

test('middleware setup failure preserves next and invalid observations are contained', () => {
  const metrics = new RequestMetrics(true, () => ({
    record: () => assert.fail(),
    shutdown: () => Promise.resolve(),
  }));
  let next = 0;
  new RequestMetricsMiddleware(metrics).use(
    null as unknown as Request,
    null as unknown as Response,
    () => {
      next++;
    },
  );
  assert.equal(next, 1);
  metrics.observe({
    method: 'GET',
    routeTemplate: 'unmatched',
    statusCode: 200,
    aborted: false,
    durationMs: NaN,
  });
});

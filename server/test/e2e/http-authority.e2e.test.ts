import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createConnection, type AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DatabaseService } from '../../src/database/database.service.js';
import { TenantDomainRepository } from '../../src/tenancy/tenant-domain.repository.js';
import { AlertsService } from '../../src/alerts/alerts.service.js';
import type { ResolvedTenant } from '../../src/tenancy/tenant-domain.js';

const HOST = 'requests.example.gov';
const OTHER = 'other.example.gov';
const ORGANIZATION = '20000000-0000-4000-8000-00000000000a';
const OTHER_ORGANIZATION = '20000000-0000-4000-8000-00000000000b';

/** Actual TCP bytes, not supertest's header map. No database or external
 * listener is used: the app binds only an ephemeral IPv4 loopback port. */
async function wire(
  app: INestApplication,
  fields: string[],
  path = '/api/v1/alerts/active',
) {
  const port = ((app.getHttpServer() as Server).address() as AddressInfo).port;
  const response = await new Promise<string>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let received = '';
    socket.setEncoding('utf8');
    socket.setTimeout(5000, () =>
      socket.destroy(new Error('HTTP authority test timed out')),
    );
    socket.once('error', reject);
    socket.on('data', (chunk: string) => {
      received += chunk;
    });
    socket.once('end', () => {
      resolve(received);
    });
    socket.once('connect', () => {
      socket.write(
        [`GET ${path} HTTP/1.1`, ...fields, 'Connection: close', '', ''].join(
          '\r\n',
        ),
      );
    });
  });
  const split = response.indexOf('\r\n\r\n');
  const headers = response.slice(0, split);
  const status = Number(/^HTTP\/1\.1 (\d{3})/.exec(headers)?.[1]);
  assert.ok(Number.isInteger(status) && status >= 100, response);
  return { status, headers, body: response.slice(split + 4) };
}

for (const mode of ['direct', 'forwarded'] as const) {
  test(`real HTTP authority: ${mode} mode`, async (t) => {
    const environment = {
      NODE_ENV: 'test',
      CITYVUE_DEPLOYMENT_PROFILE: 'development',
      TENANT_RESOLUTION_STRATEGY: 'registry',
      TENANT_HOST_SOURCE: mode,
      TENANT_TRUSTED_PROXY_CIDRS: mode === 'forwarded' ? '127.0.0.1/32' : '',
      CORS_ORIGINS: `https://${HOST}`,
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        'postgresql://cityvue:placeholder@localhost:5432/cityvue_test',
    };
    const previous = { ...process.env };
    Object.assign(process.env, environment);
    delete process.env.DEVELOPMENT_ORGANIZATION_ID;
    let app: INestApplication | undefined;
    const lookups: string[] = [];
    let unavailable = false;
    try {
      const [{ AppModule }, { configureApplication }] = await Promise.all([
        import('../../src/app.module.js'),
        import('../../src/bootstrap.js'),
      ]);
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(DatabaseService)
        .useValue({ status: () => Promise.resolve('up') })
        .overrideProvider(TenantDomainRepository)
        .useValue({
          findResolvable(hostname: string): Promise<ResolvedTenant[]> {
            lookups.push(hostname);
            if (unavailable)
              return Promise.reject(
                new Error('synthetic registry unavailable'),
              );
            if (![HOST, OTHER].includes(hostname)) return Promise.resolve([]);
            return Promise.resolve([
              {
                hostname,
                organizationId:
                  hostname === HOST ? ORGANIZATION : OTHER_ORGANIZATION,
                domainId: '30000000-0000-4000-8000-000000000001',
                role: 'public_canonical',
              },
            ]);
          },
        })
        .overrideProvider(AlertsService)
        .useValue({
          listActive: (organizationId: string) => [{ organizationId }],
        })
        .compile();
      app = moduleRef.createNestApplication();
      configureApplication(app);
      await app.listen(0, '127.0.0.1');
      const server = app;
      const authority = mode === 'direct' ? 'Host' : 'X-Forwarded-Host';
      const fields = (value: string) =>
        mode === 'direct'
          ? [`Host: ${value}`]
          : ['Host: internal.example.gov', `${authority}: ${value}`];

      await t.test(
        'one canonicalized authority reaches the real resolver and expected tenant',
        async () => {
          const result = await wire(
            server,
            fields('Requests.Example.GOV.:443'),
          );
          assert.equal(result.status, 200);
          assert.deepEqual(JSON.parse(result.body), [
            { organizationId: ORGANIZATION },
          ]);
          assert.equal(lookups.at(-1), HOST);
        },
      );

      await t.test(
        'duplicate authoritative wire fields are 400 before registry access',
        async (subtest) => {
          for (const second of [OTHER, HOST]) {
            const count = lookups.length;
            const result = await wire(server, [
              ...fields(HOST),
              `${authority.toLowerCase()}: ${second}`,
            ]);
            assert.equal(result.status, 400);
            assert.equal(lookups.length, count);
            const layer = /x-correlation-id:/i.test(result.headers)
              ? 'Nest tenant accessor'
              : 'Node HTTP parser';
            subtest.diagnostic(
              `${process.version}: duplicate ${authority} rejected by ${layer}`,
            );
            assert.equal(result.body.includes(HOST), false);
            assert.equal(result.body.includes(ORGANIZATION), false);
          }
        },
      );

      await t.test(
        'missing, comma-combined and malformed authority are 400 before lookup',
        async () => {
          for (const value of [
            '',
            `${HOST}, ${OTHER}`,
            '*.example.gov',
            '127.0.0.1',
            '[::1]',
            'https://example.gov',
            'example.gov:0',
            '_bad.example.gov',
          ]) {
            const count = lookups.length;
            assert.equal(
              (await wire(server, fields(value))).status,
              400,
              value,
            );
            assert.equal(lookups.length, count);
          }
          const count = lookups.length;
          assert.equal(
            (await wire(server, mode === 'direct' ? [] : [`Host: ${HOST}`]))
              .status,
            400,
          );
          assert.equal(lookups.length, count);
        },
      );

      await t.test('ignored headers cannot change authority', async () => {
        const ignored =
          mode === 'direct'
            ? [`X-Forwarded-Host: ${OTHER}`, `X-Forwarded-Host: ${HOST}`]
            : [];
        const result = await wire(server, [
          ...fields(HOST),
          ...ignored,
          `Forwarded: host=${OTHER}`,
        ]);
        assert.equal(result.status, 200);
        assert.deepEqual(JSON.parse(result.body), [
          { organizationId: ORGANIZATION },
        ]);
      });

      await t.test(
        'browser selectors cannot replace authority or supply a default tenant',
        async () => {
          const selectors = [
            `Organization-Id: ${OTHER_ORGANIZATION}`,
            `X-Organization-Id: ${OTHER_ORGANIZATION}`,
            `Cookie: organizationId=${OTHER_ORGANIZATION}`,
          ];
          const path = `/api/v1/alerts/active?organizationId=${OTHER_ORGANIZATION}&tenant=${OTHER_ORGANIZATION}`;
          const good = await wire(
            server,
            [...fields(HOST), ...selectors],
            path,
          );
          assert.equal(good.status, 200);
          assert.deepEqual(JSON.parse(good.body), [
            { organizationId: ORGANIZATION },
          ]);
          const unknown = await wire(
            server,
            [...fields('unknown.example.gov'), ...selectors],
            path,
          );
          assert.equal(unknown.status, 404);
          assert.equal(unknown.body.includes(ORGANIZATION), false);
          assert.equal(unknown.body.includes(OTHER_ORGANIZATION), false);
        },
      );

      await t.test(
        'registry exceptions remain generic 503 with no fallback',
        async () => {
          unavailable = true;
          try {
            const result = await wire(server, fields(HOST));
            assert.equal(result.status, 503);
            assert.equal(result.body.includes('synthetic'), false);
            assert.equal(result.body.includes(ORGANIZATION), false);
          } finally {
            unavailable = false;
          }
        },
      );

      await t.test(
        'malformed tenant authority does not alter health or staff admission',
        async () => {
          assert.equal(
            (await wire(server, fields('*.example.gov'), '/api/v1/health/live'))
              .status,
            200,
          );
          const staff = await wire(
            server,
            fields('*.example.gov'),
            '/api/v1/staff/service-requests',
          );
          assert.equal(staff.status, 401);
        },
      );
    } finally {
      if (app) await app.close();
      for (const key of Object.keys(process.env))
        if (!(key in previous)) Reflect.deleteProperty(process.env, key);
      Object.assign(process.env, previous);
    }
  });
}

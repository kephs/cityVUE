import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { TenantResolutionMiddleware } from '../../src/tenancy/tenant-resolution.middleware.js';
import type { TenantResolverService } from '../../src/tenancy/tenant-resolver.service.js';
import type { PinoLoggerService } from '../../src/common/logging/pino-logger.service.js';
import {
  residentTenantFromRequest,
  ResidentTenant,
} from '../../src/tenancy/resident-tenant.decorator.js';
import type {
  RequestWithTenant,
  TenantResolutionState,
} from '../../src/tenancy/tenant-context.js';
import type { ResolvedTenant } from '../../src/tenancy/tenant-domain.js';

const ORGANIZATION = '20000000-0000-4000-8000-00000000000a';
const DEVELOPMENT_ORGANIZATION = '10000000-0000-4000-8000-000000000001';
const CORRELATION = '7f7f7f7f-7f7f-4f7f-8f7f-7f7f7f7f7f7f';

const binding: ResolvedTenant = {
  domainId: '30000000-0000-4000-8000-000000000001',
  organizationId: ORGANIZATION,
  hostname: 'requests.example.gov',
  role: 'public_canonical',
};

interface Options {
  strategy?: 'development' | 'registry';
  developmentOrganizationId?: string;
  hostSource?: 'direct' | 'forwarded';
  trustedProxyCidrs?: string;
  resolve?: (host: unknown) => Promise<ResolvedTenant | null>;
}

const logged: Record<string, unknown>[] = [];

function middleware(options: Options = {}) {
  const values: Record<string, unknown> = {
    'tenancy.resolutionStrategy': options.strategy ?? 'development',
    'catalog.developmentOrganizationId':
      options.developmentOrganizationId ?? DEVELOPMENT_ORGANIZATION,
    'tenancy.hostSource': options.hostSource ?? 'direct',
    'tenancy.trustedProxyCidrs': options.trustedProxyCidrs ?? '',
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<never, true>;
  const resolver = {
    resolve:
      options.resolve ?? (() => Promise.resolve<ResolvedTenant | null>(null)),
  } as unknown as TenantResolverService;
  const logger = {
    logger: {
      info: (context: Record<string, unknown>) => logged.push(context),
    },
  } as unknown as PinoLoggerService;
  return new TenantResolutionMiddleware(config, resolver, logger);
}

async function run(
  options: Options,
  headers: Record<string, string | string[] | undefined> = {},
  peer = '10.0.0.1',
): Promise<{ state: TenantResolutionState | undefined; nextCalls: number }> {
  const request = {
    id: CORRELATION,
    headers,
    socket: { remoteAddress: peer },
  } as unknown as Request & RequestWithTenant;
  let nextCalls = 0;
  const next: NextFunction = () => {
    nextCalls += 1;
  };
  await middleware(options).use(request, {} as Response, next);
  return { state: request.tenantResolution, nextCalls };
}

test('the development strategy attaches a development context without a registry lookup', async () => {
  let lookups = 0;
  const { state, nextCalls } = await run({
    strategy: 'development',
    resolve: () => {
      lookups += 1;
      return Promise.resolve(null);
    },
  });

  assert.equal(nextCalls, 1);
  assert.equal(lookups, 0, 'development must not consult the registry');
  assert.equal(state?.status, 'resolved');
  assert.deepEqual(state.context, {
    source: 'development',
    organizationId: DEVELOPMENT_ORGANIZATION,
    correlationId: CORRELATION,
  });
});

test('the development strategy without a configured Organization fails closed', async () => {
  const { state } = await run({
    strategy: 'development',
    developmentOrganizationId: '',
  });

  assert.equal(state?.status, 'not_found');
});

test('a registry hit produces a frozen registry context', async () => {
  const { state } = await run(
    { strategy: 'registry', resolve: () => Promise.resolve(binding) },
    { host: 'Requests.Example.GOV:443' },
  );

  assert.equal(state?.status, 'resolved');
  assert.deepEqual(state.context, {
    source: 'registry',
    organizationId: ORGANIZATION,
    hostname: 'requests.example.gov',
    domainId: binding.domainId,
    role: 'public_canonical',
    correlationId: CORRELATION,
  });
  assert.ok(Object.isFrozen(state));
  assert.ok(Object.isFrozen(state.context));
});

test('the canonical host reaches the resolver, not the raw header', async () => {
  const seen: unknown[] = [];
  await run(
    {
      strategy: 'registry',
      resolve: (host) => {
        seen.push(host);
        return Promise.resolve(binding);
      },
    },
    { host: 'REQUESTS.EXAMPLE.GOV.:8443' },
  );

  assert.deepEqual(seen, ['requests.example.gov']);
});

test('unknown, inactive, unverified and inactive-Organization bindings are one outcome', async () => {
  // The resolver collapses all of these to null; the middleware must not
  // reintroduce a distinction.
  const { state } = await run(
    { strategy: 'registry', resolve: () => Promise.resolve(null) },
    { host: 'unknown.example.gov' },
  );

  assert.equal(state?.status, 'not_found');
});

test('a malformed or missing host never reaches the resolver', async () => {
  for (const headers of [
    { host: '*.example.gov' },
    { host: 'a.example.gov,b.example.gov' },
    { host: '127.0.0.1' },
    {},
  ]) {
    let lookups = 0;
    const { state } = await run(
      {
        strategy: 'registry',
        resolve: () => {
          lookups += 1;
          return Promise.resolve(binding);
        },
      },
      headers,
    );
    assert.equal(state?.status, 'not_found', JSON.stringify(headers));
    assert.equal(lookups, 0);
  }
});

test('a resolver or database failure is unavailable, never a tenant', async () => {
  const { state, nextCalls } = await run(
    {
      strategy: 'registry',
      resolve: () => Promise.reject(new Error('connection terminated')),
    },
    { host: 'requests.example.gov' },
  );

  assert.equal(state?.status, 'unavailable');
  // The request continues; the middleware never terminates it.
  assert.equal(nextCalls, 1);
});

test('the registry strategy never falls back to the development Organization', async () => {
  for (const resolve of [
    () => Promise.resolve(null),
    () => Promise.reject(new Error('down')),
  ]) {
    const { state } = await run(
      {
        strategy: 'registry',
        developmentOrganizationId: DEVELOPMENT_ORGANIZATION,
        resolve,
      },
      { host: 'requests.example.gov' },
    );
    assert.notEqual(state?.status, 'resolved');
    assert.equal(
      JSON.stringify(state).includes(DEVELOPMENT_ORGANIZATION),
      false,
    );
  }
});

test('forwarded mode is enforced through the middleware', async () => {
  const options: Options = {
    strategy: 'registry',
    hostSource: 'forwarded',
    trustedProxyCidrs: '10.0.0.0/8',
    resolve: () => Promise.resolve(binding),
  };

  const trusted = await run(
    options,
    { 'x-forwarded-host': 'requests.example.gov' },
    '10.0.0.5',
  );
  assert.equal(trusted.state?.status, 'resolved');

  const untrusted = await run(
    options,
    {
      host: 'requests.example.gov',
      'x-forwarded-host': 'requests.example.gov',
    },
    '203.0.113.5',
  );
  assert.equal(untrusted.state?.status, 'not_found');
});

test('the middleware always calls next and never throws', async () => {
  for (const options of [
    { strategy: 'development' as const },
    { strategy: 'registry' as const },
    {
      strategy: 'registry' as const,
      resolve: () => Promise.reject(new Error('boom')),
    },
  ]) {
    const { nextCalls } = await run(options, { host: 'requests.example.gov' });
    assert.equal(nextCalls, 1);
  }
});

test('resolution logging is sanitized and carries the correlation id', async () => {
  logged.length = 0;
  await run(
    { strategy: 'registry', resolve: () => Promise.resolve(binding) },
    { host: 'requests.example.gov', 'x-forwarded-host': 'evil.example.com' },
  );
  const entry = logged.at(-1);
  assert.ok(entry);

  assert.equal(entry.tenantResolution, 'resolved');
  assert.equal(entry.requestId, CORRELATION);
  assert.equal(entry.tenantHostname, 'requests.example.gov');
  assert.equal(entry.tenantRole, 'public_canonical');
  assert.equal(typeof entry.durationMs, 'number');
  // No raw headers, forwarded chain or Organization identifier.
  const serialized = JSON.stringify(entry);
  assert.equal(serialized.includes('evil.example.com'), false);
  assert.equal(serialized.includes(ORGANIZATION), false);
});

test('the resident accessor converts state into context or a generic error', () => {
  assert.deepEqual(
    residentTenantFromRequest({
      tenantResolution: {
        status: 'resolved',
        context: {
          source: 'development',
          organizationId: ORGANIZATION,
          correlationId: CORRELATION,
        },
      },
    }),
    {
      source: 'development',
      organizationId: ORGANIZATION,
      correlationId: CORRELATION,
    },
  );

  assert.throws(
    () =>
      residentTenantFromRequest({
        tenantResolution: { status: 'not_found', reason: 'unknown_host' },
      }),
    NotFoundException,
  );
  assert.throws(
    () =>
      residentTenantFromRequest({
        tenantResolution: {
          status: 'unavailable',
          reason: 'registry_unavailable',
        },
      }),
    ServiceUnavailableException,
  );
  // Middleware never ran: fail closed rather than treating absence as open.
  assert.throws(() => residentTenantFromRequest({}), NotFoundException);
});

test('accessor errors expose no internal tenant detail', () => {
  for (const state of [
    { status: 'not_found', reason: 'unknown_host' } as const,
    { status: 'unavailable', reason: 'registry_unavailable' } as const,
  ]) {
    try {
      residentTenantFromRequest({ tenantResolution: state });
      assert.fail('expected a refusal');
    } catch (error) {
      const body = JSON.stringify((error as NotFoundException).getResponse());
      assert.equal(body.includes(ORGANIZATION), false);
      assert.equal(body.includes('requests.example.gov'), false);
      assert.equal(body.includes('tenant'), false);
    }
  }
});

test('the resident accessor is exported as a parameter decorator', () => {
  assert.equal(typeof ResidentTenant, 'function');
});

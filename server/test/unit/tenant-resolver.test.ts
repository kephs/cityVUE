import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { TenantResolverService } from '../../src/tenancy/tenant-resolver.service.js';
import type { TenantDomainRepository } from '../../src/tenancy/tenant-domain.repository.js';
import type {
  ResolvedTenant,
  TenantDomainRole,
} from '../../src/tenancy/tenant-domain.js';

const organizationA = '20000000-0000-4000-8000-00000000000a';
const organizationB = '20000000-0000-4000-8000-00000000000b';

interface Binding {
  readonly domainId: string;
  readonly organizationId: string;
  readonly hostname: string;
  readonly role: TenantDomainRole;
  readonly active: boolean;
  readonly verified: boolean;
  readonly organizationActive: boolean;
}

/**
 * Stands in for the repository, applying exactly the three preconditions the
 * real query applies in SQL. It records the hostname it was asked for, so the
 * tests can prove the resolver normalizes before looking anything up.
 *
 * This is a contract-level double. That the production SQL applies the same
 * predicates is proven against PostgreSQL in
 * `test/database/tenant-domain-registry.integration.test.ts`.
 */
function repositoryOf(bindings: Binding[]) {
  const asked: string[] = [];
  const repository = {
    findResolvable(hostname: string): Promise<ResolvedTenant[]> {
      asked.push(hostname);
      return Promise.resolve(
        bindings
          .filter(
            (binding) =>
              binding.hostname === hostname &&
              binding.active &&
              binding.verified &&
              binding.organizationActive,
          )
          .map(({ domainId, organizationId, hostname: host, role }) => ({
            domainId,
            organizationId,
            hostname: host,
            role,
          })),
      );
    },
  } as unknown as TenantDomainRepository;
  return { repository, asked };
}

function binding(overrides: Partial<Binding> = {}): Binding {
  return {
    domainId: '30000000-0000-4000-8000-000000000001',
    organizationId: organizationA,
    hostname: 'requests.example.gov',
    role: 'public_canonical',
    active: true,
    verified: true,
    organizationActive: true,
    ...overrides,
  };
}

test('an exact verified active hostname resolves to one Organization', async () => {
  const { repository, asked } = repositoryOf([binding()]);
  const resolved = await new TenantResolverService(repository).resolve(
    'requests.example.gov',
  );

  assert.deepEqual(resolved, {
    domainId: '30000000-0000-4000-8000-000000000001',
    organizationId: organizationA,
    hostname: 'requests.example.gov',
    role: 'public_canonical',
  });
  assert.deepEqual(asked, ['requests.example.gov']);
});

test('the host is normalized before the registry is consulted', async () => {
  const { repository, asked } = repositoryOf([binding()]);
  const resolver = new TenantResolverService(repository);

  assert.ok(await resolver.resolve('Requests.Example.GOV.:443'));
  assert.deepEqual(asked, ['requests.example.gov']);
});

test('an unknown hostname fails closed', async () => {
  const { repository } = repositoryOf([binding()]);

  assert.equal(
    await new TenantResolverService(repository).resolve('unknown.example.gov'),
    null,
  );
});

test('an unverified binding fails closed', async () => {
  const { repository } = repositoryOf([binding({ verified: false })]);

  assert.equal(
    await new TenantResolverService(repository).resolve('requests.example.gov'),
    null,
  );
});

test('an inactive binding fails closed', async () => {
  const { repository } = repositoryOf([binding({ active: false })]);

  assert.equal(
    await new TenantResolverService(repository).resolve('requests.example.gov'),
    null,
  );
});

test('an inactive Organization fails closed', async () => {
  const { repository } = repositoryOf([binding({ organizationActive: false })]);

  assert.equal(
    await new TenantResolverService(repository).resolve('requests.example.gov'),
    null,
  );
});

test('a malformed host never reaches the registry', async () => {
  const { repository, asked } = repositoryOf([binding()]);
  const resolver = new TenantResolverService(repository);

  for (const host of [
    '*.example.gov',
    'requests.example.gov,evil.example.com',
    'requests.example.gov\r\n',
    '127.0.0.1',
    '',
    undefined,
  ])
    assert.equal(await resolver.resolve(host), null);
  assert.deepEqual(asked, []);
});

test('an ambiguous hostname fails closed rather than choosing a tenant', async () => {
  // The database forbids this; if that control ever failed, the resolver must
  // refuse rather than serve whichever row came back first.
  const { repository } = repositoryOf([
    binding(),
    binding({
      domainId: '30000000-0000-4000-8000-000000000002',
      organizationId: organizationB,
      role: 'public_alias',
    }),
  ]);

  assert.equal(
    await new TenantResolverService(repository).resolve('requests.example.gov'),
    null,
  );
});

test('every failure is indistinguishable from every other', async () => {
  const { repository } = repositoryOf([
    binding({ active: false }),
    binding({
      domainId: '30000000-0000-4000-8000-000000000003',
      hostname: 'alias.example.gov',
      verified: false,
      role: 'public_alias',
    }),
  ]);
  const resolver = new TenantResolverService(repository);

  const outcomes = await Promise.all(
    [
      'requests.example.gov',
      'alias.example.gov',
      'never-registered.example.gov',
      '_underscore.example.gov',
    ].map((host) => resolver.resolve(host)),
  );
  assert.deepEqual(outcomes, [null, null, null, null]);
});

test('there is no development fallback and no browser-selected Organization', async () => {
  const previous = process.env.DEVELOPMENT_ORGANIZATION_ID;
  try {
    process.env.DEVELOPMENT_ORGANIZATION_ID = organizationB;
    const { repository } = repositoryOf([]);

    assert.equal(
      await new TenantResolverService(repository).resolve(
        'requests.example.gov',
      ),
      null,
    );
  } finally {
    if (previous === undefined) delete process.env.DEVELOPMENT_ORGANIZATION_ID;
    else process.env.DEVELOPMENT_ORGANIZATION_ID = previous;
  }
});

test('the resolver reads no configuration, so the development strategy cannot leak into it', () => {
  for (const emitted of [
    '../../src/tenancy/tenant-resolver.service.js',
    '../../src/tenancy/tenant-domain.repository.js',
    '../../src/tenancy/tenant-hostname.js',
  ]) {
    const source = readFileSync(resolve(__dirname, emitted), 'utf8');
    for (const forbidden of [
      'developmentOrganizationId',
      'DEVELOPMENT_ORGANIZATION_ID',
      'ConfigService',
      'resolutionStrategy',
    ])
      assert.doesNotMatch(
        source,
        new RegExp(forbidden),
        `${emitted} must not depend on ${forbidden}`,
      );
  }
});

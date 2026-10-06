import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FORWARDED_HOST_HEADER,
  createTenantHostPolicy,
  normalizePeerAddress,
  parseTrustedProxyCidrs,
  selectTrustedHost,
} from '../../src/tenancy/tenant-host-source.js';
import { validateEnvironment } from '../../src/config/environment.js';

const direct = createTenantHostPolicy('direct', '');
const forwarded = (cidrs: string) => createTenantHostPolicy('forwarded', cidrs);

function select(
  policy: ReturnType<typeof createTenantHostPolicy>,
  headers: Record<string, string | string[] | undefined>,
  peer?: string | null,
) {
  return selectTrustedHost(policy, headers, peer);
}

test('direct mode accepts the literal Host', () => {
  assert.deepEqual(select(direct, { host: 'requests.example.gov' }), {
    ok: true,
    hostname: 'requests.example.gov',
  });
});

test('direct mode ignores X-Forwarded-Host completely', () => {
  // Present, well formed, and attacker supplied. It must not be read at all.
  assert.deepEqual(
    select(direct, {
      host: 'requests.example.gov',
      [FORWARDED_HOST_HEADER]: 'evil.example.com',
    }),
    { ok: true, hostname: 'requests.example.gov' },
  );
  // With no Host at all, a forwarded value still cannot stand in for one.
  assert.deepEqual(
    select(direct, { [FORWARDED_HOST_HEADER]: 'evil.example.com' }),
    { ok: false },
  );
});

test('a missing Host fails closed', () => {
  assert.deepEqual(select(direct, {}), { ok: false });
  assert.deepEqual(select(direct, { host: undefined }), { ok: false });
  assert.deepEqual(select(direct, { host: '' }), { ok: false });
});

test('a malformed Host fails closed', () => {
  for (const host of [
    '*.example.gov',
    'requests.example.gov\r\n',
    '_acme.example.gov',
    'exa mple.gov',
    '127.0.0.1',
    'requests.example.gov:0',
  ])
    assert.deepEqual(select(direct, { host }), { ok: false }, host);
});

test('comma-joined and repeated Host values fail closed', () => {
  assert.deepEqual(select(direct, { host: 'a.example.gov,b.example.gov' }), {
    ok: false,
  });
  // Node surfaces a repeated header as an array; it is ambiguous either way.
  assert.deepEqual(
    select(direct, { host: ['a.example.gov', 'b.example.gov'] }),
    { ok: false },
  );
});

test('the host is canonicalized by the existing normalizer', () => {
  for (const host of [
    'Requests.Example.GOV',
    'requests.example.gov.',
    'requests.example.gov:443',
    'REQUESTS.EXAMPLE.GOV.:8443',
  ])
    assert.deepEqual(
      select(direct, { host }),
      { ok: true, hostname: 'requests.example.gov' },
      host,
    );
});

test('forwarded mode accepts a forwarded host from a trusted peer', () => {
  const policy = forwarded('10.0.0.0/8');

  assert.deepEqual(
    select(
      policy,
      {
        host: 'internal.lb',
        [FORWARDED_HOST_HEADER]: 'Requests.Example.GOV:443',
      },
      '10.1.2.3',
    ),
    { ok: true, hostname: 'requests.example.gov' },
  );
});

test('forwarded mode from an untrusted peer fails closed with no Host fallback', () => {
  const policy = forwarded('10.0.0.0/8');

  // The literal Host is perfectly valid and must still not be used: a request
  // that bypassed the trusted edge cannot select a tenant.
  assert.deepEqual(
    select(
      policy,
      {
        host: 'requests.example.gov',
        [FORWARDED_HOST_HEADER]: 'evil.example.com',
      },
      '203.0.113.9',
    ),
    { ok: false },
  );
  assert.deepEqual(
    select(policy, { host: 'requests.example.gov' }, '203.0.113.9'),
    { ok: false },
  );
  assert.deepEqual(
    select(policy, { host: 'requests.example.gov' }, undefined),
    { ok: false },
  );
});

test('forwarded mode fails closed when the forwarded host is missing', () => {
  const policy = forwarded('10.0.0.0/8');

  assert.deepEqual(
    select(policy, { host: 'requests.example.gov' }, '10.0.0.1'),
    { ok: false },
  );
});

test('forwarded mode fails closed on comma-joined or repeated forwarded hosts', () => {
  const policy = forwarded('10.0.0.0/8');

  assert.deepEqual(
    select(
      policy,
      { [FORWARDED_HOST_HEADER]: 'a.example.gov, b.example.gov' },
      '10.0.0.1',
    ),
    { ok: false },
  );
  assert.deepEqual(
    select(
      policy,
      { [FORWARDED_HOST_HEADER]: ['a.example.gov', 'b.example.gov'] },
      '10.0.0.1',
    ),
    { ok: false },
  );
});

test('an empty trusted allowlist trusts nobody', () => {
  const policy = createTenantHostPolicy('forwarded', '');

  assert.equal(policy.isTrustedPeer('10.0.0.1'), false);
  assert.equal(policy.isTrustedPeer('127.0.0.1'), false);
  assert.deepEqual(
    select(
      policy,
      { [FORWARDED_HOST_HEADER]: 'requests.example.gov' },
      '10.0.0.1',
    ),
    { ok: false },
  );
});

test('IPv4 CIDRs and bare addresses match correctly', () => {
  const range = forwarded('10.0.0.0/8');
  assert.equal(range.isTrustedPeer('10.255.255.254'), true);
  assert.equal(range.isTrustedPeer('11.0.0.1'), false);

  const single = forwarded('192.0.2.10');
  assert.equal(single.isTrustedPeer('192.0.2.10'), true);
  assert.equal(single.isTrustedPeer('192.0.2.11'), false);
});

test('IPv6 CIDRs match correctly', () => {
  const policy = forwarded('2001:db8::/32');

  assert.equal(policy.isTrustedPeer('2001:db8::1'), true);
  assert.equal(policy.isTrustedPeer('2001:db8:dead:beef::9'), true);
  assert.equal(policy.isTrustedPeer('2001:db9::1'), false);
  // A zone index must not defeat the comparison.
  assert.equal(policy.isTrustedPeer('2001:db8::1%eth0'), true);
});

test('IPv4-mapped IPv6 peers match IPv4 ranges', () => {
  const policy = forwarded('10.0.0.0/8');

  assert.equal(policy.isTrustedPeer('::ffff:10.1.2.3'), true);
  assert.equal(policy.isTrustedPeer('::FFFF:10.1.2.3'), true);
  assert.equal(policy.isTrustedPeer('::ffff:11.1.2.3'), false);
  assert.deepEqual(normalizePeerAddress('::ffff:10.1.2.3'), {
    address: '10.1.2.3',
    type: 'ipv4',
  });
});

test('an unparseable peer address is never trusted', () => {
  const policy = forwarded('10.0.0.0/8');

  for (const peer of [undefined, null, '', 'not-an-ip', 'localhost'])
    assert.equal(policy.isTrustedPeer(peer), false, String(peer));
  assert.equal(normalizePeerAddress('not-an-ip'), null);
});

test('malformed CIDR configuration is rejected at parse time', () => {
  for (const value of [
    '10.0.0.0/33',
    '2001:db8::/129',
    '10.0.0.0/8/8',
    '10.0.0.0/x',
    'not-an-ip',
    '10.0.0.0/-1',
    '999.0.0.1/8',
  ])
    assert.throws(() => parseTrustedProxyCidrs(value), value);
});

test('well formed CIDR lists parse, ignoring blanks and spacing', () => {
  assert.deepEqual(
    parseTrustedProxyCidrs(' 10.0.0.0/8 , 2001:db8::/32 ,, 192.0.2.10 '),
    [
      { address: '10.0.0.0', type: 'ipv4', prefix: 8 },
      { address: '2001:db8::', type: 'ipv6', prefix: 32 },
      { address: '192.0.2.10', type: 'ipv4', prefix: null },
    ],
  );
  assert.deepEqual(parseTrustedProxyCidrs(''), []);
});

const developmentEnvironment = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://cityvue:placeholder@localhost:5432/cityvue',
  DEVELOPMENT_ORGANIZATION_ID: '10000000-0000-4000-8000-000000000001',
};

test('the trusted host source defaults to direct with no proxy allowlist', () => {
  const environment = validateEnvironment(developmentEnvironment);

  assert.equal(environment.TENANT_HOST_SOURCE, 'direct');
  assert.equal(environment.TENANT_TRUSTED_PROXY_CIDRS, '');
});

test('forwarded host source requires an explicit trusted proxy allowlist', () => {
  assert.throws(
    () =>
      validateEnvironment({
        ...developmentEnvironment,
        TENANT_HOST_SOURCE: 'forwarded',
      }),
    /forwarded tenant host source requires TENANT_TRUSTED_PROXY_CIDRS/,
  );
  assert.throws(
    () =>
      validateEnvironment({
        ...developmentEnvironment,
        TENANT_HOST_SOURCE: 'forwarded',
        TENANT_TRUSTED_PROXY_CIDRS: '   ',
      }),
    /forwarded tenant host source requires TENANT_TRUSTED_PROXY_CIDRS/,
  );
});

test('a malformed trusted proxy allowlist stops the process', () => {
  for (const value of ['10.0.0.0/33', 'not-an-ip', '10.0.0.0/8/8'])
    assert.throws(
      () =>
        validateEnvironment({
          ...developmentEnvironment,
          TENANT_HOST_SOURCE: 'forwarded',
          TENANT_TRUSTED_PROXY_CIDRS: value,
        }),
      /TENANT_TRUSTED_PROXY_CIDRS must be a comma-separated list/,
      value,
    );
});

test('a trusted proxy allowlist without forwarded mode is rejected', () => {
  // Configuration that looks like it grants trust but cannot is a trap.
  assert.throws(
    () =>
      validateEnvironment({
        ...developmentEnvironment,
        TENANT_TRUSTED_PROXY_CIDRS: '10.0.0.0/8',
      }),
    /TENANT_TRUSTED_PROXY_CIDRS requires TENANT_HOST_SOURCE=forwarded/,
  );
});

test('a valid forwarded configuration is accepted', () => {
  const environment = validateEnvironment({
    ...developmentEnvironment,
    TENANT_HOST_SOURCE: 'forwarded',
    TENANT_TRUSTED_PROXY_CIDRS: '10.0.0.0/8, 2001:db8::/32',
  });

  assert.equal(environment.TENANT_HOST_SOURCE, 'forwarded');
  assert.equal(
    environment.TENANT_TRUSTED_PROXY_CIDRS,
    '10.0.0.0/8, 2001:db8::/32',
  );
});

test('an unknown host source is rejected', () => {
  assert.throws(() =>
    validateEnvironment({
      ...developmentEnvironment,
      TENANT_HOST_SOURCE: 'hop-count',
    }),
  );
});

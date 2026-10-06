import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeHostname,
  type HostnameRejection,
} from '../../src/tenancy/tenant-hostname.js';

function accepts(input: unknown, expected: string) {
  const result = normalizeHostname(input);
  assert.ok(
    result.ok,
    `expected ${JSON.stringify(input)} to normalize, got ${JSON.stringify(result)}`,
  );
  assert.equal(result.hostname, expected);
}

function rejects(input: unknown, reason: HostnameRejection) {
  const result = normalizeHostname(input);
  assert.equal(
    result.ok,
    false,
    `expected ${JSON.stringify(input)} to be rejected`,
  );
  assert.equal(result.reason, reason);
}

test('an exact normal host passes through unchanged', () => {
  accepts('requests.example.gov', 'requests.example.gov');
  accepts('localhost', 'localhost');
  accepts('example.platform.getreqro.com', 'example.platform.getreqro.com');
});

test('case is normalized to lower case', () => {
  accepts('Requests.Example.GOV', 'requests.example.gov');
  accepts('REQUESTS.EXAMPLE.GOV', 'requests.example.gov');
});

test('a valid port is stripped and an invalid one is rejected', () => {
  accepts('requests.example.gov:443', 'requests.example.gov');
  accepts('requests.example.gov:65535', 'requests.example.gov');
  accepts('requests.example.gov:1', 'requests.example.gov');
  rejects('requests.example.gov:', 'invalid_port');
  rejects('requests.example.gov:0', 'invalid_port');
  rejects('requests.example.gov:65536', 'invalid_port');
  rejects('requests.example.gov:443x', 'invalid_port');
  rejects('requests.example.gov:-1', 'invalid_port');
});

test('exactly one trailing dot is dropped', () => {
  accepts('requests.example.gov.', 'requests.example.gov');
  rejects('requests.example.gov..', 'invalid_label');
  rejects('.requests.example.gov', 'invalid_label');
});

test('IDN input becomes the canonical punycode A-label and is idempotent', () => {
  accepts('münchen.example.gov', 'xn--mnchen-3ya.example.gov');
  accepts('MÜNCHEN.example.gov', 'xn--mnchen-3ya.example.gov');
  accepts('xn--mnchen-3ya.example.gov', 'xn--mnchen-3ya.example.gov');
  // Malformed punycode is not silently passed through as a literal label.
  rejects('xn--a-ecp.ru', 'invalid_idna');
  rejects('xn--.example.gov', 'invalid_idna');
});

test('malformed hostnames are rejected', () => {
  rejects('exa mple.gov', 'forbidden_character');
  rejects('example.gov/catalog', 'forbidden_character');
  rejects('https://example.gov', 'forbidden_character');
  rejects('user@example.gov', 'forbidden_character');
  rejects('example..gov', 'invalid_label');
  rejects('-example.gov', 'invalid_label');
  rejects('example-.gov', 'invalid_label');
  // Percent sequences are refused before the IDNA layer, which would
  // otherwise decode `%65xample.gov` into `example.gov`.
  rejects('%65xample.gov', 'forbidden_character');
});

test('control characters are rejected', () => {
  rejects('example.gov\r\n', 'control_character');
  rejects('example\t.gov', 'control_character');
  rejects('example.gov\u0000', 'control_character');
  rejects('\u007fexample.gov', 'control_character');
});

test('comma-joined or repeated Host values are never merged or split', () => {
  rejects('a.example.gov,b.example.gov', 'multiple_hosts');
  rejects('a.example.gov, b.example.gov', 'multiple_hosts');
  rejects(',', 'multiple_hosts');
});

test('a label longer than 63 octets is rejected', () => {
  accepts(`${'a'.repeat(63)}.example.gov`, `${'a'.repeat(63)}.example.gov`);
  rejects(`${'a'.repeat(64)}.example.gov`, 'label_too_long');
});

test('a hostname longer than 253 octets is rejected', () => {
  const label = 'a'.repeat(63);
  const within = [label, label, label, 'a'.repeat(61)].join('.');
  assert.equal(within.length, 253);
  accepts(within, within);
  rejects([label, label, label, label].join('.'), 'hostname_too_long');
});

test('underscores are rejected', () => {
  rejects('_acme.example.gov', 'underscore');
  rejects('a_b.example.gov', 'underscore');
});

test('wildcards are rejected, so no wildcard record can ever be matched', () => {
  rejects('*.example.gov', 'wildcard');
  rejects('*', 'wildcard');
});

test('IP literals are rejected in every form', () => {
  rejects('127.0.0.1', 'ip_literal');
  rejects('127.0.0.1:443', 'ip_literal');
  // The URL layer expands shorthand IPv4; the numeric rightmost label still
  // refuses the result.
  rejects('127.1', 'ip_literal');
  rejects('[::1]', 'ip_literal');
  rejects('[::1]:8080', 'ip_literal');
  rejects('::1', 'ip_literal');
  rejects('fe80::1', 'ip_literal');
  // A numeric rightmost label is refused however it is reached: the URL layer
  // already treats `example.123` as a malformed address rather than a name.
  rejects('example.123', 'invalid_idna');
  rejects('0.0.0.0', 'ip_literal');
  assert.equal(normalizeHostname('example.0123').ok, false);
});

test('empty and missing input is rejected', () => {
  rejects('', 'absent');
  rejects(undefined, 'absent');
  rejects(null, 'absent');
  rejects(['example.gov'], 'absent');
  rejects(':443', 'absent');
  rejects('.', 'absent');
  rejects('a'.repeat(1025), 'oversized_input');
});

test('normalization is pure and total over arbitrary input', () => {
  for (const input of [
    'example.gov',
    'EXAMPLE.GOV.:443',
    '\u0001',
    '…',
    '0x7f.0.0.1',
    'example.gov..',
    {},
  ])
    assert.doesNotThrow(() => normalizeHostname(input));
  assert.deepEqual(
    normalizeHostname('EXAMPLE.GOV.:443'),
    normalizeHostname('example.gov'),
  );
});

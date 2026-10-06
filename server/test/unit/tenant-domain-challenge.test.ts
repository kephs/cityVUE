import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHALLENGE_TOKEN_LENGTH,
  CHALLENGE_VALUE_PREFIX,
  DEFAULT_CHALLENGE_LIFETIME_DAYS,
  MAXIMUM_CHALLENGE_LIFETIME_DAYS,
  MAXIMUM_VERIFIABLE_HOSTNAME_LENGTH,
  VERIFICATION_LABEL,
  challengeExpiry,
  challengeHash,
  challengeValue,
  isWellFormedChallengeValue,
  issueChallenge,
  matchesChallenge,
  verificationRecordName,
} from '../../src/tenancy/tenant-domain-challenge.js';
import { normalizeHostname } from '../../src/tenancy/tenant-hostname.js';

test('the record name is deterministic from the stored hostname', () => {
  assert.equal(
    verificationRecordName('requests.example.gov'),
    '_reqro-verify.requests.example.gov',
  );
  // Same input, same output, every time: an auditor can reproduce it.
  assert.equal(
    verificationRecordName('requests.example.gov'),
    verificationRecordName('requests.example.gov'),
  );
  assert.equal(
    verificationRecordName('example.platform.getreqro.com'),
    '_reqro-verify.example.platform.getreqro.com',
  );
});

test('the record name is intentionally outside the stored hostname grammar', () => {
  const recordName = verificationRecordName('requests.example.gov');
  assert.ok(recordName);
  // The normalizer rejects underscores by design, so the challenge name must
  // never be round-tripped through it or stored as a hostname.
  const normalized = normalizeHostname(recordName);
  assert.equal(normalized.ok, false);
  assert.equal(normalized.reason, 'underscore');
  assert.ok(VERIFICATION_LABEL.startsWith('_'));
});

test('the label does not collide with common mail or security records', () => {
  for (const reserved of [
    '_dmarc',
    '_domainkey',
    '_acme-challenge',
    '_mta-sts',
    '_smtp',
    '_tls',
    '_dnsauth',
  ])
    assert.notEqual(VERIFICATION_LABEL, reserved);
});

test('an oversized hostname cannot receive a challenge', () => {
  assert.equal(MAXIMUM_VERIFIABLE_HOSTNAME_LENGTH, 239);
  const label = 'a'.repeat(59);
  const longest = [label, label, label, 'a'.repeat(59)].join('.');
  assert.equal(longest.length, 239);
  const recordName = verificationRecordName(longest);
  assert.ok(recordName);
  // The queried name must still fit DNS's 253-octet limit.
  assert.equal(recordName.length, 253);

  assert.equal(verificationRecordName(`a${longest}`), null);
  assert.equal(verificationRecordName(''), null);
});

test('the token is 256 bits of base64url with no padding', () => {
  const issued = issueChallenge();

  assert.equal(issued.token.length, CHALLENGE_TOKEN_LENGTH);
  assert.equal(issued.token.length, 43);
  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(issued.token, /[=+/]/);
  assert.equal(issued.value, `${CHALLENGE_VALUE_PREFIX}${issued.token}`);
  assert.equal(issued.value, 'reqro-site-verification=v1.' + issued.token);
  assert.match(
    issued.tokenId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.ok(isWellFormedChallengeValue(issued.value));
});

test('issued tokens are unique and unpredictable across many draws', () => {
  const tokens = new Set<string>();
  const ids = new Set<string>();
  for (let index = 0; index < 500; index += 1) {
    const issued = issueChallenge();
    tokens.add(issued.token);
    ids.add(issued.tokenId);
  }
  assert.equal(tokens.size, 500);
  assert.equal(ids.size, 500);
});

test('a malformed challenge value is not accepted as well formed', () => {
  for (const value of [
    '',
    'reqro-site-verification=',
    'reqro-site-verification=v1.',
    `reqro-site-verification=v2.${'a'.repeat(43)}`,
    'a'.repeat(43),
    `reqro-site-verification=v1.${'a'.repeat(42)}`,
    `reqro-site-verification=v1.${'a'.repeat(44)}`,
    `reqro-site-verification=v1.${'a'.repeat(42)}+`,
  ])
    assert.equal(isWellFormedChallengeValue(value), false, value);
});

test('the correct TXT value verifies and a near miss does not', () => {
  const issued = issueChallenge();

  assert.equal(matchesChallenge([issued.value], issued.value), true);
  // Never trimmed, prefix-matched or case-folded.
  assert.equal(matchesChallenge([` ${issued.value}`], issued.value), false);
  assert.equal(matchesChallenge([`${issued.value} `], issued.value), false);
  assert.equal(
    matchesChallenge([issued.value.toUpperCase()], issued.value),
    false,
  );
  assert.equal(
    matchesChallenge([issued.value.slice(0, -1)], issued.value),
    false,
  );
  assert.equal(matchesChallenge([`${issued.value}extra`], issued.value), false);
});

test('a missing or wrong TXT value does not verify', () => {
  const issued = issueChallenge();

  assert.equal(matchesChallenge([], issued.value), false);
  assert.equal(matchesChallenge([''], issued.value), false);
  assert.equal(
    matchesChallenge([challengeValue('b'.repeat(43))], issued.value),
    false,
  );
});

test('a name holding several TXT values verifies on an exact match only', () => {
  const issued = issueChallenge();
  const others = [
    'v=spf1 include:example.gov -all',
    'google-site-verification=abc',
    challengeValue('c'.repeat(43)),
  ];

  assert.equal(matchesChallenge([...others, issued.value], issued.value), true);
  assert.equal(matchesChallenge([issued.value, ...others], issued.value), true);
  assert.equal(matchesChallenge(others, issued.value), false);
  // Values are never concatenated into one string before comparing.
  assert.equal(matchesChallenge([others.join('')], issued.value), false);
});

test('a replacement challenge produces a different token and value', () => {
  const first = issueChallenge();
  const second = issueChallenge();

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenId, second.tokenId);
  assert.notEqual(first.value, second.value);
  // The old value stops satisfying the new challenge immediately.
  assert.equal(matchesChallenge([first.value], second.value), false);
  assert.notEqual(challengeHash(first.value), challengeHash(second.value));
});

test('the challenge hash is stable lowercase hex SHA-256', () => {
  const hash = challengeHash('reqro-site-verification=v1.token');

  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, challengeHash('reqro-site-verification=v1.token'));
  assert.notEqual(hash, challengeHash('reqro-site-verification=v1.Token'));
});

test('the challenge window honours the approved bounds', () => {
  const requested = new Date('2026-10-06T12:00:00.000Z');

  assert.equal(DEFAULT_CHALLENGE_LIFETIME_DAYS, 14);
  assert.equal(MAXIMUM_CHALLENGE_LIFETIME_DAYS, 30);
  assert.equal(
    challengeExpiry(requested, DEFAULT_CHALLENGE_LIFETIME_DAYS).toISOString(),
    '2026-10-20T12:00:00.000Z',
  );
  assert.equal(
    challengeExpiry(requested, 30).toISOString(),
    '2026-11-05T12:00:00.000Z',
  );
  for (const lifetime of [0, -1, 31, 365, 1.5, Number.NaN])
    assert.throws(() => challengeExpiry(requested, lifetime), RangeError);
});

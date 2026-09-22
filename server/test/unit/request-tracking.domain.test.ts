import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateTrackingCredential,
  trackingDigest,
  validTrackingCredential,
  requesterStatus,
} from '../../src/service-request/request-tracking.domain.js';
test('F044 uses canonical 32-byte random credentials and deterministic SHA-256 digests', () => {
  const results = Array.from({ length: 100 }, generateTrackingCredential);
  assert.equal(new Set(results.map((x) => x.credential)).size, 100);
  for (const x of results) {
    assert.ok(validTrackingCredential(x.credential));
    assert.equal(Buffer.from(x.credential, 'base64url').length, 32);
    assert.match(x.digest, /^[a-f0-9]{64}$/);
    assert.equal(x.digest, trackingDigest(x.credential));
    assert.notEqual(x.digest, x.credential);
  }
  for (const x of [
    null,
    undefined,
    '',
    'SR-202609-000007',
    '10000000-0000-4000-8000-000000000001',
    'A'.repeat(42),
    'A'.repeat(44),
    'A'.repeat(42) + 'B',
  ])
    assert.equal(validTrackingCredential(x), false);
});
test('F044 requester statuses hide hold state and fail closed for unknown states', () => {
  assert.equal(requesterStatus('open'), 'open');
  assert.equal(requesterStatus('on_hold'), 'in_progress');
  assert.equal(requesterStatus('in_progress'), 'in_progress');
  assert.equal(requesterStatus('closed'), 'closed');
  assert.equal(requesterStatus('cancelled'), 'cancelled');
  assert.equal(requesterStatus('secret'), 'unavailable');
});

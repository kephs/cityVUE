import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateTrackingCredential,
  trackingDigest,
  validTrackingCredential,
  requesterStatus,
  trackingLifetimeDays,
  validTrackingLifetimeDays,
  TRACKING_LIFETIME_MINIMUM_DAYS,
  TRACKING_LIFETIME_DEFAULT_DAYS,
  TRACKING_LIFETIME_MAXIMUM_DAYS,
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
test('F065 approved lifetime bounds are 30/180/365 days', () => {
  assert.equal(TRACKING_LIFETIME_MINIMUM_DAYS, 30);
  assert.equal(TRACKING_LIFETIME_DEFAULT_DAYS, 180);
  assert.equal(TRACKING_LIFETIME_MAXIMUM_DAYS, 365);
});
test('F065 lifetime validation admits only whole days inside the platform bound', () => {
  for (const good of [30, 31, 180, 364, 365])
    assert.equal(
      validTrackingLifetimeDays(good),
      true,
      `${String(good)} is in range`,
    );
  for (const bad of [
    29,
    366,
    0,
    -1,
    180.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '180',
    null,
    undefined,
    {},
  ])
    assert.equal(
      validTrackingLifetimeDays(bad),
      false,
      `${JSON.stringify(bad)} must be refused`,
    );
});
test('F065 a stored lifetime is clamped, so a relaxed constraint cannot widen it', () => {
  // In range, taken as-is.
  assert.equal(trackingLifetimeDays(30), 30);
  assert.equal(trackingLifetimeDays(180), 180);
  assert.equal(trackingLifetimeDays(365), 365);
  // Out of range clamps toward the platform bound rather than being trusted.
  assert.equal(trackingLifetimeDays(1), TRACKING_LIFETIME_MINIMUM_DAYS);
  assert.equal(trackingLifetimeDays(100000), TRACKING_LIFETIME_MAXIMUM_DAYS);
  assert.equal(trackingLifetimeDays(-5), TRACKING_LIFETIME_MINIMUM_DAYS);
  // Absent or non-integer takes the platform default.
  for (const absent of [undefined, null, '180', 180.5, Number.NaN, {}])
    assert.equal(
      trackingLifetimeDays(absent),
      TRACKING_LIFETIME_DEFAULT_DAYS,
      `${JSON.stringify(absent)} falls back to the default`,
    );
});
test('F044 requester statuses hide hold state and fail closed for unknown states', () => {
  assert.equal(requesterStatus('open'), 'open');
  assert.equal(requesterStatus('on_hold'), 'in_progress');
  assert.equal(requesterStatus('in_progress'), 'in_progress');
  assert.equal(requesterStatus('closed'), 'closed');
  assert.equal(requesterStatus('cancelled'), 'cancelled');
  assert.equal(requesterStatus('secret'), 'unavailable');
});

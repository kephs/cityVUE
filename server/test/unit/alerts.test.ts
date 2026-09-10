import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAlertVisible,
  validateAlertInput,
} from '../../src/alerts/alert.domain.js';

const input = {
  type: 'notice',
  severity: 'info',
  title: ' Notice ',
  message: 'Service update',
  startsAt: '2026-09-10T12:00:00Z',
};
const now = new Date(input.startsAt);
const active = {
  is_active: true,
  starts_at: now,
  expires_at: null,
  published_at: now,
  deactivated_at: null,
};
test('active alert with no expiration remains visible', () => {
  assert.equal(isAlertVisible(active, now), true);
});
for (const [name, changes] of Object.entries({
  future: { starts_at: new Date(now.getTime() + 1) },
  expired: { expires_at: now },
  deactivated: { is_active: false },
  archived: { deactivated_at: now },
  unpublished: { published_at: null },
  futurePublication: { published_at: new Date(now.getTime() + 1) },
}))
  test(`${name} alert is invisible`, () => {
    assert.equal(isAlertVisible({ ...active, ...changes }, now), false);
  });
test('expiration after current time is visible', () => {
  assert.equal(
    isAlertVisible({ ...active, expires_at: new Date(now.getTime() + 1) }, now),
    true,
  );
});
test('normalizes title and empty optional values', () => {
  const dto = validateAlertInput({
    ...input,
    linkUrl: ' ',
    imageUrl: '',
    expiresAt: '',
  });
  assert.equal(dto.title, 'Notice');
  assert.equal(dto.linkUrl, null);
});
for (const [name, changes] of Object.entries({
  severity: { severity: 'urgent' },
  type: { type: 'custom' },
  expiration: { expiresAt: '2026-09-10T11:00:00Z' },
  equalExpiration: { expiresAt: input.startsAt },
  invalidDate: { startsAt: '2026-02-30T12:00:00Z' },
  missingZone: { startsAt: '2026-09-10T12:00:00' },
  emptyTitle: { title: ' ' },
  longTitle: { title: 'x'.repeat(161) },
  emptyMessage: { message: '' },
  longMessage: { message: 'x'.repeat(4001) },
  html: { message: '<script>alert(1)</script>' },
  unknownField: { isActive: true },
  orphanLabel: { linkLabel: 'Details' },
  credentialLink: { linkUrl: 'https://user:pass@example.com' },
}))
  test(`rejects invalid ${name}`, () => {
    assert.throws(() => validateAlertInput({ ...input, ...changes }));
  });
for (const field of ['linkUrl', 'imageUrl'])
  for (const url of [
    'javascript:alert(1)',
    'data:image/png;base64,abc',
    'file:///tmp/a',
    'http://example.com/a',
    '//example.com/a',
  ]) {
    test(`rejects unsafe ${field}: ${url}`, () => {
      assert.throws(() => validateAlertInput({ ...input, [field]: url }));
    });
  }
test('accepts HTTPS links and reserved image URLs', () => {
  assert.ok(
    validateAlertInput({
      ...input,
      linkUrl: 'https://example.com/details',
      imageUrl: 'https://example.com/image.png',
    }),
  );
});

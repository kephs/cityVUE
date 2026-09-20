import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultReferencePolicy as defaults,
  validateReferencePolicy,
  referencePeriod,
  formatReferenceNumber,
  historicalComponents,
} from '../../src/service-request/reference-policy.domain.js';
for (const change of [
  { prefix: 'bad\n' },
  { prefix: '=SUM(1)' },
  { prefix: 'x/y' },
  { prefix: 'a?b' },
  { prefix: 'ABCDEFGHIJKLM' },
  { prefix: ' SR' },
  { separator: '/' },
  { separator: '--' },
  { sequenceWidth: 0 },
  { sequenceWidth: -1 },
  { sequenceWidth: 99 },
  { sequenceWidth: 4.5 },
  { dateComponent: 'unknown' },
  { resetPolicy: 'unknown' },
  { dateComponent: 'none' },
  { dateComponent: 'year' },
]) {
  test(`reference configuration rejects ${JSON.stringify(change)}`, () => {
    assert.throws(() => validateReferencePolicy({ ...defaults, ...change }));
  });
}
test('supported examples, canonical prefix, minimum width and bigint precision', () => {
  const year = validateReferencePolicy({
    ...defaults,
    prefix: 'sr',
    dateComponent: 'year',
    resetPolicy: 'yearly',
  });
  assert.equal(formatReferenceNumber(year, '2026', 1n), 'SR-2026-000001');
  assert.equal(
    formatReferenceNumber(
      { ...year, prefix: '311', sequenceWidth: 8 },
      '2026',
      1n,
    ),
    '311-2026-00000001',
  );
  const never = validateReferencePolicy({
    ...defaults,
    prefix: 'CASE',
    dateComponent: 'none',
    resetPolicy: 'never',
    sequenceWidth: 8,
  });
  assert.equal(formatReferenceNumber(never, 'never', 1n), 'CASE-00000001');
  for (const value of [9998n, 9999n, 10000n, 10001n])
    assert.equal(
      formatReferenceNumber(
        { ...never, prefix: '', sequenceWidth: 4 },
        'never',
        value,
      ),
      String(value),
    );
  assert.equal(
    formatReferenceNumber({ ...never, prefix: '' }, 'never', 9007199254740993n),
    '9007199254740993',
  );
  assert.throws(() =>
    formatReferenceNumber(never, 'never', 9223372036854775808n),
  );
});
test('Organization-local monthly/yearly boundary and never reset are deterministic', () => {
  const instant = new Date('2027-01-01T02:00:00Z');
  assert.equal(
    referencePeriod(defaults, instant, 'America/New_York'),
    '202612',
  );
  assert.equal(
    referencePeriod(
      { ...defaults, resetPolicy: 'yearly' },
      instant,
      'America/New_York',
    ),
    '2026',
  );
  assert.equal(
    referencePeriod({ ...defaults, resetPolicy: 'yearly' }, instant, 'UTC'),
    '2027',
  );
  assert.equal(
    referencePeriod({ ...defaults, resetPolicy: 'never' }, instant, 'UTC'),
    'never',
  );
});
test('historical collision parsing only recognizes canonical output of the proposed policy', () => {
  assert.deepEqual(historicalComponents(defaults, 'SR-202609-000001'), {
    period: '202609',
    value: 1n,
  });
  assert.equal(historicalComponents(defaults, 'SR-202613-000001'), null);
  assert.equal(historicalComponents(defaults, 'SR-202609-0000001'), null);
  assert.equal(historicalComponents(defaults, 'OTHER-202609-000001'), null);
});

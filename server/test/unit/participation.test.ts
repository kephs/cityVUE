import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  participationPeriod,
  participationThreshold,
  suppressParticipation,
  validateParticipation,
} from '../../src/service-request/participation.domain.js';
import { developmentStaffBundles } from '../../src/database/development-staff-input.js';

test('F051 explicit geography states never infer identity or allow INTERNAL/legacy input', () => {
  validateParticipation(undefined, 'public');
  validateParticipation(undefined, 'internal');
  validateParticipation({ state: 'PROVIDED', areaId: randomUUID() }, 'public');
  validateParticipation({ state: 'DECLINED' }, 'public');
  for (const value of [
    null,
    { state: 'NOT_COLLECTED' },
    { state: 'PROVIDED' },
    { state: 'DECLINED', areaId: randomUUID() },
    { state: 'PROVIDED', areaId: 'wrong' },
  ])
    assert.throws(() => {
      validateParticipation(value as never, 'public');
    });
  assert.throws(() => {
    validateParticipation({ state: 'DECLINED' }, 'internal');
  });
  for (const bundle of Object.values(developmentStaffBundles))
    assert.ok(
      !(bundle as readonly string[]).includes(
        'analytics.service_participation.read',
      ),
    );
});
test('F051 suppression handles zero, threshold boundaries and secondary buckets without totals', () => {
  for (const count of [0, 1, 4, 5, 6])
    assert.deepEqual(
      suppressParticipation(count, 5),
      count > 0 && count < 5
        ? { suppressed: true, count: null }
        : { suppressed: false, count },
    );
  for (const threshold of [0, 1, 4, 5.5, 1001, NaN])
    assert.throws(() => participationThreshold(threshold));
  assert.throws(() => suppressParticipation(-1, 5));
  const response = {
    a: suppressParticipation(7, 5),
    b: suppressParticipation(3, 5),
  };
  assert.equal(response.b.count, null);
  assert.ok(!JSON.stringify(response).includes('total'));
});
test('F051 inclusive UTC periods reject tiny/excessive/future/invalid ranges', () => {
  const now = new Date('2026-09-23T12:00:00Z');
  const p = participationPeriod('2026-08-27', '2026-09-23', now);
  assert.equal(p.from.toISOString(), '2026-08-27T00:00:00.000Z');
  assert.equal(p.until.toISOString(), '2026-09-24T00:00:00.000Z');
  for (const [start, end] of [
    ['2026-09-01', '2026-09-23'],
    ['2025-01-01', '2026-09-23'],
    ['2026-09-01', '2026-10-01'],
    ['2026-02-30', '2026-03-31'],
    ['2026-09-23', '2026-08-01'],
    ['2026-01-01T00:00Z', '2026-04-01'],
  ])
    assert.throws(() => participationPeriod(start ?? '', end ?? '', now));
});

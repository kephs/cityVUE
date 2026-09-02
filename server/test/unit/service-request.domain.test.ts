import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  conditionMatches,
  formatReferenceNumber,
  normalizeAnswer,
  periodKeyFor,
  validateLocationPolicy,
  validateRequesterPolicy,
} from '../../src/service-request/service-request.domain.js';

test('formats canonical references and rejects invalid components', () => {
  assert.equal(formatReferenceNumber('202609', 1), 'SR-202609-000001');
  assert.equal(formatReferenceNumber('202609', 999999), 'SR-202609-999999');
  assert.throws(() => formatReferenceNumber('20269', 1));
  assert.throws(() => formatReferenceNumber('202609', 1000000));
});
test('calculates the month in the Organization business timezone', () => {
  const instant = new Date('2026-10-01T03:30:00Z');
  assert.equal(periodKeyFor(instant, 'America/New_York'), '202609');
  assert.equal(periodKeyFor(instant, 'UTC'), '202610');
  assert.equal(
    periodKeyFor(new Date('2026-10-01T04:00:00Z'), 'America/New_York'),
    '202610',
  );
});
test('equality visibility supports canonical booleans and prototype yes/no values', () => {
  assert.equal(conditionMatches(true, 'yes'), true);
  assert.equal(conditionMatches(false, 'no'), true);
  assert.equal(conditionMatches('road', 'road'), true);
  assert.equal(conditionMatches(undefined, 'yes'), false);
});
test('normalizes supported semantic answer types', () => {
  assert.equal(normalizeAnswer('short_text', '  value  '), 'value');
  assert.equal(normalizeAnswer('number', 2.5), 2.5);
  assert.equal(normalizeAnswer('yes_no', true), true);
  assert.equal(normalizeAnswer('single_select', ' option '), 'option');
  assert.throws(() => normalizeAnswer('number', '2'), BadRequestException);
  assert.throws(() => normalizeAnswer('yes_no', 'yes'), BadRequestException);
});
test('enforces requester and location policies', () => {
  assert.throws(() => {
    validateRequesterPolicy('anonymous', 'not_allowed', false);
  }, BadRequestException);
  assert.throws(() => {
    validateRequesterPolicy('identified', 'allowed', false);
  }, BadRequestException);
  assert.throws(() => {
    validateRequesterPolicy('anonymous', 'allowed', true);
  }, BadRequestException);
  assert.doesNotThrow(() => {
    validateRequesterPolicy('identified', 'not_allowed', true);
  });
  assert.throws(() => {
    validateLocationPolicy('required', false);
  }, BadRequestException);
  assert.throws(() => {
    validateLocationPolicy('not_applicable', true);
  }, BadRequestException);
  assert.doesNotThrow(() => {
    validateLocationPolicy('optional', false);
  });
});

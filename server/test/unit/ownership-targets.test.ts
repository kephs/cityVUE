import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  validateTarget,
  validateTargetSearch,
  operationalView,
} from '../../src/service-request/ownership-targets.js';
const id = '10000000-0000-4000-8000-000000000001';
test('F037 admits only internal STAFF/ROLE/GROUP target identifiers', () => {
  for (const type of ['staff', 'role', 'group'])
    assert.doesNotThrow(() => {
      validateTarget(type, id);
    });
  for (const type of ['distribution_list', 'email', 'department', '*', null])
    assert.throws(() => {
      validateTarget(type, id);
    }, BadRequestException);
  for (const value of ['fictional@example.com', '../path', '', null])
    assert.throws(() => {
      validateTarget('staff', value);
    }, BadRequestException);
});
test('F037 search is bounded plain text and rejects control characters', () => {
  assert.equal(validateTargetSearch('  Fictional café  '), 'Fictional café');
  assert.equal(
    validateTargetSearch('<script>text</script>'),
    '<script>text</script>',
  );
  for (const value of ['x'.repeat(101), 'line\nfeed', 'tab\t', null])
    assert.throws(() => validateTargetSearch(value), BadRequestException);
});
test('F037 operational views use an explicit allowlist', () => {
  for (const view of ['all', 'mine', 'team', 'watching'])
    assert.doesNotThrow(() => operationalView(view, id, id));
  assert.throws(
    () => operationalView('all OR true', id, id),
    BadRequestException,
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRequestId } from '../../src/common/logging/request-logging.middleware.js';

test('request ID preserves a safely formatted inbound correlation ID', () => {
  assert.equal(selectRequestId('resident-web-1234'), 'resident-web-1234');
});

test('request ID replaces unsafe or absent inbound values', () => {
  const unsafe = selectRequestId('bad value');
  const absent = selectRequestId(undefined);

  assert.match(unsafe, /^[0-9a-f-]{36}$/);
  assert.match(absent, /^[0-9a-f-]{36}$/);
  assert.notEqual(unsafe, absent);
});

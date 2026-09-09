import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRequestId } from '../../src/common/logging/request-logging.middleware.js';

test('request ID replaces token-like and valid UUID inbound values with server UUIDs', () => {
  for (const input of [
    'HARMLESS_API_TOKEN_SENTINEL_123456',
    '3e4666bf-d5e5-4aa7-b8ce-cefe41c7568a',
  ]) {
    const generated = selectRequestId(input);
    assert.match(
      generated,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    assert.notEqual(generated, input);
  }
});

test('request ID replaces unsafe or absent inbound values', () => {
  const unsafe = selectRequestId('bad value');
  const absent = selectRequestId(undefined);

  assert.match(unsafe, /^[0-9a-f-]{36}$/);
  assert.match(absent, /^[0-9a-f-]{36}$/);
  assert.notEqual(unsafe, absent);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  COMMUNICATION_BODY_MAXIMUM,
  normalizeCommunicationBody,
} from '../../src/service-request/request-communication.domain.js';

test('F042 invalid Unicode surrogate halves are rejected rather than silently rewritten by PostgreSQL encoding', () => {
  assert.throws(() => normalizeCommunicationBody('Fictional \ud800'));
  assert.throws(() => normalizeCommunicationBody('Fictional \udfff'));
  assert.equal(normalizeCommunicationBody('Fictional 😀'), 'Fictional 😀');
});

test('F042 communications preserve meaningful Unicode, multiline content and literal markup', () => {
  const body =
    '  José — 検査\r\nSecond line\rThird line\n<script>example</script> @team https://example.com/  ';
  assert.equal(
    normalizeCommunicationBody(body),
    'José — 検査\nSecond line\nThird line\n<script>example</script> @team https://example.com/',
  );
  assert.equal(normalizeCommunicationBody('x'), 'x');
});

test('F042 communication length is bounded before trimming and counts UTF-16 consistently with textareas', () => {
  assert.equal(
    normalizeCommunicationBody('x'.repeat(COMMUNICATION_BODY_MAXIMUM)).length,
    4000,
  );
  assert.equal(normalizeCommunicationBody('😀'.repeat(2000)).length, 4000);
  for (const body of [
    'x'.repeat(4001),
    '😀'.repeat(2001),
    `${' '.repeat(4000)}x`,
  ])
    assert.throws(() => normalizeCommunicationBody(body), BadRequestException);
});

test('F042 communication validation rejects empty, whitespace-only and non-text input', () => {
  for (const body of [
    '',
    ' \r\n ',
    '\u00a0\u2003',
    null,
    undefined,
    5,
    {},
    ['communication'],
  ])
    assert.throws(() => normalizeCommunicationBody(body), BadRequestException);
});

test('F042 communications reject narrative-policy controls while permitting ordinary line breaks', () => {
  for (const code of [
    0, 1, 9, 11, 12, 14, 31, 127, 128, 159, 0x202a, 0x202e, 0x2066, 0x2069,
  ])
    assert.throws(
      () =>
        normalizeCommunicationBody(`before${String.fromCharCode(code)}after`),
      BadRequestException,
    );
  assert.equal(normalizeCommunicationBody('one\n\ntwo'), 'one\n\ntwo');
});

test('F042 validation errors never echo submitted communication text', () => {
  const privateText = 'Fictional protected collaboration marker';
  try {
    normalizeCommunicationBody(`${privateText}\u0000`);
    assert.fail('Invalid communication must be rejected');
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    assert.ok(!JSON.stringify(error.getResponse()).includes(privateText));
  }
});

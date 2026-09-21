import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  NOTE_BODY_MAXIMUM,
  normalizeNoteBody,
} from '../../src/service-request/request-note.domain.js';

test('F041 invalid Unicode surrogate halves are rejected rather than silently rewritten by PostgreSQL encoding', () => {
  assert.throws(() => normalizeNoteBody('Fictional \ud800'));
  assert.throws(() => normalizeNoteBody('Fictional \udfff'));
  assert.equal(normalizeNoteBody('Fictional 😀'), 'Fictional 😀');
});

test('F041 notes preserve meaningful Unicode, multiline content and literal markup', () => {
  const body =
    '  José — 検査\r\nSecond line\rThird line\n<script>example</script> @team https://example.com/  ';
  assert.equal(
    normalizeNoteBody(body),
    'José — 検査\nSecond line\nThird line\n<script>example</script> @team https://example.com/',
  );
  assert.equal(normalizeNoteBody('x'), 'x');
});

test('F041 note length is bounded before trimming and counts UTF-16 consistently with textareas', () => {
  assert.equal(normalizeNoteBody('x'.repeat(NOTE_BODY_MAXIMUM)).length, 4000);
  assert.equal(normalizeNoteBody('😀'.repeat(2000)).length, 4000);
  for (const body of [
    'x'.repeat(4001),
    '😀'.repeat(2001),
    `${' '.repeat(4000)}x`,
  ])
    assert.throws(() => normalizeNoteBody(body), BadRequestException);
});

test('F041 note validation rejects empty, whitespace-only and non-text input', () => {
  for (const body of [
    '',
    ' \r\n ',
    '\u00a0\u2003',
    null,
    undefined,
    5,
    {},
    ['note'],
  ])
    assert.throws(() => normalizeNoteBody(body), BadRequestException);
});

test('F041 notes reject narrative-policy controls while permitting ordinary line breaks', () => {
  for (const code of [
    0, 1, 9, 11, 12, 14, 31, 127, 128, 159, 0x202a, 0x202e, 0x2066, 0x2069,
  ])
    assert.throws(
      () => normalizeNoteBody(`before${String.fromCharCode(code)}after`),
      BadRequestException,
    );
  assert.equal(normalizeNoteBody('one\n\ntwo'), 'one\n\ntwo');
});

test('F041 validation errors never echo submitted note text', () => {
  const privateText = 'Fictional protected collaboration marker';
  try {
    normalizeNoteBody(`${privateText}\u0000`);
    assert.fail('Invalid note must be rejected');
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    assert.ok(!JSON.stringify(error.getResponse()).includes(privateText));
  }
});

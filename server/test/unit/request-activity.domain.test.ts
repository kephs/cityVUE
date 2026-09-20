import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  normalizeOperationalNarrative,
  workflowActivityTypes,
} from '../../src/service-request/request-activity.domain.js';

test('F035 maps trusted lifecycle commands to typed operational events', () => {
  assert.deepEqual(workflowActivityTypes, {
    start_work: 'work_started',
    hold: 'placed_on_hold',
    resume: 'work_resumed',
    close: 'request_closed',
    reopen: 'request_reopened',
  });
  assert.equal(normalizeOperationalNarrative('start_work'), null);
  assert.equal(normalizeOperationalNarrative('resume'), null);
});

test('F035 retains plain Unicode/HTML/markdown text and meaningful line breaks', () => {
  const text = `<script>alert('x')</script>\n**Fictional** café "room"`;
  assert.equal(
    normalizeOperationalNarrative('hold', `  ${text.replace(/\n/g, '\r\n')}  `),
    text,
  );
  assert.equal(
    normalizeOperationalNarrative('reopen', ' Review again '),
    'Review again',
  );
  assert.equal(
    normalizeOperationalNarrative('close', undefined, ' Resolved '),
    'Resolved',
  );
});

test('F035 requires the action-specific narrative and enforces existing limits', () => {
  for (const action of ['hold', 'reopen', 'close'] as const) {
    for (const blank of [undefined, '', ' \r\n '])
      assert.throws(
        () => normalizeOperationalNarrative(action, blank, blank),
        BadRequestException,
      );
  }
  assert.equal(
    normalizeOperationalNarrative('hold', 'x'.repeat(500))?.length,
    500,
  );
  assert.equal(
    normalizeOperationalNarrative('close', undefined, 'x'.repeat(2000))?.length,
    2000,
  );
  assert.throws(
    () => normalizeOperationalNarrative('hold', 'x'.repeat(501)),
    BadRequestException,
  );
  assert.throws(
    () => normalizeOperationalNarrative('close', undefined, 'x'.repeat(2001)),
    BadRequestException,
  );
  assert.throws(
    () =>
      normalizeOperationalNarrative('close', 'A reason is not a resolution'),
    BadRequestException,
  );
});

test('F035 rejects control and directional injection without reflecting content', () => {
  for (const control of [
    '\0',
    '\t',
    '\x1b',
    '\x7f',
    '\x85',
    '\u202e',
    '\u2066',
  ]) {
    assert.throws(
      () =>
        normalizeOperationalNarrative(
          'hold',
          `Fictional${control}private text`,
        ),
      (error: unknown) =>
        error instanceof BadRequestException &&
        error.message === 'Invalid operational narrative',
    );
  }
});

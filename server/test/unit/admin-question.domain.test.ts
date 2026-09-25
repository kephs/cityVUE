import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateQuestions,
  type QuestionConfiguration,
} from '../../src/admin/admin-question.domain.js';
import { normalizeAnswer } from '../../src/service-request/service-request.domain.js';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}
const wireQuestion = ({
  key,
  prompt,
  help,
  type,
  required,
  order,
  options,
}: QuestionConfiguration) => ({
  key,
  prompt,
  help,
  type,
  required,
  order,
  options,
});
const fresh = () => ({
  key: null,
  prompt: ' Question ',
  help: ' Help ',
  type: 'short_text',
  required: false,
  order: 0,
  options: [],
});
test('F056.2A opaque semantic identity, trim, capitalization, limits and safe text', () => {
  const first = required(validateQuestions([fresh()], [])[0]);
  assert.equal(first.prompt, 'Question');
  assert.equal(first.help, 'Help');
  assert.match(first.key, /^[0-9a-f-]{36}$/);
  const wire = wireQuestion(first);
  assert.deepEqual(validateQuestions([wire], [first]), [first]);
  assert.equal(
    validateQuestions(
      [{ ...wire, prompt: '<script>safe plain text</script>' }],
      [first],
    )[0]?.key,
    first.key,
  );
  assert.equal(
    validateQuestions(
      Array.from({ length: 25 }, (_, i) => ({ ...fresh(), order: i })),
      [],
    ).length,
    25,
  );
  assert.throws(() =>
    validateQuestions(
      Array.from({ length: 26 }, (_, i) => ({ ...fresh(), order: i })),
      [],
    ),
  );
});
for (const change of [
  { prompt: '' },
  { prompt: 'x'.repeat(201) },
  { help: 'x'.repeat(501) },
  { type: 'timestamp' },
  { type: 'multi_select' },
  { type: 'information' },
  { order: -1 },
  { order: 1.1 },
  { required: 'true' },
  { organizationId: 'forged' },
  { key: 'invented' },
  { validation: { max: 5 } },
])
  test(`F056.2A strict authoring rejects ${String(Object.keys(change)[0])} ${typeof Object.values(change)[0]}`, () => {
    assert.throws(() => validateQuestions([{ ...fresh(), ...change }], []));
  });
test('F056.2A choice labels and numeric order are unique, choices bounded', () => {
  const q = {
    ...fresh(),
    type: 'single_select',
    options: [
      { key: null, label: ' Choice A ', order: 0 },
      { key: null, label: 'Choice B', order: 1 },
    ],
  };
  assert.equal(validateQuestions([q], [])[0]?.options[0]?.label, 'Choice A');
  assert.throws(() =>
    validateQuestions([{ ...q, options: [q.options[0]] }], []),
  );
  assert.throws(() =>
    validateQuestions(
      [
        {
          ...q,
          options: [q.options[0], { key: null, label: 'choice a', order: 1 }],
        },
      ],
      [],
    ),
  );
  assert.throws(() =>
    validateQuestions(
      [
        {
          ...q,
          options: [q.options[0], { key: null, label: 'Other', order: 0 }],
        },
      ],
      [],
    ),
  );
  assert.throws(() => validateQuestions([q, { ...fresh(), order: 0 }], []));
  const choices = Array.from({ length: 25 }, (_, i) => ({
    key: null,
    label: `Choice ${String(i)}`,
    order: i,
  }));
  assert.equal(
    validateQuestions(
      Array.from({ length: 8 }, (_, i) => ({
        ...q,
        order: i,
        options: choices,
      })),
      [],
    ).length,
    8,
  );
  assert.throws(() =>
    validateQuestions(
      Array.from({ length: 9 }, (_, i) => ({
        ...q,
        order: i,
        options: choices,
      })),
      [],
    ),
  );
});
test('F056.2A inherited condition keys survive wording; breaking controller/option/type is rejected', () => {
  const original: QuestionConfiguration[] = [
    {
      key: 'control',
      prompt: 'Control',
      help: '',
      type: 'single_select',
      required: true,
      order: 0,
      options: [
        { key: 'a', label: 'A', order: 0 },
        { key: 'b', label: 'B', order: 1 },
      ],
      condition: null,
      validation: null,
    },
    {
      key: 'dependent',
      prompt: 'Dependent',
      help: '',
      type: 'long_text',
      required: true,
      order: 1,
      options: [],
      condition: { questionKey: 'control', operator: 'equals', value: 'b' },
      validation: null,
    },
  ];
  const wire = original.map(wireQuestion);
  assert.deepEqual(validateQuestions(wire, original), original);
  assert.throws(() => validateQuestions([wire[1]], original));
  assert.throws(() =>
    validateQuestions(
      [{ ...wire[0], type: 'yes_no', options: [] }, wire[1]],
      original,
    ),
  );
  assert.throws(() =>
    validateQuestions(
      [
        {
          ...wire[0],
          options: [
            required(wire[0]).options[0],
            { key: null, label: 'C', order: 2 },
          ],
        },
        wire[1],
      ],
      original,
    ),
  );
});
test('F056.2A typed answers preserve false/zero and enforce Unicode and numeric bounds', () => {
  assert.equal(normalizeAnswer('yes_no', false), false);
  assert.equal(normalizeAnswer('number', 0), 0);
  assert.equal(normalizeAnswer('number', 0.000001), 0.000001);
  for (const value of [0.0000001, 1000000001, NaN, Infinity, '2'])
    assert.throws(() => normalizeAnswer('number', value));
  assert.equal(
    String(normalizeAnswer('short_text', '😀'.repeat(300))).length,
    600,
  );
  assert.throws(() => normalizeAnswer('short_text', '😀'.repeat(301)));
  assert.equal(normalizeAnswer('long_text', ' A\nB '), 'A\nB');
});

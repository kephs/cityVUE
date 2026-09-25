import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAnswer,
  validCalendarDate,
  conditionMatches,
} from '../../src/service-request/service-request.domain.js';
import {
  validateQuestions,
  type QuestionConfiguration,
} from '../../src/admin/admin-question.domain.js';

for (const value of ['0001-01-01', '2000-02-29', '2024-02-29', '9999-12-31'])
  test(`F056.2C strict calendar accepts ${value}`, () => {
    assert.equal(validCalendarDate(value), true);
    assert.equal(normalizeAnswer('date', value), value);
  });
for (const value of [
  '0000-01-01',
  '1900-02-29',
  '2100-02-29',
  '2023-02-29',
  '2024-04-31',
  '2024-13-01',
  '2024-01-32',
  '2024-00-01',
  '2024-01-00',
  '24-01-01',
  '2024-1-1',
  '01/01/2024',
  '2024-01-01T12:00:00Z',
  '2024-01-01+01:00',
  ' 2024-01-01',
  '2024-01-01 ',
  '2024-01-01\n',
  '2024-01-01\r\n',
  '',
  0,
  false,
  null,
  [],
  {},
])
  test(`F056.2C strict calendar rejects ${JSON.stringify(value)}`, () => {
    assert.equal(validCalendarDate(value), false);
    assert.throws(() => normalizeAnswer('date', value));
  });
test('F056.2C multi-select has bounded distinct identities and no implicit condition matching', () => {
  assert.deepEqual(normalizeAnswer('multi_select', ['second', 'first']), [
    'second',
    'first',
  ]);
  assert.deepEqual(normalizeAnswer('multi_select', []), []);
  for (const value of [
    ['same', 'same'],
    [''],
    [1],
    'one',
    {},
    Array.from({ length: 26 }, (_, i) => String(i)),
  ])
    assert.throws(() => normalizeAnswer('multi_select', value));
  assert.equal(conditionMatches(['a'], 'a'), false);
});
test('F056.2C Information accepts no value, even empty or boolean', () => {
  for (const value of ['', false, true, [], {}, null, undefined])
    assert.throws(() => normalizeAnswer('information', value));
});
test('F056.2C authoring retains prompt bounds, no Information help/required/options and no Date options', () => {
  const base = {
    key: null,
    prompt: '😀'.repeat(200),
    help: '',
    type: 'information',
    required: false,
    order: 0,
    options: [],
  };
  assert.equal(validateQuestions([base], []).length, 1);
  for (const extra of [
    { required: true },
    { help: 'Hidden help' },
    { prompt: '😀'.repeat(201) },
    { options: [{ key: null, label: 'Option', order: 0 }] },
    { validation: {} },
  ])
    assert.throws(() => validateQuestions([{ ...base, ...extra }], []));
  assert.equal(validateQuestions([{ ...base, type: 'date' }], []).length, 1);
  assert.throws(() =>
    validateQuestions(
      [
        {
          ...base,
          type: 'date',
          options: [{ key: null, label: 'Option', order: 0 }],
        },
      ],
      [],
    ),
  );
  const choice = {
    ...base,
    type: 'multi_select',
    required: true,
    options: [
      { key: null, label: 'First', order: 2 },
      { key: null, label: 'Second', order: 1 },
    ],
  };
  assert.equal(validateQuestions([choice], [])[0]?.options[0]?.label, 'Second');
  assert.throws(() =>
    validateQuestions(
      [
        {
          ...choice,
          options: [
            { key: null, label: ' Same ', order: 0 },
            { key: null, label: 'same', order: 1 },
          ],
        },
      ],
      [],
    ),
  );
});
test('F056.2C scalar conditions may target new dependents, but Multi-select cannot control conditions', () => {
  const controller: QuestionConfiguration = {
    key: 'controller',
    prompt: 'Controller',
    help: '',
    type: 'yes_no',
    required: true,
    order: 0,
    options: [],
    condition: null,
    validation: null,
  };
  for (const type of ['multi_select', 'date', 'information']) {
    const dependent: QuestionConfiguration = {
      ...controller,
      key: 'dependent',
      prompt: 'Dependent',
      type,
      order: 1,
      required: false,
      options:
        type === 'multi_select'
          ? [
              { key: 'a', label: 'A', order: 0 },
              { key: 'b', label: 'B', order: 1 },
            ]
          : [],
      condition: {
        questionKey: 'controller',
        operator: 'equals',
        value: 'yes',
      },
    };
    const original = [controller, dependent];
    const wire = original.map(
      ({ key, prompt, help, type, required, order, options }) => ({
        key,
        prompt,
        help,
        type,
        required,
        order,
        options,
      }),
    );
    assert.deepEqual(validateQuestions(wire, original), original);
    if (type === 'multi_select') {
      const reversed = [
        { ...dependent, condition: null },
        {
          ...controller,
          condition: {
            questionKey: dependent.key,
            operator: 'equals',
            value: 'a',
          },
        },
      ];
      assert.throws(() =>
        validateQuestions(
          reversed.map(
            ({ key, prompt, help, type, required, order, options }) => ({
              key,
              prompt,
              help,
              type,
              required,
              order,
              options,
            }),
          ),
          reversed,
        ),
      );
    }
  }
});

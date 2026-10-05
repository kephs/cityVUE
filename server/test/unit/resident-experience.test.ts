import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { BadRequestException } from '@nestjs/common';
import {
  classifyResidentChanges,
  validateResidentSnapshot,
  validatePhone,
  type ResidentSnapshot,
} from '../../src/resident-experience/resident-experience.domain.js';
import { residentAssets } from '../../src/resident-experience/resident-experience.policy.js';
import { permissions } from '../../src/auth/auth.types.js';
import {
  residentFixture,
  phoneFixture,
} from '../helpers/resident-experience.fixture.js';

function item<T>(items: T[], index = 0): T {
  const value = items[index];
  assert.ok(value !== undefined);
  return value;
}

test('F059.2 complete snapshots are detached, deterministic and retain stable logical IDs', () => {
  const input = phoneFixture();
  input.actions.reverse();
  const saved = validateResidentSnapshot(input);
  assert.deepEqual(
    saved.actions.map((a) => a.id),
    ['report', 'help'],
  );
  assert.deepEqual(
    input.actions.map((a) => a.id),
    ['help', 'report'],
  );
  input.presentation.branding.applicationName = 'Changed';
  assert.equal(
    saved.presentation.branding.applicationName,
    'Synthetic Community',
  );
  assert.deepEqual(
    validateResidentSnapshot({
      ...saved,
      actions: [],
      contacts: [],
      benefits: [],
    }).actions,
    [],
  );
});

const invalidCases: [string, (snapshot: ResidentSnapshot) => unknown][] = [
  [
    'duplicate action IDs',
    (s) => ({ ...s, actions: [s.actions[0], { ...s.actions[0], order: 20 }] }),
  ],
  [
    'duplicate action order',
    (s) => ({
      ...s,
      actions: [s.actions[0], { ...s.actions[0], id: 'other' }],
    }),
  ],
  [
    'duplicate benefits',
    (s) => ({ ...s, benefits: [s.benefits[0], s.benefits[0]] }),
  ],
  [
    'duplicate contacts',
    () => {
      const s = phoneFixture();
      return { ...s, contacts: [s.contacts[0], s.contacts[0]] };
    },
  ],
  [
    'oversized collection',
    (s) => ({
      ...s,
      actions: Array.from({ length: 7 }, (_, i) => ({
        ...s.actions[0],
        id: `action-${String(i)}`,
        order: i,
      })),
    }),
  ],
  [
    'overlong text',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        branding: {
          ...s.presentation.branding,
          applicationName: 'x'.repeat(101),
        },
      },
    }),
  ],
  [
    'malformed nested array',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, headline: {} },
      },
    }),
  ],
  [
    'missing complete section',
    (s) => ({ ...s, presentation: { hero: s.presentation.hero } }),
  ],
  ['unknown root field', (s) => ({ ...s, organizationId: 'forged' })],
  [
    'unknown nested field',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, style: 'color:red' },
      },
    }),
  ],
  ['unknown schema version', (s) => ({ ...s, schemaVersion: 2 })],
  [
    'unknown asset',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, assetKey: 'missing' },
      },
    }),
  ],
  [
    'wrong asset role',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, assetKey: 'reqro-favicon' },
      },
    }),
  ],
  [
    'remote asset',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, assetKey: 'https://example.org/a.svg' },
      },
    }),
  ],
  [
    'unknown palette',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        branding: { ...s.presentation.branding, themeKey: 'red' },
      },
    }),
  ],
  [
    'raw markup',
    (s) => ({
      ...s,
      actions: [{ ...s.actions[0], title: '<script>bad</script>' }],
    }),
  ],
  [
    'format control',
    (s) => ({ ...s, actions: [{ ...s.actions[0], title: 'Safe\u202eevil' }] }),
  ],
  [
    'invalid type',
    (s) => ({ ...s, actions: [{ ...s.actions[0], actionType: 'script' }] }),
  ],
  [
    'unknown icon',
    (s) => ({ ...s, actions: [{ ...s.actions[0], iconKey: 'constructor' }] }),
  ],
  [
    'wrong icon role',
    (s) => ({ ...s, actions: [{ ...s.actions[0], iconKey: 'residents' }] }),
  ],
  [
    'missing phone reference',
    (s) => ({
      ...s,
      actions: [
        {
          ...s.actions[0],
          actionType: 'phone',
          target: null,
          contactId: 'missing',
        },
      ],
    }),
  ],
  [
    'numeric phone CTA drift',
    () => {
      const s = phoneFixture();
      return {
        ...s,
        actions: s.actions.map((a) =>
          a.actionType === 'phone' ? { ...a, ctaLabel: 'Call 123' } : a,
        ),
      };
    },
  ],
  [
    'phone direct target',
    () => {
      const s = phoneFixture();
      return {
        ...s,
        actions: s.actions.map((a) =>
          a.actionType === 'phone' ? { ...a, target: '123' } : a,
        ),
      };
    },
  ],
  [
    'non-phone contact reference',
    (s) => ({ ...s, actions: [{ ...s.actions[0], contactId: 'help' }] }),
  ],
  [
    'decorative image with alt',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, alt: 'Unexpected' },
      },
    }),
  ],
  [
    'meaningful image without alt',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        hero: { ...s.presentation.hero, decorative: false },
      },
    }),
  ],
  [
    'missing home navigation',
    (s) => ({
      ...s,
      presentation: {
        ...s.presentation,
        navigation: { ...s.presentation.navigation, links: [] },
      },
    }),
  ],
  ['client consequential claim', (s) => ({ ...s, isConsequential: false })],
];
for (const [name, change] of invalidCases)
  test(`F059.2 rejects ${name}`, () => {
    assert.throws(
      () => validateResidentSnapshot(change(residentFixture())),
      BadRequestException,
    );
  });

for (const target of [
  'javascript:alert(1)',
  'data:text/html,x',
  'http://example.org',
  '//example.org',
  'https://user:secret@example.org',
  'https://user%40example.org@other.org',
  'https://example.org/\n',
  'https://example.org/%0a',
  'https://example.org/%250a',
  'https://example.org/%5c',
  'https://example.org/%253cscript%253e',
  'https%3A%2F%2Fexample.org',
  'https://localhost/x',
  'https://127.0.0.1',
  'https://example.org/\\evil',
]) {
  test(`F059.2 rejects external destination ${JSON.stringify(target)}`, () => {
    const s = residentFixture();
    s.actions = [{ ...item(s.actions), actionType: 'external', target }];
    assert.throws(() => validateResidentSnapshot(s), BadRequestException);
  });
}
for (const target of [
  '/admin',
  '/staff/requests',
  '/report?redirect=https://example.org',
  '/%2fexample.org',
  '/report#other',
  'https://example.org',
])
  test(`F059.2 closed internal route ${target}`, () => {
    const s = residentFixture();
    item(s.actions).target = target;
    assert.throws(() => validateResidentSnapshot(s));
  });
test('F059.2 accepts parsed public HTTPS destinations without fetching them', () => {
  const s = residentFixture();
  s.actions = [
    {
      ...item(s.actions),
      actionType: 'external',
      target: 'https://example.org/help?q=public%20help',
    },
  ];
  assert.equal(
    validateResidentSnapshot(s).actions[0]?.target,
    s.actions[0]?.target,
  );
});
for (const [display, target] of [
  ['123', '124'],
  ['+1 202 555 0100', '+12025550101'],
  ['123;postd=4', '1234'],
  ['12\n3', '123'],
  ['abc', '123'],
  ['123', 'tel:123'],
  ['1', '1'],
  ['(123', '123'],
  ['123', '+123'],
])
  test(`F059.2 rejects inconsistent/malformed phone ${JSON.stringify(display)}`, () => {
    assert.throws(() => validatePhone(display, target));
  });
test('F059.2 short phone syntax is allowed but does not verify a real contact', () => {
  assert.deepEqual(validatePhone('123', '123'), {
    displayValue: '123',
    phoneTarget: '123',
  });
  assert.doesNotThrow(() => validateResidentSnapshot(phoneFixture()));
});

for (const [name, display, target] of [
  ['20 digits and invalid suffix', '1'.repeat(20) + '!', '123'],
  ['24 digits and invalid suffix', '1'.repeat(24) + '!', '123'],
  ['26 digits and invalid suffix', '1'.repeat(26) + '!', '123'],
  ['maximum-length malformed display', '1'.repeat(31) + '!', '123'],
  ['over-length display', '1'.repeat(32) + '!', '123'],
  ['excessive hyphens', '123--456', '123456'],
  ['excessive dots', '123..456', '123456'],
  ['mixed consecutive separators', '123 -456', '123456'],
  ['repeated spaces', '123  456', '123456'],
  ['leading space', ' 123', '123'],
  ['trailing space', '123 ', '123'],
  ['space after leading plus', '+ 123', '+123'],
  ['trailing separator', '123-', '123'],
  ['empty parentheses', '12()3', '123'],
  ['nested parentheses', '1((23))', '123'],
  ['unclosed parentheses', '1(23', '123'],
  ['unmatched close parenthesis', '12)3', '123'],
  ['separator within parentheses', '1(2 3)', '123'],
  ['non-ASCII digit', '12\u0663', '123'],
  ['tab separator', '12\t3', '123'],
  ['multiple leading plus signs', '++123', '+123'],
  ['display/target mismatch', '+1 (202) 555-0100', '+12025550101'],
] as const) {
  test(`F059.2 linear phone parser rejects ${name}`, () => {
    assert.throws(() => validatePhone(display, target), BadRequestException);
  });
}
for (const [display, target] of [
  ['911', '911'],
  ['+1 (202) 555-0100', '+12025550100'],
  ['(202)555.0100', '2025550100'],
  ['123(456)', '123456'],
  ['+123456789012345', '+123456789012345'],
] as const) {
  test(`F059.2 linear phone parser accepts structural format ${display}`, () => {
    assert.deepEqual(validatePhone(display, target), {
      displayValue: display,
      phoneTarget: target,
    });
  });
}

test('F059.2 near-limit malformed phone corpus completes without pathological backtracking', async () => {
  // Isolate execution so a regressed validator cannot block the test runner's
  // watchdog. Start the generous 10-second bound only after module loading.
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { validatePhone } = require(workerData.modulePath);
    parentPort.once('message', () => {
      let rejected = 0;
      for (const digits of [20, 24, 26, 31]) {
        try { validatePhone('1'.repeat(digits) + '!', '123'); }
        catch { rejected++; }
      }
      parentPort.postMessage({ rejected });
    });
    parentPort.postMessage('ready');
  `,
    {
      eval: true,
      workerData: {
        modulePath:
          require.resolve('../../src/resident-experience/resident-experience.domain.js'),
      },
    },
  );
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (code) => {
        reject(
          new Error(`Phone worker exited before its result: ${String(code)}`),
        );
      });
      worker.on('message', (message: unknown) => {
        if (message === 'ready') {
          watchdog = setTimeout(() => {
            reject(
              new Error(
                'Bounded phone corpus exceeded 10 seconds after module loading',
              ),
            );
          }, 10000);
          worker.postMessage('run');
        } else resolve(message);
      });
    });
    assert.deepEqual(result, { rejected: 4 });
  } finally {
    clearTimeout(watchdog);
    await worker.terminate();
  }
});

for (const [name, mutate] of [
  [
    'phone number',
    (s: ResidentSnapshot) => {
      item(s.contacts).displayValue = '+1 (202) 555-0101';
      item(s.contacts).phoneTarget = '+12025550101';
    },
  ],
  [
    'guidance',
    (s: ResidentSnapshot) => {
      item(s.contacts).guidance = 'Changed guidance';
    },
  ],
  [
    'classification',
    (s: ResidentSnapshot) => {
      item(s.contacts).classification = 'emergency';
    },
  ],
  [
    'disabled action',
    (s: ResidentSnapshot) => {
      item(s.actions, 1).enabled = false;
    },
  ],
  [
    'relabelled action',
    (s: ResidentSnapshot) => {
      item(s.actions, 1).title = 'Renamed';
    },
  ],
  [
    'type switch',
    (s: ResidentSnapshot) => {
      s.actions[1] = {
        ...item(s.actions, 1),
        actionType: 'internal',
        target: '/report',
        contactId: null,
      };
    },
  ],
  [
    'removed contact action',
    (s: ResidentSnapshot) => {
      s.actions = [];
      s.contacts = [];
    },
  ],
  [
    'footer destination',
    (s: ResidentSnapshot) => {
      s.presentation.footer.links = [
        {
          id: 'help',
          label: 'Help',
          actionType: 'external',
          target: 'https://example.org/',
        },
      ];
    },
  ],
] as const)
  test(`F059.2 classifies ${name} from actual snapshots`, () => {
    const before = phoneFixture(),
      after = phoneFixture();
    mutate(after);
    const result = classifyResidentChanges(
      validateResidentSnapshot(before),
      validateResidentSnapshot(after),
    );
    assert.equal(result.consequential, true);
    assert.ok(result.reasons.length);
    assert.ok(result.changedFields.length <= 10);
    assert.ok(!JSON.stringify(result).includes('555'));
    assert.ok(!JSON.stringify(result).includes('Changed guidance'));
  });
test('F059.2 cosmetic-only and no-op diffs are distinct; output contains bounded paths only', () => {
  const before = validateResidentSnapshot(residentFixture()),
    after = residentFixture();
  assert.deepEqual(classifyResidentChanges(before, before), {
    changedFields: [],
    consequential: false,
    reasons: [],
  });
  after.presentation.branding.applicationName = 'Other';
  assert.deepEqual(
    classifyResidentChanges(before, validateResidentSnapshot(after)),
    {
      changedFields: ['presentation.branding'],
      consequential: false,
      reasons: [],
    },
  );
});
test('F059.2 assets and Migration 41 remain unchanged; recognized vocabulary includes the separately registered review authority', () => {
  const root = path.resolve(__dirname, '../../../..');
  for (const asset of Object.values(residentAssets))
    assert.ok(
      existsSync(path.join(root, 'react/public', asset.path)),
      asset.path,
    );
  const names = readdirSync(path.join(root, 'server/migrations'))
    .filter((name) => name.endsWith('.ts'))
    .sort();
  assert.equal(names.indexOf('20261011000000-add-resident-experience.ts'), 40);
  const migration = readFileSync(
    path.join(root, 'server/migrations', item(names, 40)),
    'utf8',
  );
  assert.ok(
    !/insert into (?:permission|role_permission)|alter table organization_branding/i.test(
      migration,
    ),
  );
  assert.deepEqual(
    permissions.filter((key) => key.startsWith('resident_experience.')).sort(),
    [
      'resident_experience.contact.manage',
      'resident_experience.publish',
      'resident_experience.review',
      'resident_experience.write',
    ],
  );
});

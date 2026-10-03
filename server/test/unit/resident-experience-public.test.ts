import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import { projectPublishedResidentExperience } from '../../src/resident-experience/resident-experience.public.dto.js';
import {
  phoneFixture,
  residentFixture,
} from '../helpers/resident-experience.fixture.js';

test('public projection is detached, ordered, enabled-only and contains no contact history', () => {
  const input = phoneFixture();
  input.actions.reverse();
  assert.ok(input.benefits[0]);
  input.benefits[0].enabled = false;
  const dto = projectPublishedResidentExperience(input);
  assert.equal(dto.schemaVersion, 1);
  assert.ok(dto.configuration);
  assert.deepEqual(
    dto.configuration.actions.map((a) => a.id),
    ['report', 'help'],
  );
  assert.deepEqual(dto.configuration.benefits, []);
  const phone = dto.configuration.actions[1];
  assert.ok(phone);
  assert.equal(phone.ctaLabel, 'Call +1 (202) 555-0100');
  assert.equal(phone.target, '+12025550100');
  assert.doesNotMatch(
    JSON.stringify(dto),
    /contactId|contacts|guidance|created_by|organization_id|revision_id|event|actor/,
  );
  input.presentation.metadata.title = 'Changed draft';
  assert.notEqual(
    dto.configuration.presentation.metadata.title,
    'Changed draft',
  );
});
test('all disabled actions remain empty in the public DTO', () => {
  const input = residentFixture();
  input.actions.forEach((a) => {
    a.enabled = false;
  });
  assert.deepEqual(
    projectPublishedResidentExperience(input).configuration?.actions,
    [],
  );
});

test('contact-only CTA uses validated display number without an added prefix', () => {
  const input = phoneFixture();
  const action = input.actions[1];
  const contact = input.contacts[0];
  assert.ok(action && contact);
  action.ctaLabel = '{phone}';
  contact.displayValue = '240-314-8567';
  contact.phoneTarget = '2403148567';
  const phone =
    projectPublishedResidentExperience(input).configuration?.actions[1];
  assert.equal(phone?.ctaLabel, '240-314-8567');
  assert.equal(phone.target, '2403148567');
  contact.phoneTarget = '911';
  assert.throws(() => projectPublishedResidentExperience(input));
});
for (const [name, mutate] of [
  [
    'unknown asset',
    (s: ReturnType<typeof phoneFixture>) => {
      s.presentation.hero.assetKey = 'remote';
    },
  ],
  [
    'role substitution',
    (s: ReturnType<typeof phoneFixture>) => {
      s.presentation.branding.logoKey = 'reqro-scenery';
    },
  ],
  [
    'unknown theme',
    (s: ReturnType<typeof phoneFixture>) => {
      Object.assign(s.presentation.branding, { themeKey: 'red' });
    },
  ],
  [
    'invalid destination',
    (s: ReturnType<typeof phoneFixture>) => {
      assert.ok(s.actions[0]);
      s.actions[0].target = '/admin';
    },
  ],
  [
    'missing contact',
    (s: ReturnType<typeof phoneFixture>) => {
      s.contacts = [];
    },
  ],
  [
    'mismatched phone',
    (s: ReturnType<typeof phoneFixture>) => {
      assert.ok(s.contacts[0]);
      s.contacts[0].phoneTarget = '911';
    },
  ],
  [
    'unknown field',
    (s: ReturnType<typeof phoneFixture>) => {
      Object.assign(s.presentation, { actorId: 'private' });
    },
  ],
] as const)
  test(`public projection rejects ${name}`, () => {
    const snapshot = phoneFixture();
    mutate(snapshot);
    assert.throws(() => projectPublishedResidentExperience(snapshot));
  });
test('public projection rejects missing asset keys', () => {
  const snapshot = phoneFixture();
  Reflect.deleteProperty(snapshot.presentation.hero, 'assetKey');
  assert.throws(() => projectPublishedResidentExperience(snapshot));
});

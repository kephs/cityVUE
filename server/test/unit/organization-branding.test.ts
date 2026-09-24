import 'reflect-metadata';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  brandingInput,
  brandingProjection,
} from '../../src/database/organization-branding.js';
test('F054 branding accepts bounded plain text and only the fixed asset key', () => {
  const input = {
    displayName: 'Example <script> & Organization',
    tagline: 'Community Services',
    logoKey: 'example-organization',
  };
  assert.deepEqual(brandingInput(input), input);
  for (const key of [
    'https://example.com/logo.png',
    'http://tracker.test/pixel',
    '../../secret',
    '%2e%2e%2fsecret',
    'C:\\secret',
    'file:///secret',
    'data:image/svg+xml,test',
    'unknown',
  ])
    assert.throws(() => brandingInput({ ...input, logoKey: key }));
  for (const displayName of ['', ' ', ' x', 'x'.repeat(101), 'x\n'])
    assert.throws(() => brandingInput({ ...input, displayName }));
  assert.throws(() => brandingInput({ ...input, tagline: 'x'.repeat(141) }));
  assert.throws(() => brandingInput({ ...input, displayName: null }));
  assert.throws(() =>
    brandingInput({ ...input, organizationId: 'forged' } as typeof input),
  );
  assert.deepEqual(
    brandingProjection({
      display_name: null,
      tagline: null,
      logo_key: null,
      revision: 4,
    }),
    {
      mode: 'REQRO_DEFAULT',
      displayName: null,
      tagline: null,
      logoKey: null,
      revision: 4,
    },
  );
  assert.equal(
    brandingProjection({
      display_name: 'Example',
      tagline: null,
      logo_key: 'unknown',
      revision: 1,
    }).logoKey,
    null,
  );
});

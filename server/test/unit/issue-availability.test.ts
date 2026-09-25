import assert from 'node:assert/strict';
import test from 'node:test';
import { approvedDestination } from '../../src/catalog/issue-action.domain.js';
import {
  allowsIntake,
  validateHandling,
} from '../../src/catalog/issue-availability.js';
import { normalizeAction } from '../../src/catalog/issue-action.command.js';

test('F056.2B availability and handling are independent of channel', () => {
  for (const availability of [
    'INTERNAL_ONLY',
    'EXTERNAL_ONLY',
    'INTERNAL_AND_EXTERNAL',
  ]) {
    assert.equal(
      allowsIntake(availability, 'internal'),
      availability !== 'EXTERNAL_ONLY',
    );
    assert.equal(
      allowsIntake(availability, 'external'),
      availability !== 'INTERNAL_ONLY',
    );
    validateHandling(availability, 'internal_intake');
    if (availability === 'EXTERNAL_ONLY')
      validateHandling(availability, 'external_redirect');
    else
      assert.throws(() => {
        validateHandling(availability, 'external_redirect');
      });
  }
  assert.equal(allowsIntake('unknown', 'external'), false);
  assert.throws(() => {
    validateHandling('unknown', 'internal_intake');
  });
});
test('F056.2B parsed URL validation rejects local and obfuscated literal addresses', () => {
  for (const host of [
    'localhost',
    'localhost.',
    'a.localhost',
    'printer.local',
    '127.0.0.1',
    '127.1',
    '2130706433',
    '0x7f000001',
    '0177.0.0.1',
    '10.1.2.3',
    '172.16.1.1',
    '192.168.1.1',
    '169.254.1.1',
    '100.64.0.1',
    '0.0.0.0',
    '[::]',
    '[::1]',
    '[fc00::1]',
    '[fe80::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:192.168.1.1]',
  ])
    assert.throws(() => approvedDestination(`https://${host}/`), host);
  for (const url of [
    'http://example.com',
    '//example.com',
    'https://user@example.com',
    'https://example.com:99999',
    'https://example.com\\evil',
    'https://example.com/%0a',
  ])
    assert.throws(() => approvedDestination(url));
});
test('F056.2B preserves static URL components, public literals, ports and ASCII hostname normalization', () => {
  for (const url of [
    'https://example.com:8443/path?static=value#fragment',
    'https://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
  ])
    assert.equal(approvedDestination(url), url);
  assert.equal(
    new URL(approvedDestination('https://bücher.example/')).hostname,
    'xn--bcher-kva.example',
  );
  const prefix = 'https://example.com/';
  assert.equal(
    approvedDestination(prefix + 'a'.repeat(2048 - prefix.length)).length,
    2048,
  );
  assert.throws(() =>
    approvedDestination(prefix + 'a'.repeat(2049 - prefix.length)),
  );
  assert.throws(() => approvedDestination(prefix + 'é'.repeat(400)));
});
test('F056.2B action normalization preserves legacy omitted defaults and validates explicit text', () => {
  const base = {
    actionType: 'external_redirect',
    expectedRevision: 1,
    destination: 'https://example.com',
  };
  assert.equal(normalizeAction(base).redirect_url, 'https://example.com/');
  for (const extra of [
    { message: '' },
    { label: ' ' },
    { message: 'x'.repeat(501) },
    { label: 'x'.repeat(81) },
  ])
    assert.throws(() => normalizeAction({ ...base, ...extra }));
  assert.equal(
    normalizeAction({
      ...base,
      message: ' <script>plain text</script> ',
      label: ' Continue ',
    }).redirect_message,
    '<script>plain text</script>',
  );
  assert.throws(() =>
    normalizeAction({
      actionType: 'internal_intake',
      expectedRevision: 1,
      destination: 'https://example.com',
    }),
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { renderResidentEmail } from '../../src/notifications/notification-renderer.js';
import {
  escapeHtml,
  PLATFORM_TEMPLATE_VERSION,
} from '../../src/notifications/notification-templates.js';
import { residentSafeNotificationView } from '../../src/notifications/resident-safe-notification.js';
import { notificationTemplateKeys } from '../../src/notifications/notification.types.js';

const view = residentSafeNotificationView({
  reference: 'REF-1234',
  issueName: 'Pothole repair',
  rawStatus: 'on_hold',
  submittedAt: new Date('2026-10-01T12:00:00.000Z'),
  updatedAt: new Date('2026-10-02T09:30:00.000Z'),
  organizationDisplayName: 'Example Organization',
  serviceLocation: '100 Example Street',
});

test('every template renders a provider-neutral email with a text part', () => {
  for (const key of notificationTemplateKeys) {
    const message = renderResidentEmail(key, view);

    assert.equal(message.channel, 'email');
    assert.equal(message.templateKey, key);
    assert.equal(message.templateVersion, PLATFORM_TEMPLATE_VERSION);
    assert.ok(message.subject && message.subject.length > 0);
    assert.ok(message.textBody.includes('REF-1234'));
    assert.ok(message.htmlBody);
  }
});

test('subjects carry the reference only, never request detail', () => {
  const subjects = notificationTemplateKeys.map(
    (key) => renderResidentEmail(key, view).subject ?? '',
  );

  assert.deepEqual(subjects, [
    'Request REF-1234 received',
    'Request REF-1234 updated',
    'Request REF-1234 closed',
  ]);
  for (const subject of subjects) {
    for (const detail of [
      'Pothole',
      '100 Example Street',
      'hold',
      'Example Organization',
    ]) {
      assert.equal(
        subject.includes(detail),
        false,
        `subject must not contain ${detail}`,
      );
    }
  }
});

test('internal status never appears in rendered output', () => {
  for (const key of notificationTemplateKeys) {
    const message = renderResidentEmail(key, view);
    const rendered = `${message.subject ?? ''}\n${message.textBody}\n${message.htmlBody ?? ''}`;

    assert.equal(rendered.includes('on_hold'), false);
    assert.equal(rendered.toLowerCase().includes('on hold'), false);
    // The resident-safe label is what they see instead.
    assert.ok(message.textBody.includes('In progress'));
  }
});

test('staff, routing and contact values cannot appear in rendered output', () => {
  // Sentinels are placed on the projection INPUT; the narrow input contract and
  // the resident-safe view give them no path into a rendered message.
  const sentinels = {
    staff: 'SENTINEL_STAFF_NAME',
    department: 'SENTINEL_DEPARTMENT',
    division: 'SENTINEL_DIVISION',
    group: 'SENTINEL_WORK_GROUP',
    note: 'SENTINEL_INTERNAL_NOTE',
    email: 'sentinel.resident@example.invalid',
    phone: '+15555550123',
    credential: 'SENTINEL_TRACKING_CREDENTIAL',
  };
  const contaminated = residentSafeNotificationView({
    reference: 'REF-1234',
    issueName: 'Pothole repair',
    rawStatus: 'closed',
    submittedAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-02T09:30:00.000Z'),
    organizationDisplayName: 'Example Organization',
    ...sentinels,
  });

  for (const key of notificationTemplateKeys) {
    const message = renderResidentEmail(key, contaminated);
    const rendered = `${message.subject ?? ''}\n${message.textBody}\n${message.htmlBody ?? ''}`;

    for (const [field, sentinel] of Object.entries(sentinels)) {
      assert.equal(
        rendered.includes(sentinel),
        false,
        `${key} leaked ${field}`,
      );
    }
  }
});

test('no tracking bearer credential field exists on the rendered message', () => {
  const message = renderResidentEmail('request_closed', view);

  assert.deepEqual(Object.keys(message).sort(), [
    'channel',
    'htmlBody',
    'subject',
    'templateKey',
    'templateVersion',
    'textBody',
  ]);
});

test('links render only from an explicitly trusted URL', () => {
  const withoutLink = renderResidentEmail('request_status_changed', view);
  assert.equal(withoutLink.textBody.includes('http'), false);
  assert.equal(withoutLink.htmlBody?.includes('<a '), false);

  const linked = residentSafeNotificationView({
    reference: 'REF-1234',
    issueName: 'Pothole repair',
    rawStatus: 'open',
    submittedAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-02T09:30:00.000Z'),
    organizationDisplayName: 'Example Organization',
    trustedPortalUrl: 'https://requests.example.gov/track',
  });
  const message = renderResidentEmail('request_status_changed', linked);

  assert.ok(message.textBody.includes('https://requests.example.gov/track'));
  assert.ok(
    message.htmlBody?.includes('href="https://requests.example.gov/track"'),
  );
  // No platform domain is ever substituted for a tenant's own address.
  assert.equal(message.textBody.includes('getreqro.com'), false);
});

test('HTML parts escape interpolated values', () => {
  const hostile = residentSafeNotificationView({
    reference: 'REF-<script>alert(1)</script>',
    issueName: 'Tree "limb" & <b>branch</b>',
    rawStatus: 'open',
    submittedAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-02T09:30:00.000Z'),
    organizationDisplayName: "O'Brien & Sons <City>",
    serviceLocation: '<img src=x onerror=alert(1)>',
  });
  const message = renderResidentEmail('request_submitted', hostile);
  const html = message.htmlBody ?? '';

  // No interpolated value may open a tag. Assert on the set of tag names the
  // output contains rather than on loose substrings: correctly escaped text
  // legitimately still contains words such as "onerror".
  const tags = new Set(
    [...html.matchAll(/<\/?([a-zA-Z][a-zA-Z0-9]*)/g)].map((match) => match[1]),
  );
  assert.deepEqual([...tags].sort(), ['li', 'p', 'ul']);
  assert.equal(html.includes('<script'), false);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('<b>branch</b>'), false);
  // The hostile values survive only in escaped form.
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(
    html.includes('Tree &quot;limb&quot; &amp; &lt;b&gt;branch&lt;/b&gt;'),
  );
  assert.ok(html.includes('O&#39;Brien &amp; Sons &lt;City&gt;'));
  // The text part is not HTML and is never interpreted as markup.
  assert.ok(message.textBody.includes('<script>alert(1)</script>'));
});

test('escapeHtml covers every HTML-significant character', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  // Ampersand is escaped first so entities are not double-encoded wrongly.
  assert.equal(escapeHtml('&lt;'), '&amp;lt;');
});

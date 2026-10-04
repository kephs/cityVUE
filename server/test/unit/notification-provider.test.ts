import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationProviderRegistry } from '../../src/notifications/notification-provider-registry.js';
import {
  isTransientNotificationFailure,
  notificationChannels,
  notificationFailureCategories,
  notificationTemplateKeys,
  providerSupportsChannel,
  type NotificationProvider,
  type NotificationSendResult,
} from '../../src/notifications/notification.types.js';

test('the provider registry is empty and resolves nothing by default', () => {
  const registry = new NotificationProviderRegistry();

  for (const providerId of ['', 'smtp', 'unknown', 'default', 'email']) {
    assert.equal(registry.resolve(providerId), undefined);
  }
});

test('an unresolved provider fails closed rather than substituting a default', () => {
  const registry = new NotificationProviderRegistry();
  const first = registry.resolve('provider-a');
  const second = registry.resolve('provider-b');

  // No implicit fallback, and no shared default instance between lookups.
  assert.equal(first, undefined);
  assert.equal(second, undefined);
});

test('provider capabilities are explicit and never assumed', () => {
  const smtpLike: NotificationProvider = {
    providerId: 'fixture-smtp',
    capabilities: { channels: ['email'], reportsDelivery: false },
    send: async () => deliveryResult,
  };
  const apiLike: NotificationProvider = {
    providerId: 'fixture-api',
    capabilities: { channels: ['email', 'sms'], reportsDelivery: true },
    send: async () => deliveryResult,
  };

  assert.equal(providerSupportsChannel(smtpLike, 'email'), true);
  assert.equal(providerSupportsChannel(smtpLike, 'sms'), false);
  assert.equal(providerSupportsChannel(apiLike, 'sms'), true);
  // A transport that cannot report a final outcome must say so, so callers
  // never imply a delivery no provider confirmed.
  assert.equal(smtpLike.capabilities.reportsDelivery, false);
  assert.equal(apiLike.capabilities.reportsDelivery, true);
});

const deliveryResult: NotificationSendResult = {
  outcome: 'accepted',
  providerMessageId: 'fixture-message',
  failureCategory: null,
  durationMs: 1,
};

test('the failure taxonomy is closed and provider-neutral', () => {
  assert.deepEqual(
    [...notificationFailureCategories],
    [
      'provider_unavailable',
      'provider_timeout',
      'provider_failed',
      'rate_limited',
      'invalid_destination',
      'authentication_failed',
      'provider_unconfigured',
      'template_render_failed',
      'malformed_request',
      'internal_failure',
    ],
  );
  for (const category of notificationFailureCategories) {
    assert.doesNotMatch(
      category,
      /sendgrid|twilio|smtp|azure|ses|mailgun|postmark/i,
      `${category} must not name a vendor`,
    );
  }
});

test('only genuinely retryable categories are transient', () => {
  for (const category of [
    'provider_unavailable',
    'provider_failed',
    'rate_limited',
  ] as const) {
    assert.equal(isTransientNotificationFailure(category), true, category);
  }
  for (const category of [
    'invalid_destination',
    'authentication_failed',
    'provider_unconfigured',
    'template_render_failed',
    'malformed_request',
    'internal_failure',
  ] as const) {
    assert.equal(isTransientNotificationFailure(category), false, category);
  }
});

test('ambiguous provider acceptance is not automatically retryable', () => {
  // ADR-026 routes a timeout after possible submission to operator review
  // rather than resending and risking a duplicate resident notification.
  assert.equal(isTransientNotificationFailure('provider_timeout'), false);
});

test('channels and template keys are bounded; SMS is type-only', () => {
  assert.deepEqual([...notificationChannels], ['email', 'sms']);
  assert.deepEqual(
    [...notificationTemplateKeys],
    ['request_submitted', 'request_status_changed', 'request_closed'],
  );
});

/**
 * ADR-026 Reqro-owned notification contracts. Vendor SDK types, credentials and
 * provider payloads never cross this boundary; an adapter translates in both
 * directions and nothing vendor-specific escapes it.
 *
 * Slice 1 defines contracts only. No provider, transport, persistence,
 * destination resolution or network egress exists.
 */

/** `sms` is reserved by the type model only. No SMS behavior is implemented,
 * and SMS remains separately gated by F002 notification governance. */
export const notificationChannels = ['email', 'sms'] as const;
export type NotificationChannel = (typeof notificationChannels)[number];

/** Platform-owned template identities. Code-based in Slice 1; tenant-editable
 * template persistence is a later reviewed capability. */
export const notificationTemplateKeys = [
  'request_submitted',
  'request_status_changed',
  'request_closed',
] as const;
export type NotificationTemplateKey = (typeof notificationTemplateKeys)[number];

/**
 * Closed, provider-neutral failure taxonomy. Retry policy is a later slice, but
 * the transient/permanent split is fixed here so adapters classify consistently
 * and no adapter invents its own vocabulary.
 */
export const notificationFailureCategories = [
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
] as const;
export type NotificationFailureCategory =
  (typeof notificationFailureCategories)[number];

/** Transient categories may be retried under a later retry policy. Permanent
 * categories must not be: retrying them cannot succeed and only delays the
 * operator signal. `provider_timeout` is deliberately absent — ADR-026 routes
 * ambiguous acceptance to operator review rather than an automatic resend. */
export const transientNotificationFailures: readonly NotificationFailureCategory[] =
  ['provider_unavailable', 'provider_failed', 'rate_limited'] as const;

export function isTransientNotificationFailure(
  category: NotificationFailureCategory,
): boolean {
  return transientNotificationFailures.includes(category);
}

/**
 * A rendered, provider-neutral message. Produced only by the platform renderer
 * from a ResidentSafeNotificationView, so no domain object, staff identity or
 * contact value can reach a provider through it.
 */
export interface RenderedNotification {
  readonly channel: NotificationChannel;
  readonly templateKey: NotificationTemplateKey;
  readonly templateVersion: number;
  /** Null for channels without a subject concept. */
  readonly subject: string | null;
  readonly textBody: string;
  /** Optional alternative part. The text body is always authoritative. */
  readonly htmlBody: string | null;
}

export type NotificationSendOutcome = 'accepted' | 'rejected' | 'failed';

/**
 * Provider-neutral send result. `accepted` means the provider took
 * responsibility for the message; it never asserts delivery. Final delivery is
 * only ever reported by a provider whose `reportsDelivery` capability is true.
 */
export interface NotificationSendResult {
  readonly outcome: NotificationSendOutcome;
  /** Provider-assigned identifier used later to correlate delivery receipts. */
  readonly providerMessageId: string | null;
  readonly failureCategory: NotificationFailureCategory | null;
  readonly durationMs: number;
}

/** Capabilities a provider states explicitly. An adapter is never assumed to
 * support a channel or a receipt it has not declared. */
export interface NotificationProviderCapabilities {
  readonly channels: readonly NotificationChannel[];
  /** False for transports such as plain SMTP that cannot report a final
   * outcome. Consumers must then present "sent" honestly and never imply
   * delivery that no provider confirmed. */
  readonly reportsDelivery: boolean;
}

/**
 * Opaque, already-resolved destination handed to an adapter at send time.
 * Slice 1 defines the shape only: no destination is resolved, validated,
 * stored or sent, and no requester contact is read.
 */
export interface NotificationDestination {
  readonly channel: NotificationChannel;
  readonly value: string;
}

/** Non-identifying context for correlation and diagnostics. Carries no
 * recipient value, no rendered content and no organization-identifying text. */
export interface NotificationSendContext {
  readonly notificationId: string;
  readonly correlationId: string;
  readonly signal: AbortSignal;
}

export interface NotificationProvider {
  readonly providerId: string;
  readonly capabilities: NotificationProviderCapabilities;
  send(
    message: RenderedNotification,
    destination: NotificationDestination,
    context: NotificationSendContext,
  ): Promise<NotificationSendResult>;
}

export function providerSupportsChannel(
  provider: NotificationProvider,
  channel: NotificationChannel,
): boolean {
  return provider.capabilities.channels.includes(channel);
}

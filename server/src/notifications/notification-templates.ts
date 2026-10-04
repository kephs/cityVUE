import type { ResidentSafeNotificationView } from './resident-safe-notification.js';
import type { NotificationTemplateKey } from './notification.types.js';

/**
 * ADR-026 platform-owned templates, deliberately expressed as code.
 *
 * There is no template language: no eval, expressions, loops, includes,
 * filters or tenant-authored markup. Each template is an ordinary function of
 * a ResidentSafeNotificationView, so the complete set of values a resident
 * notification can contain is visible by reading this file.
 *
 * Subjects carry the reference only. Issue names, locations, descriptions and
 * any other request detail stay out of the subject line, which is the part most
 * exposed in notification previews, mail-server logs and provider dashboards.
 */

/** Bumped when rendered output changes meaningfully. A future outbox pins this
 * at enqueue so a retry renders what the resident was originally promised. */
export const PLATFORM_TEMPLATE_VERSION = 1;

const residentStatusLabels = {
  open: 'Open',
  in_progress: 'In progress',
  closed: 'Closed',
  cancelled: 'Cancelled',
  unavailable: 'Unavailable',
} as const;

export function residentStatusLabel(
  status: ResidentSafeNotificationView['status'],
): string {
  return residentStatusLabels[status];
}

/** Escapes the five HTML-significant characters. Every interpolated value in an
 * HTML part passes through this, and values are only ever placed in text
 * positions — never into an attribute, URL or script position. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface PlatformTemplate {
  readonly key: NotificationTemplateKey;
  readonly subject: (view: ResidentSafeNotificationView) => string;
  readonly textBody: (view: ResidentSafeNotificationView) => string;
  readonly htmlBody: (view: ResidentSafeNotificationView) => string;
}

function lines(parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join('\n');
}

function detailLines(view: ResidentSafeNotificationView): string[] {
  return [
    `Reference: ${view.reference}`,
    `Service: ${view.issueName}`,
    `Status: ${residentStatusLabel(view.status)}`,
    ...(view.serviceLocation === null
      ? []
      : [`Location: ${view.serviceLocation}`]),
  ];
}

function linkLine(view: ResidentSafeNotificationView): string | null {
  // Rendered only from an already-trusted URL the caller supplied. Slice 1
  // resolves no tenant domain, so messages render without a link by default.
  return view.portalUrl === null
    ? null
    : `View your request: ${view.portalUrl}`;
}

function textMessage(
  view: ResidentSafeNotificationView,
  opening: string,
  closing: string,
): string {
  return lines([
    opening,
    '',
    ...detailLines(view),
    '',
    linkLine(view),
    linkLine(view) === null ? null : '',
    closing,
    `— ${view.organizationDisplayName}`,
  ]);
}

function htmlMessage(
  view: ResidentSafeNotificationView,
  opening: string,
  closing: string,
): string {
  const rows = detailLines(view)
    .map((line) => `    <li>${escapeHtml(line)}</li>`)
    .join('\n');
  const link =
    view.portalUrl === null
      ? ''
      : `  <p><a href="${escapeHtml(view.portalUrl)}">View your request</a></p>\n`;
  return (
    `<p>${escapeHtml(opening)}</p>\n` +
    `  <ul>\n${rows}\n  </ul>\n` +
    link +
    `  <p>${escapeHtml(closing)}</p>\n` +
    `  <p>&mdash; ${escapeHtml(view.organizationDisplayName)}</p>`
  );
}

const templates: Record<NotificationTemplateKey, PlatformTemplate> = {
  request_submitted: {
    key: 'request_submitted',
    subject: (view) => `Request ${view.reference} received`,
    textBody: (view) =>
      textMessage(
        view,
        'We received your request.',
        'We will contact you if we need more information.',
      ),
    htmlBody: (view) =>
      htmlMessage(
        view,
        'We received your request.',
        'We will contact you if we need more information.',
      ),
  },
  request_status_changed: {
    key: 'request_status_changed',
    subject: (view) => `Request ${view.reference} updated`,
    textBody: (view) =>
      textMessage(
        view,
        'There is an update on your request.',
        'No action is needed from you right now.',
      ),
    htmlBody: (view) =>
      htmlMessage(
        view,
        'There is an update on your request.',
        'No action is needed from you right now.',
      ),
  },
  request_closed: {
    key: 'request_closed',
    subject: (view) => `Request ${view.reference} closed`,
    textBody: (view) =>
      textMessage(
        view,
        'Your request has been closed.',
        'If this issue continues, please submit a new request.',
      ),
    htmlBody: (view) =>
      htmlMessage(
        view,
        'Your request has been closed.',
        'If this issue continues, please submit a new request.',
      ),
  },
};

export function platformTemplate(
  key: NotificationTemplateKey,
): PlatformTemplate {
  return templates[key];
}

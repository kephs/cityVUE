import {
  PLATFORM_TEMPLATE_VERSION,
  platformTemplate,
} from './notification-templates.js';
import type { ResidentSafeNotificationView } from './resident-safe-notification.js';
import type {
  NotificationTemplateKey,
  RenderedNotification,
} from './notification.types.js';

/**
 * ADR-026 pure renderer. Its only inputs are a platform template key and a
 * ResidentSafeNotificationView, so nothing it emits can originate from a
 * domain object, staff identity, internal note or contact record.
 *
 * Email is the only implemented channel. SMS remains separately gated, so no
 * SMS rendering exists even though the channel type is reserved.
 */
export function renderResidentEmail(
  templateKey: NotificationTemplateKey,
  view: ResidentSafeNotificationView,
): RenderedNotification {
  const template = platformTemplate(templateKey);
  return {
    channel: 'email',
    templateKey,
    templateVersion: PLATFORM_TEMPLATE_VERSION,
    subject: template.subject(view),
    textBody: template.textBody(view),
    htmlBody: template.htmlBody(view),
  };
}

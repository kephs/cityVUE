import { Module } from '@nestjs/common';
import { NotificationProviderRegistry } from './notification-provider-registry.js';

/**
 * ADR-026 Slice 1 boundary module. Contracts, the resident-safe projection,
 * platform templates and the renderer are pure functions; only the empty
 * provider registry needs injection.
 *
 * No controller, route, repository, persistence, worker, scheduler, provider
 * or outbound transport is registered, so nothing here can send anything.
 */
@Module({
  providers: [NotificationProviderRegistry],
  exports: [NotificationProviderRegistry],
})
export class NotificationsModule {}

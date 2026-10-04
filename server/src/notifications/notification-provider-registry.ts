import { Injectable } from '@nestjs/common';
import type { NotificationProvider } from './notification.types.js';

/**
 * ADR-026 provider-neutral resolution, mirroring AiProviderRegistry.
 *
 * Intentionally empty. There is no default provider, no environment credential
 * resolution, no implicit fallback and no network call. An unresolved provider
 * must fail closed at the call site rather than degrade to some other adapter,
 * so resolution returns undefined instead of throwing or substituting.
 *
 * Tests override resolution with a test-folder fixture.
 */
@Injectable()
export class NotificationProviderRegistry {
  resolve(_providerId: string): NotificationProvider | undefined {
    void _providerId;
    return undefined;
  }
}

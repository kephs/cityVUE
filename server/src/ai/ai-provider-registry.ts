import { Injectable } from '@nestjs/common';
import type { AiProvider } from './ai.types.js';
/** Intentionally empty. Tests override resolution with a test-folder fixture. */
@Injectable()
export class AiProviderRegistry {
  resolve(_providerId: string): AiProvider | undefined {
    void _providerId;
    return undefined;
  }
}

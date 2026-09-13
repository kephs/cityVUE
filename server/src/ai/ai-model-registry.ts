import { Injectable } from '@nestjs/common';
import type { AiModelDescriptor } from './ai.types.js';

@Injectable()
export class AiModelRegistry {
  /** No approved providers/models in F020. No database or credential store. */
  list(): AiModelDescriptor[] {
    return [];
  }
}

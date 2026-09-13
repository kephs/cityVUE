import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AiPolicyService } from './ai-policy.service.js';
import type {
  AiGenerationRequest,
  AiGenerationResponse,
  AiRequestContext,
} from './ai.types.js';

@Injectable()
export class AiRouterService {
  constructor(private readonly policy: AiPolicyService) {}

  generate(
    request: AiGenerationRequest,
    context: AiRequestContext,
  ): Promise<AiGenerationResponse> {
    this.policy.authorizeGeneration(request, context.staff);
    // No adapter dispatch exists in F020. A future adapter must follow policy evaluation.
    throw new ServiceUnavailableException();
  }
}

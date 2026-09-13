import { AiProviderRegistry } from './ai-provider-registry.js';
import { AiQuotaService, AiQuotaPolicyRegistry } from './ai-quota.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiModelRegistry } from './ai-model-registry.js';
import { AiPolicyService } from './ai-policy.service.js';
import { AiRouterService } from './ai-router.service.js';

@Module({
  controllers: [AiController],
  providers: [
    AiModelRegistry,
    AiPolicyService,
    AiRouterService,
    AiProviderRegistry,
    AiQuotaService,
    AiQuotaPolicyRegistry,
    AiUsageService,
  ],
})
export class AiModule {}

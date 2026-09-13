import { Module } from '@nestjs/common';
import { AiController } from './ai.controller.js';
import { AiModelRegistry } from './ai-model-registry.js';
import { AiPolicyService } from './ai-policy.service.js';
import { AiRouterService } from './ai-router.service.js';

@Module({
  controllers: [AiController],
  providers: [AiModelRegistry, AiPolicyService, AiRouterService],
})
export class AiModule {}

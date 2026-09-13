import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isUUID } from 'class-validator';
import { performance } from 'node:perf_hooks';
import type { AppConfiguration } from '../config/configuration.js';
import { AiPolicyService } from './ai-policy.service.js';
import { AiModelRegistry } from './ai-model-registry.js';
import { AiProviderRegistry } from './ai-provider-registry.js';
import { AiQuotaService } from './ai-quota.service.js';
import { AiUsageService } from './ai-usage.service.js';
import { aiFailure, failureCategory } from './ai-failure.js';
import { validateAiRequest } from './ai-request.dto.js';
import type { AiGenerationResponse, AiRequestContext } from './ai.types.js';
import type { AiUsageMetadata } from './ai-governance.types.js';

export function normalizeAiResponse(
  raw: unknown,
  requestId: string,
  modelId: string,
  providerId: string,
  durationMs: number,
): AiGenerationResponse {
  if (!raw || typeof raw !== 'object') throw aiFailure('invalid_response');
  const value = raw as Partial<AiGenerationResponse>;
  if (
    value.requestId !== requestId ||
    value.modelId !== modelId ||
    value.providerId !== providerId ||
    typeof value.content !== 'string' ||
    value.content.length > 64000 ||
    (value.status !== 'completed' &&
      value.status !== 'limited' &&
      value.status !== 'blocked') ||
    (value.finishReason !== 'stop' &&
      value.finishReason !== 'length' &&
      value.finishReason !== 'policy') ||
    !value.usage
  )
    throw aiFailure('invalid_response');
  const { inputTokens, outputTokens, totalTokens } = value.usage;
  if (
    [inputTokens, outputTokens, totalTokens].some(
      (n) =>
        n !== null && (!Number.isSafeInteger(n) || n < 0 || n > 2147483647),
    ) ||
    (totalTokens !== null &&
      inputTokens !== null &&
      outputTokens !== null &&
      totalTokens !== inputTokens + outputTokens)
  )
    throw aiFailure('invalid_response');
  return {
    requestId,
    modelId,
    providerId,
    content: value.content,
    status: value.status,
    finishReason: value.finishReason,
    timestamp: new Date().toISOString(),
    durationMs,
    usage: { inputTokens, outputTokens, totalTokens },
  };
}
@Injectable()
export class AiRouterService {
  constructor(
    private readonly policy: AiPolicyService,
    private readonly models: AiModelRegistry,
    private readonly providers: AiProviderRegistry,
    private readonly quotas: AiQuotaService,
    private readonly usage: AiUsageService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {}
  async generate(
    input: unknown,
    context: AiRequestContext,
  ): Promise<AiGenerationResponse> {
    // Never persist an untrusted/public identity. Future HTTP callers must supply middleware's ID + CurrentStaff.
    this.policy.assertWorkspaceAccess(context.staff);
    if (
      !isUUID(context.requestId) ||
      !isUUID(context.staff.organizationId) ||
      !isUUID(context.staff.staffIdentityId)
    )
      throw aiFailure('malformed_request');
    const started = performance.now();
    const metadata: AiUsageMetadata = {
      requestId: context.requestId,
      organizationId: context.staff.organizationId,
      staffIdentityId: context.staff.staffIdentityId,
      modelId: null,
      providerId: null,
      quotaPolicyId: null,
    };
    let usageId: string | undefined;
    try {
      let validated;
      try {
        validated = validateAiRequest(input);
      } catch {
        throw aiFailure('malformed_request');
      }
      // Unknown client model strings are never written to metadata storage.
      const known = this.models
        .list()
        .find((model) => model.id === validated.selection.modelId);
      metadata.modelId = known?.id ?? null;
      metadata.providerId = known?.providerId ?? null;
      const model = this.policy.authorizeGeneration(validated, context.staff);
      const quota = this.quotas.policy(model.governance?.quotaPolicyId);
      metadata.quotaPolicyId = quota.id;
      // F021 has no live dispatch, even if trusted server code registers a live adapter.
      if (
        !['test', 'development'].includes(
          this.config.get('app.environment', { infer: true }),
        ) ||
        !this.config.get('ai.testExecutionEnabled', false, { infer: true })
      )
        throw aiFailure('execution_disabled');
      usageId = await this.usage.begin(metadata, quota);
      const provider = this.providers.resolve(model.providerId);
      if (
        provider?.kind !== 'test' ||
        provider.providerId !== model.providerId ||
        provider.availability !== 'available' ||
        !provider.modelIds.includes(model.id)
      )
        throw aiFailure('provider_unavailable');
      const abort = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let raw: unknown;
      try {
        raw = await Promise.race([
          Promise.resolve().then(() =>
            provider.generate(validated, {
              requestId: context.requestId,
              signal: abort.signal,
            }),
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              abort.abort();
              reject(aiFailure('provider_timeout'));
            }, 5000);
          }),
        ]);
      } catch {
        // Never trust error names/messages/codes (including forged policy errors) from providers.
        throw aiFailure(
          abort.signal.aborted ? 'provider_timeout' : 'provider_failed',
        );
      } finally {
        clearTimeout(timer);
      }
      const durationMs = Math.min(
        2147483647,
        Math.max(0, Math.round(performance.now() - started)),
      );
      const response = normalizeAiResponse(
        raw,
        context.requestId,
        model.id,
        provider.providerId,
        durationMs,
      );
      await this.usage.finish(usageId, metadata.organizationId, {
        outcome: response.status,
        failureCategory: null,
        ...response.usage,
        durationMs,
      });
      return response;
    } catch (error) {
      const category = failureCategory(error);
      try {
        if (usageId)
          await this.usage.finish(usageId, metadata.organizationId, {
            outcome: 'failed',
            failureCategory: category,
            inputTokens: null,
            outputTokens: null,
            totalTokens: null,
            durationMs: Math.min(
              2147483647,
              Math.max(0, Math.round(performance.now() - started)),
            ),
          });
        else await this.usage.begin(metadata, null, category);
      } catch {
        throw new ServiceUnavailableException();
      }
      throw aiFailure(category);
    }
  }
}

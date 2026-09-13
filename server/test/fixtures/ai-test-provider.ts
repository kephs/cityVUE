import type {
  AiProvider,
  AiGenerationResponse,
  AiGenerationRequest,
} from '../../src/ai/ai.types.js';
/** Not compiled into the production build. No network, credentials, or echo of input. */
export class TestAiProvider implements AiProvider {
  readonly providerId = 'test-only';
  readonly kind = 'test' as const;
  readonly modelIds = ['test-model'];
  readonly availability = 'available' as const;
  async generate(
    _request: AiGenerationRequest,
    context: { requestId: string; signal: AbortSignal },
  ): Promise<AiGenerationResponse> {
    if (context.signal.aborted) throw new Error('aborted');
    return {
      requestId: context.requestId,
      modelId: 'test-model',
      providerId: this.providerId,
      content: 'Deterministic test response. Not AI inference.',
      status: 'completed',
      finishReason: 'stop',
      timestamp: '2000-01-01T00:00:00.000Z',
      durationMs: 0,
      usage: { inputTokens: null, outputTokens: null, totalTokens: null },
    };
  }
}

export function testAiProvider(): AiProvider {
  const provider = new TestAiProvider();
  return {
    providerId: provider.providerId,
    kind: provider.kind,
    modelIds: provider.modelIds,
    availability: provider.availability,
    generate: provider.generate.bind(provider),
  };
}

import type { AiModelGovernance } from './ai-governance.types.js';
import type { StaffAccess } from '../auth/auth.types.js';

/** CityVUE-owned contracts. Adapter credentials and vendor payloads stay private. */
export interface AiModelDescriptor {
  governance?: AiModelGovernance;
  id: string;
  displayName: string;
  providerId: string;
  description: string;
  enabled: boolean;
  availability: 'unavailable' | 'available';
  capabilities: ('text-generation' | 'document-analysis' | 'code-assistance')[];
  /** An approved City policy reference, or null until governance approves one. */
  classificationPolicyId: string | null;
}

export interface AiGenerationRequest {
  selection: { kind: 'explicit'; modelId: string };
  messages: { author: 'employee' | 'assistant'; text: string }[];
}

export interface AiRequestContext {
  requestId: string;
  staff: StaffAccess;
}

export interface AiGenerationResponse {
  requestId: string;
  modelId: string;
  providerId: string;
  content: string;
  status: 'completed' | 'limited' | 'blocked';
  finishReason: 'stop' | 'length' | 'policy';
  timestamp: string;
  durationMs: number;
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
}

export interface AiProvider {
  readonly providerId: string;
  readonly kind: 'test' | 'live';
  readonly modelIds: readonly string[];
  readonly availability: 'available' | 'unavailable' | 'degraded';
  generate(
    request: AiGenerationRequest,
    context: Pick<AiRequestContext, 'requestId'> & { signal: AbortSignal },
  ): Promise<AiGenerationResponse>;
}

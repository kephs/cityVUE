import type { StaffAccess } from '../auth/auth.types.js';

/** CityVUE-owned contracts. Adapter credentials and vendor payloads stay private. */
export interface AiModelDescriptor {
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
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface AiProvider {
  readonly providerId: string;
  generate(
    request: AiGenerationRequest,
    context: AiRequestContext,
  ): Promise<AiGenerationResponse>;
}

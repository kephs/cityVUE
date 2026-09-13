import type { Permission } from '../auth/auth.types.js';
export type AiFailureCategory =
  | 'internal_failure'
  | 'malformed_request'
  | 'ai_disabled'
  | 'permission_denied'
  | 'unknown_model'
  | 'model_disabled'
  | 'model_policy_denied'
  | 'quota_unconfigured'
  | 'quota_exceeded'
  | 'provider_unavailable'
  | 'provider_timeout'
  | 'provider_failed'
  | 'invalid_response'
  | 'execution_disabled';
export interface AiModelGovernance {
  staffOnly: boolean;
  requiredPermissions: Permission[];
  classificationPolicyId: string;
  quotaPolicyId: string;
}
export type AiQuotaScope =
  'user' | 'role' | 'department' | 'organization' | 'model' | 'provider';
export interface AiQuotaRule {
  scope: AiQuotaScope;
  period: 'daily' | 'monthly';
  requestLimit: number;
}
export interface AiQuotaPolicy {
  id: string;
  rules: AiQuotaRule[];
}
export interface AiUsageMetadata {
  requestId: string;
  organizationId: string;
  staffIdentityId: string;
  modelId: string | null;
  providerId: string | null;
  quotaPolicyId: string | null;
}
export interface AiUsageResult {
  outcome: 'completed' | 'limited' | 'blocked' | 'failed' | 'denied';
  failureCategory: AiFailureCategory | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  durationMs: number;
}

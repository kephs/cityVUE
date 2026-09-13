import { Injectable } from '@nestjs/common';
import type { AiQuotaPolicy, AiQuotaRule } from './ai-governance.types.js';
import { aiFailure } from './ai-failure.js';
@Injectable()
export class AiQuotaPolicyRegistry {
  get(_id: string): AiQuotaPolicy | undefined {
    void _id;
    return undefined;
  }
}
@Injectable()
export class AiQuotaService {
  constructor(private readonly policies: AiQuotaPolicyRegistry) {}
  policy(id: string | undefined): AiQuotaPolicy {
    const policy = id ? this.policies.get(id) : undefined;
    if (
      !policy ||
      policy.id !== id ||
      !policy.rules.length ||
      policy.rules.some(
        (rule) =>
          !['user', 'organization', 'model', 'provider'].includes(rule.scope) ||
          !['daily', 'monthly'].includes(rule.period) ||
          !Number.isSafeInteger(rule.requestLimit) ||
          rule.requestLimit < 0,
      )
    )
      throw aiFailure('quota_unconfigured');
    return policy;
  }
  assertCapacity(rule: AiQuotaRule, used: number): void {
    if (!Number.isSafeInteger(used) || used < 0 || used >= rule.requestLimit)
      throw aiFailure('quota_exceeded');
  }
  windowStart(rule: AiQuotaRule, now: Date): Date {
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        rule.period === 'monthly' ? 1 : now.getUTCDate(),
      ),
    );
  }
}

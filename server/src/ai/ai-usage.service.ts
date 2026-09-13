import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { sql } from 'kysely';
import { DatabaseService } from '../database/database.service.js';
import { AiQuotaService } from './ai-quota.service.js';
import type {
  AiQuotaPolicy,
  AiUsageMetadata,
  AiUsageResult,
  AiFailureCategory,
} from './ai-governance.types.js';
@Injectable()
export class AiUsageService {
  constructor(
    private readonly database: DatabaseService,
    private readonly quotas: AiQuotaService,
  ) {}
  async begin(
    metadata: AiUsageMetadata,
    policy: AiQuotaPolicy | null,
    denied: AiFailureCategory | null = null,
  ): Promise<string> {
    return this.database.client.transaction().execute(async (tx) => {
      // Serialize admission across all processes for this Organization, including overlapping quotas.
      await sql`select pg_advisory_xact_lock(hashtextextended(${metadata.organizationId}, 21))`.execute(
        tx,
      );
      const clock = await sql<{
        now: Date;
      }>`select clock_timestamp() as now`.execute(tx);
      const now = clock.rows[0]?.now;
      if (!now) throw new ServiceUnavailableException();
      if (!denied) {
        if (!policy) throw new ServiceUnavailableException();
        for (const rule of policy.rules) {
          let query = tx
            .selectFrom('ai_usage')
            .select(({ fn }) => fn.countAll<string>().as('used'))
            .where('organization_id', '=', metadata.organizationId)
            .where('policy_decision', '=', 'accepted')
            .where('created_at', '>=', this.quotas.windowStart(rule, now));
          if (rule.scope === 'user')
            query = query.where(
              'staff_identity_id',
              '=',
              metadata.staffIdentityId,
            );
          if (rule.scope === 'model')
            query = query.where('model_id', '=', metadata.modelId);
          if (rule.scope === 'provider')
            query = query.where('provider_id', '=', metadata.providerId);
          this.quotas.assertCapacity(
            rule,
            Number((await query.executeTakeFirstOrThrow()).used),
          );
        }
      }
      const record = await tx
        .insertInto('ai_usage')
        .values({
          created_at: now,
          request_id: metadata.requestId,
          organization_id: metadata.organizationId,
          staff_identity_id: metadata.staffIdentityId,
          model_id: metadata.modelId,
          provider_id: metadata.providerId,
          quota_policy_id: metadata.quotaPolicyId,
          policy_decision: denied ? 'denied' : 'accepted',
          outcome: denied ? 'denied' : 'pending',
          completed_at: denied ? now : null,
          failure_category: denied,
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
          duration_ms: denied ? 0 : null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('ai_audit_event')
        .values({
          organization_id: metadata.organizationId,
          usage_id: record.id,
          event: denied ? 'denied' : 'accepted',
        })
        .execute();
      return record.id;
    });
  }
  async finish(
    id: string,
    organizationId: string,
    result: AiUsageResult,
  ): Promise<void> {
    await this.database.client.transaction().execute(async (tx) => {
      const updated = await tx
        .updateTable('ai_usage')
        .set({
          outcome: result.outcome,
          failure_category: result.failureCategory,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          total_tokens: result.totalTokens,
          duration_ms: result.durationMs,
          completed_at: new Date(),
        })
        .where('id', '=', id)
        .where('organization_id', '=', organizationId)
        .where('outcome', '=', 'pending')
        .executeTakeFirst();
      if (updated.numUpdatedRows !== 1n)
        throw new ServiceUnavailableException();
      await tx
        .insertInto('ai_audit_event')
        .values({
          organization_id: organizationId,
          usage_id: id,
          event: result.outcome === 'failed' ? 'failed' : 'completed',
        })
        .execute();
    });
  }
}

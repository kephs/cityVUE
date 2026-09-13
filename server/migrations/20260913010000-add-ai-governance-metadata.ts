import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table ai_usage (
      id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
      organization_id uuid not null, staff_identity_id uuid not null,
      model_id varchar(64), provider_id varchar(64), quota_policy_id varchar(64),
      created_at timestamptz not null default now(), completed_at timestamptz,
      policy_decision varchar(16) not null check (policy_decision in ('accepted','denied')),
      outcome varchar(16) not null check (outcome in ('pending','completed','limited','blocked','failed','denied')),
      failure_category varchar(32) check (failure_category in ('internal_failure','malformed_request','ai_disabled','permission_denied','unknown_model','model_disabled','model_policy_denied','quota_unconfigured','quota_exceeded','provider_unavailable','provider_timeout','provider_failed','invalid_response','execution_disabled')),
      input_tokens integer check(input_tokens >= 0), output_tokens integer check(output_tokens >= 0), total_tokens integer check(total_tokens >= 0),
      duration_ms integer check(duration_ms >= 0),
      unique (organization_id,id),
      foreign key (organization_id,staff_identity_id) references staff_identity(organization_id,id),
      check ((outcome = 'pending') = (completed_at is null)),
      check ((policy_decision = 'denied') = (outcome = 'denied')),
      check (total_tokens is null or input_tokens is null or output_tokens is null or total_tokens = input_tokens::bigint + output_tokens::bigint)
    );
    create index ai_usage_scope_time on ai_usage(organization_id,created_at);
    create index ai_usage_staff_time on ai_usage(organization_id,staff_identity_id,created_at);
    create index ai_usage_model_time on ai_usage(organization_id,model_id,created_at);
    create table ai_audit_event (
      id uuid primary key default gen_random_uuid(), organization_id uuid not null, usage_id uuid not null,
      event varchar(16) not null check(event in ('accepted','denied','completed','failed')),
      created_at timestamptz not null default now(),
      foreign key (organization_id,usage_id) references ai_usage(organization_id,id),
      unique (usage_id,event)
    );
    create index ai_audit_scope_time on ai_audit_event(organization_id,created_at);
  `.execute(db);
}
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  // No cascade: only these F021 tables; rollback intentionally removes their test metadata.
  await sql`drop table ai_audit_event; drop table ai_usage;`.execute(db);
}

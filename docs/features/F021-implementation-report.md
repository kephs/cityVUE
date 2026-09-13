# F021 — AI Usage Governance, Audit & Provider Contract Foundation

**Date:** 2026-09-13. **Baseline:** main `8d5c0408e748a7119f918dba0d87029a6abf2365`, initially clean. **Scope:** Local/internal governance foundation only. No live provider, deployment, tenant changes, or F022 implementation.

## Objective and architecture

Extend F020, not replace its abstractions. React remains unchanged and inert. Existing `GET /api/v1/ai/status` and `/models` retain Entra/RBAC and safe metadata projection. There is no shipped chat, generation, usage-read, audit-read, quota-management or test-harness endpoint. The AI module registers internal services with empty server-owned model/provider/quota registries.

The router's internal lifecycle is:

1. Require existing server-resolved Entra StaffAccess and workspace permission; validate server correlation and identity UUIDs.
2. Strictly validate the portable request and discard no unknown fields silently.
3. Resolve the model in the server registry, then enforce global AI availability, enabled/available model, text capability, staff-only governance, classification reference and required permissions.
4. Resolve a configured quota policy; missing/unsupported policy fails closed.
5. Require non-production environment and explicit `AI_TEST_EXECUTION_ENABLED=true`.
6. Atomically evaluate quotas and persist pending usage plus accepted audit event before provider execution.
7. Resolve a matching, available **test** provider with declared model support. A live-kind adapter is rejected even if injected.
8. Invoke with a five-second timeout and AbortSignal, normalize/validate the response, and atomically record outcome/usage plus terminal audit metadata before returning it.
9. On failure, record a classified denial or execution failure when trusted identity/storage are available. Storage failure returns a sanitized 503 and prevents execution/output release.

See [ADR-002](../decisions/ADR-002-ai-governance-metadata.md). No AI provider receives database access; metadata persistence is performed by CityVUE's own service only.

## Request and response contracts

Preserve the existing neutral request shape: `selection: { kind: 'explicit', modelId }` and `messages: [{ author, text }]`. `employee` and `assistant` are the only roles; no client system/tool messages. Selection IDs use a bounded portable slug; one to 32 messages, each one to 16,000 characters with non-whitespace text. These are parser/resource bounds, not production usage quotas. Nested DTO validation rejects unknown fields, credentials, endpoints, provider IDs, caller identity/correlation fields, and unsupported execution settings. The router revalidates even when no HTTP pipe is involved.

`AiRequestContext` carries server-owned correlation UUID and resolved StaffAccess separately. Conversations, arbitrary request metadata, generation tuning and system instructions are intentionally absent until required/approved; clients cannot invent authority through these fields.

`AiGenerationResponse` contains correlation/model/provider IDs, content, completed/limited/blocked status, stop/length/policy finish reason, server timestamp/duration, and nullable input/output/total token counts. IDs must match the invocation. Counts must be nonnegative bounded integers or null; available totals must agree. Output is bounded to 64,000 characters. Explicit projection discards raw provider fields, credentials and vendor payloads. Provider timestamps/durations do not override server timing. Null counts mean unavailable, never estimated zero.

## Provider interface and mock

`AiProvider` declares server-owned ID, test/live kind, model IDs, availability (available/unavailable/degraded), and normalized generation with a request ID and AbortSignal. It receives no StaffAccess/claims or database handle. Resolution is through `AiProviderRegistry`, which returns no provider in application code.

`TestAiProvider` is compiled only from `server/test/fixtures`; it returns fixed text, fixed portable status and null usage without echoing prompts or making network calls. Tests override registries explicitly. The HTTP harness controller is also test-only and excluded from `AiModule` and production compilation. The application returns 404 for chat/generate/test-harness routes.

`AI_TEST_EXECUTION_ENABLED` defaults false. Startup rejects true in production or with AI globally disabled; the router independently checks environment and flag. `AI_CHAT_ENABLED` remains hard-false. Setting a flag alone cannot create a model, policy, provider, or endpoint. No provider SDK, key or dependency was added.

## Quota foundation

`AiQuotaPolicyRegistry` has no default policies. `AiQuotaService` validates policies and boundaries. Policies currently support request-count limits per user, organization, model or provider within an organization, over UTC daily/monthly windows. All rules must pass. Zero explicitly means deny all; test values are synthetic and are not City policy. Missing policy, invalid values and unsupported scopes deny execution.

Role and department dimensions are reserved in the contract but rejected until authoritative membership aggregation and approved policy exist. Token/cost limits, billing, configurable business-timezone quota windows and administration are deferred.

`AiUsageService.begin` uses a transaction-scoped PostgreSQL advisory lock per organization, obtains the database clock after waiting for the lock, counts accepted attempts in each window, then inserts usage/audit together. Pending/failed accepted requests consume capacity conservatively; denied requests do not. Counts include prior accepted attempts across policy changes, avoiding reset-by-renaming. UUID uniqueness prevents duplicate invocation under the same request ID. This is not a response replay/cache API; duplicate attempts fail closed. No counter or policy table is needed yet.

## Usage, audit and migration

Additive migration `20260913010000-add-ai-governance-metadata.ts` adds only:

- `ai_usage`: generated ID, unique server request UUID, organization/staff FK, known model/provider/quota IDs, creation/completion timestamps, accepted/denied policy decision, pending/completed/limited/blocked/failed/denied outcome, fixed failure category, nullable token counts and duration.
- `ai_audit_event`: generated ID, organization, linked usage ID, accepted/denied/completed/failed event, timestamp. Specific denial/failure category and request correlation are obtained by joining usage. Organization/time and usage query indexes support scoped review and quota counts.

Composite staff/usage FKs prevent cross-organization links. Completion updates require the correct organization and pending state, and write the terminal audit event in the same transaction. Table constraints reject negative/inconsistent token counts and invalid lifecycle values. Services explicitly project columns; no free-form JSON, prompt, response, claims, credentials or exception text columns exist.

Existing sanitized Pino HTTP logs remain the operational logging system. Audit persistence complements those logs with typed governance events, without expanding their sensitive-data allowlist. Anonymous/invalid identity and HTTP DTO failures occur before trusted usage admission and are represented by existing sanitized HTTP logs, not invented staff rows. Authorized internal denials have usage/audit records. Recording outages are fail-closed; a crash or uncertain write can leave pending metadata requiring future reconciliation. No content is persisted for replay.

Rollback drops only the two F021 tables (audit first), without cascade or changes to resident data/permissions. It removes their metadata, so rollback on a future real audit dataset would need an approved retention/backup procedure. No grants, roles, staff assignments or default policies are seeded.

## Privacy/security decisions

RBAC is enforced server-side and the router rechecks admission. Model/provider selection remains server-controlled. Internal governance fields are excluded from frontend DTO projection. Prompts and responses exist only in invocation memory; they are neither logged nor persisted. Provider failures are converted to fixed classifications without inspecting their message/code. Only server-created failure classifications are accepted; raw failures become internal failures. No credentials enter React, request contracts, usage tables, or logs. The provider has no City-system or resident-data interface.

Authorization, global/model/quota/provider gates, timeout, response validation and mandatory recording fail closed. The existing resident/public behavior and navigation are unchanged. Operational audit ownership, retention, export/access controls and reconciliation remain to be approved; these tables are not a tamper-proof archive against privileged database administrators.

## Validation

Final established checks:

| Check | Result |
| --- | --- |
| Backend unit (`server:test`) | 106 passed, zero failed/skipped |
| Backend E2E (`server:test:e2e`) | 29 passed, zero failed/skipped |
| PostgreSQL (`server:test:db`) | 11 passed, zero failed/skipped (7 top-level tests including governance subtests) |
| React (`test:react`) | 106 passed across 16 files, zero failed/skipped |
| Shared/legacy (`npm test`) | 62 passed, zero failed/skipped |
| TypeScript, lint, formatting | Passed |
| Backend and React production builds | Passed; existing React 542.23 kB chunk warning |
| Root/server dependency audit | Root zero; server five pre-existing high findings, unchanged SEC-001 disposition |

Tests cover strict/nested DTOs, normalized success and invalid provider results, missing permissions/identity, disabled/unknown/ungoverned models, empty quota/provider registries, production/live-provider rejection, timeouts/cancellation, safe failures, storage outages, accepted/denied/terminal events, payload exclusion, correlation, no shipped generation routes, atomic concurrent quotas, duplicate IDs, scoped single-use completion, SQL constraints, rollback/reapply and no grants. The preexisting F020 hard-stop tests now check missing governance; new router tests retain default/production denial coverage. No Entra fixture is used outside tests.

Migration CLI validation uses a new isolated local `cityvue_f021_checkpoint_20260913` database: apply all nine, status all executed, revert F021 only, status eight executed/one pending, reapply, status all nine executed. SQL verifies no grants/assignments and empty governance tables in that isolated database. One status attempt during concurrent schema tests returned PostgreSQL 42P01; after tests completed, serial status and direct SQL verification both passed with all nine migrations executed. Migration CLI/schema tests should run serially during checkpoint verification. PostgreSQL test suites use separate random schemas; existing resident/development data is not reset. The local Compose service is restored to its prior stopped state after checks, preserving the checkpoint database.

No package manifest/lock changes, upgrades, force audit fixes, hosting changes, or frontend changes. [SEC-001](../security/SEC-001-multipart-dependency-follow-up.md) continues to track unreachable multipart dependency risk; F021 adds no uploads. Live Entra UAT still awaits administrator consent; no new visual UAT is claimed for the unchanged UI.

## Provider Connection Gate

**No live provider should be introduced until F021 is reviewed and approved.** A future provider additionally needs City approval of identity UAT/access grants, model/classification policy, acceptable use, data processing/location/retention/training terms, provider/gateway selection, secret management, egress, quota/cost policy, monitoring/audit retention, incident handling and deployment scope. None of those approvals is created by test success.

Recommend **F022 — First Approved AI Provider / Azure AI Gateway Integration** as the next separately requested feature. Do not implement or connect it here. F021 does not implement live OpenAI/Azure/Foundry/Claude/Gemini, production chat, RAG, uploads, embeddings/vector stores, tools/MCP, autonomous agents, City-system/email/GIS access, resident AI, or deployment.

## Files and Git

Only F021 changes are included. The initial working tree was clean; no unrelated changes were found. The commit message is `feat(ai): add usage governance and provider contracts`. The final commit SHA, push result, remote SHA equality and final status are reported in the task completion response (this report is part of the commit and cannot embed its own eventual hash).

27 files changed:

- `docs/ARCHITECTURE.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/decisions/ADR-002-ai-governance-metadata.md`
- `docs/features/F020-enterprise-ai-workspace-foundation.md`
- `docs/features/F021-implementation-report.md`
- `server/.env.example`
- `server/migrations/20260913010000-add-ai-governance-metadata.ts`
- `server/src/ai/ai-failure.ts`
- `server/src/ai/ai-governance.types.ts`
- `server/src/ai/ai-policy.service.ts`
- `server/src/ai/ai-provider-registry.ts`
- `server/src/ai/ai-quota.service.ts`
- `server/src/ai/ai-request.dto.ts`
- `server/src/ai/ai-router.service.ts`
- `server/src/ai/ai-usage.service.ts`
- `server/src/ai/ai.module.ts`
- `server/src/ai/ai.types.ts`
- `server/src/config/configuration.ts`
- `server/src/config/environment.ts`
- `server/src/database/database.types.ts`
- `server/test/database/ai-governance.integration.test.ts`
- `server/test/e2e/ai-governance.e2e.test.ts`
- `server/test/e2e/ai.e2e.test.ts`
- `server/test/fixtures/ai-test-provider.ts`
- `server/test/unit/ai-governance.test.ts`
- `server/test/unit/ai.test.ts`

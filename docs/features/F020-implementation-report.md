# F020 implementation and prerequisite completion report

**Date:** 2026-09-13. **Scope:** Enterprise AI Gateway Foundation and authorized F018/audit prerequisites. No F021 implementation or deployment.

## Prerequisite disposition and commit isolation

The initial main and remote baseline was `241a65c02e7b26abb149ad01b82e054976e607a6`. The earlier checkpoint found 63 dirty files spanning F018 and F020 and correctly deferred committing until the prerequisite work was authorized. That authorization was subsequently provided.

F018 was reconstructed from the exact pre-F020 snapshot over the initial HEAD in an isolated temporary tree. Its 46-file commit contains authentication/RBAC, MSAL/jose wiring, schema, documentation, and tests; no AI implementation. Review required one security correction: require the JWT `exp` claim, with a signed-token regression and four server guard tests. Independent validation passed 87 backend unit, 16 E2E, 5 PostgreSQL, 91 React, and 62 shared tests, with zero failures/skips, plus typecheck, lint, format and both builds. Archive CRLF line endings were normalized only in the validation copy. Repository-normalized validated file contents were staged without overwriting F020 working files, and the cached diff was reviewed.

F018 commit: `fca7cac865ee5744e8085493dfcbd6990bcf7e43` — `feat(auth): add Entra staff authentication and RBAC foundation`.

A separate documentation-only security tracking commit records all five pre-existing high audit findings: `b67782d97a8cd6ef63e2c9ab53404762195fc88d` — `docs(security): track deferred multipart dependency risk`. Root audit is clean. All five backend findings derive from Multer 2.2.0; no current application multipart parser is registered. Upstream Multer 2.3.0 is patched, but Nest pins 2.2.0 and the audit-fix dry run cannot resolve the findings safely. No dependency versions changed; no force fix or cross-major downgrade was performed. See [SEC-001](../security/SEC-001-multipart-dependency-follow-up.md) for package ranges, four GHSA/CVE identifiers, runtime/dev relevance, reachability, remediation options and review gates. This tracked deferral is not City production risk acceptance.

After those commits, exactly 31 F020 files remain (18 new and 13 modified). Shared authentication/configuration files contain only incremental AI-specific changes relative to committed F018. F018-only and dependency files are excluded from F020. No unrelated work was found in the remaining tree.

## F018 files included (46)

- `.env.example`
- `docs/ARCHITECTURE.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/features/F018-phase-b-entra-authentication-rbac-foundation.md`
- `package-lock.json`
- `package.json`
- `react/src/api/apiClient.js`
- `react/src/app/router.jsx`
- `react/src/auth/AuthContext.jsx`
- `react/src/auth/StaffRouteGuard.jsx`
- `react/src/auth/msalConfig.js`
- `react/src/auth/tokenProvider.js`
- `react/src/components/navigation/PrimaryNavigation.jsx`
- `react/src/config/runtimeConfig.js`
- `react/src/main.jsx`
- `react/src/residentIntake/residentIntakeRepositories.js`
- `react/src/serviceRequests/serviceRequestDetailsData.js`
- `react/src/serviceRequests/serviceRequestRepositories.js`
- `react/test/StaffAuthentication.test.js`
- `server/.env.example`
- `server/migrations/20260903020000-add-entra-rbac-foundation.ts`
- `server/package-lock.json`
- `server/package.json`
- `server/src/app.module.ts`
- `server/src/auth/auth.decorators.ts`
- `server/src/auth/auth.module.ts`
- `server/src/auth/auth.types.ts`
- `server/src/auth/entra-token.service.ts`
- `server/src/auth/staff-access.guard.ts`
- `server/src/auth/staff-authorization.service.ts`
- `server/src/bootstrap.ts`
- `server/src/config/configuration.ts`
- `server/src/config/environment.ts`
- `server/src/database/database.types.ts`
- `server/src/database/seed-development.ts`
- `server/src/service-request/get-service-request-details.service.ts`
- `server/src/service-request/list-service-requests.service.ts`
- `server/src/service-request/service-request.controller.ts`
- `server/src/service-request/service-request.repository.ts`
- `server/src/service-request/staff-actions.service.ts`
- `server/test/database/staff-actions.integration.test.ts`
- `server/test/e2e/service-request.e2e.test.ts`
- `server/test/unit/entra-token.service.test.ts`
- `server/test/unit/environment.test.ts`
- `server/test/unit/staff-access.guard.test.ts`

## Architecture and security controls

- Isolated NestJS AI module with CityVUE-owned provider, message, response/usage, context and model contracts.
- Empty static model registry, explicit metadata projection, policy-enforced routing and unconditional generation stops. No provider adapter, network client, chat endpoint or prompt persistence.
- Existing Entra token validation, delegated scope, StaffIdentity mapping and server RBAC reused. `RequireEntra` excludes local fallbacks on AI endpoints.
- Separate `ai.workspace.access` and `ai.administration.access` keys. A data-only migration adds catalog keys without creating roles, assigning staff, or adding tables.
- Authenticated `GET /api/v1/ai/status` and `GET /api/v1/ai/models`, Swagger DTOs, no-store metadata responses, unchanged safe error envelopes and correlation/logging middleware.
- `AI_ENABLED=false` by default; true requires complete Entra configuration. `AI_CHAT_ENABLED=true` is rejected and effective chat configuration is hardcoded false.
- Lazy `/staff/ai` route uses existing layout/themes and strict Entra admission. API denial removes workspace controls; composer, model selector and Send remain disabled. Public navigation is unchanged.
- AI uses the shared API client with an optional active-account MSAL token function, avoiding dependence on parent/child effect ordering on initial mount. Existing callers keep their original token-provider default.
- No content/claims/secrets added to ordinary logs. Future Azure API Management/provider evaluation, governance, DLP, files, retention and least-privilege tools are documented; none is provisioned.

See [the feature specification](F020-enterprise-ai-workspace-foundation.md) and [ADR-001](../decisions/ADR-001-provider-neutral-staff-ai-gateway.md).

## Files created by F020

- `docs/decisions/ADR-001-provider-neutral-staff-ai-gateway.md`
- `docs/features/F020-enterprise-ai-workspace-foundation.md`
- `docs/features/F020-implementation-report.md`
- `react/src/ai/AIWorkspacePage.jsx`
- `react/src/ai/aiRepository.js`
- `react/test/AIRepository.test.js`
- `react/test/AIWorkspacePage.test.jsx`
- `server/migrations/20260913000000-add-ai-permissions.ts`
- `server/src/ai/ai-model-registry.ts`
- `server/src/ai/ai-policy.service.ts`
- `server/src/ai/ai-router.service.ts`
- `server/src/ai/ai.controller.ts`
- `server/src/ai/ai.dto.ts`
- `server/src/ai/ai.module.ts`
- `server/src/ai/ai.types.ts`
- `server/test/database/ai.integration.test.ts`
- `server/test/e2e/ai.e2e.test.ts`
- `server/test/unit/ai.test.ts`

## Existing files modified by F020

- `docs/ARCHITECTURE.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ROADMAP.md`
- `react/src/api/apiClient.js`
- `react/src/app/router.jsx`
- `react/src/auth/StaffRouteGuard.jsx`
- `server/.env.example`
- `server/src/app.module.ts`
- `server/src/auth/auth.decorators.ts`
- `server/src/auth/auth.types.ts`
- `server/src/auth/staff-access.guard.ts`
- `server/src/config/configuration.ts`
- `server/src/config/environment.ts`

These 31 paths are the complete F020 commit inventory; prerequisite changes are already committed separately.

## Tests added

- Backend unit: configuration/defaults, forbidden activation, identity/workspace/admin permission checks, registry projection, unknown/disabled models, mandatory policy evaluation and blocked generation/network.
- Backend HTTP/E2E: actual Nest guards/policy/middleware with deterministic token/identity fixtures; anonymous, invalid-token, missing-scope, unprovisioned, unrelated/admin-only permissions, disabled/enabled metadata, sanitized errors, correlation, body-free logs and OpenAPI.
- PostgreSQL: additive/idempotent permission insertion, no automatic grants, preservation of unrelated permissions and rollback. Verified against the isolated PostgreSQL checkpoint database; zero skips.
- React: strict Entra admission, authorized disabled state, empty models, safe server rejection, sign-out/account change, accessible labelled inert controls, unchanged public links and actual application route.
- React repository: authenticated metadata-only requests, disabled-mode request suppression, no-Entra rejection and active MSAL token acquisition before the global provider effect mounts.


## Final validation

Validation is against the committed F018/security-documentation baseline, with the unchanged F020 implementation and the new F018 guard regressions.

| Suite | Command | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| Backend unit | `npm run server:test` | 93 | 0 | 0 |
| API E2E | `npm run server:test:e2e` | 24 | 0 | 0 |
| PostgreSQL | `npm run server:test:db` | 6 | 0 | 0 |
| React | `npm run test:react` | 106 | 0 | 0 |
| Shared/legacy | `npm test` | 62 | 0 | 0 |

`server:typecheck`, `server:lint`, `server:format:check`, `server:build`, and `build:react` pass. The React production main chunk retains Vite's >500 kB advisory. No root frontend lint or independent TypeScript script is configured. Root/server manifests agree with their lockfiles. F020 adds no dependencies; root audit remains zero and the five server highs have the documented SEC-001 disposition.

## Migration and permission verification

The earlier checkpoint applied all eight migrations to the isolated local `cityvue_f020_checkpoint_20260913` database, rolled back only F020, confirmed seven executed/one pending, then reapplied F020. The final prerequisite run reconfirmed all eight executed with none pending. SQL shows exactly `ai.workspace.access` and `ai.administration.access`, zero AI role grants, and zero staff-role assignments in that checkpoint database. All six database tests passed without skips, including repeated migration up/down and preservation of unrelated permissions.

The migration adds only two catalog keys, creates no tables/roles, and grants nobody access. Foreign keys prevent rollback from silently removing explicitly granted permissions. Shell-only development connection settings were used; existing development data was not migrated or reset. The checkpoint database is retained for inspection; the previously stopped local Compose service is restored to stopped after checks.

## Browser, source and authentication review

Started a loopback Vite production preview on port 4173 and attempted the real `/staff/ai` page through browser controls. The first browser operation timed out; a recovered session then returned `net::ERR_BLOCKED_BY_CLIENT` for the local URL. No browser security setting was changed and no workaround bypass was introduced. Consequently, no visual or browser-network UAT is claimed. The temporary preview was stopped afterward.

Automated React tests verify actual-router rendering, disabled state, anonymous/no-Entra rejection, unauthorized API responses, active-account token acquisition, sign-out/account changes and unchanged resident navigation. HTTP tests verify real Nest guards/policy/middleware with deterministic token/identity fixtures, including absent/invalid tokens, missing scope, missing provisioning and insufficient permissions. These fixtures are confined to tests and are not an application authentication bypass.

Live authorized and unauthorized employee browser UAT remains pending City Entra administrator consent and real provisioned accounts. No Entra settings, permissions or credentials were changed.

Source review confirms:

- The API independently validates Entra identity/delegated scope and existing StaffIdentity/RBAC; UI guards are not authorization.
- AI rejects the existing local development fallback. Missing identity or AI workspace permission denies access.
- AI is disabled by default; chat cannot be enabled through configuration. UI availability cannot activate an adapter.
- Provider-neutral contracts, server-owned model registry, policy-first router and unconditional generation stops remain.
- React uses CityVUE's authenticated API client, with no direct AI vendor client, provider key or service credential.
- F020 has no prompt/response ingestion, persistence or ordinary logging. Existing sanitized structured logging continues to omit body/header/claim/secret data.
- No resident AI navigation or resident workflow coupling was introduced.
- A focused built-JavaScript scan found zero matches for provider-key markers/variable names or private-key headers. This complements source review; it is not a general proof against every possible secret format. Existing CityVUE/MSAL tokens are identity tokens for the intended browser/API flow, not provider credentials.

## Explicitly deferred functionality

F020 does **not** include live OpenAI, Azure OpenAI, Microsoft Foundry, Claude or Gemini integration; production AI chat; RAG; file upload; MCP/tool use; City-system access; VUEWorks or MGO integration; autonomous agents; conversation history; quotas or metering. **Prompts and AI responses are neither persisted nor logged by F020.**

## Completion and outstanding manual items

The authorized commit order is F018, the documentation-only SEC-001 follow-up, then `feat(ai): establish enterprise AI gateway foundation`. There is no dependency remediation commit because package changes were deferred. Final commit identifiers, push result, remote SHA comparison, and clean status are reported in the task completion response; this report is part of the F020 commit and does not embed its own eventual hash.

Live Entra UAT remains pending administrator consent and provisioned authorized/unauthorized staff accounts. Browser visual/network UAT remains unverified because the browser tool blocked the local URL. SEC-001 must be revisited before uploads or production API activation. No tenant settings changed, no live provider was connected, and no deployment or F021 work was performed. Stop after the authorized commits and push are verified; further work requires a separate request.

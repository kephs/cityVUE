# F050 implementation and validation record

Status: **implemented and validated as a development foundation**. Automated, authenticated UAT, logging/audit privacy and integrity gates passed. Local commit only; no push/deployment or F051 authorization.

Started on clean `main` at `cea121b1e0614a7fed7ca72993ab5277c3f32655`, 0 ahead / 0 behind the existing `origin/main` reference. No remote operation. The final commit hash and clean/ahead-behind readback are reported with delivery rather than embedded in their own commit. Commit message: `feat(requesters): add trusted identity history foundation`.

## Delivered contract

See [feature specification](F050-trusted-requester-identity-history.md) and [ADR-012](../architecture/decisions/ADR-012-trusted-requester-identity-history.md). Requester identity is separate from Contact, request intent and staff submitter. No production resident identity provider is configured or implemented. Existing Entra remains workforce authentication only.

| Evidence                                                                       | Trusted linkage in F050?                             |
| ------------------------------------------------------------------------------ | ---------------------------------------------------- |
| Approved resident provider stable subject                                      | Future contract; no real provider implemented        |
| Development synthetic stable subject                                           | Yes, explicitly gated personal development/test only |
| Matching Contact/email/name/phone                                              | No; phone is not a current Contact field             |
| Service Location, IP/device, evidence/EXIF/checksum, tracking, staff intuition | No                                                   |

| Request state                                    | Contact                                         | Trusted link  | History action                                |
| ------------------------------------------------ | ----------------------------------------------- | ------------- | --------------------------------------------- |
| Anonymous PUBLIC                                 | None                                            | Forbidden     | None                                          |
| Identified PUBLIC, Contact-only                  | Existing required name, optional email          | None          | None; no misleading zero-history message      |
| Identified PUBLIC with trusted synthetic context | Same existing Contact requirement               | Creation-only | Available after current request authorization |
| INTERNAL                                         | Separate staff attribution, no resident Contact | Forbidden     | None                                          |

Organization-scoped `requester` stores random UUID, controlled source, exact bounded stable subject and createdAt only. Unique Organization/source/subject prevents duplicate first resolution. Same subject in another Organization resolves separately. No profile, Contact fields, mutable email key or global identity. Identity rows and request links are immutable. Existing requests keep null links; there is no historical matching/backfill.

`service_request.requester_id` is optional, with composite Organization foreign key and identified-PUBLIC eligibility constraint. Database triggers prevent null-to-link, reassignment and unlinking after insertion. Browser requesterId/source/subject fields fail strict DTO validation; JSON-shaped forged trusted contexts fail server provenance checks. Assisted intake keeps authenticated staff attribution and remains unlinked. INTERNAL cannot become requester history.

## Actual trusted creation and retry flow

Guarded local CLI resolves the explicit fictional Organization and synthetic provider context → strict intake DTO validation → canonical catalog/answer/Contact/location validation and geographic eligibility → creation transaction → prepare supported evidence batch and compare submission digest (including trusted source/subject in memory only) → finalized retry returns original receipt → shared Issue lock and F049 policy → F048 default owner resolution → reference allocation → idempotent trusted Requester resolution in the same transaction → identified PUBLIC request/link → evidence finalization → Contact, Service Location, Answers, creation security audit and operational Activity → optional initial assignment/history → commit → unchanged minimal creation receipt.

Concurrent first identity resolution uses unique insertion with conflict-do-nothing, followed by lookup; no update to immutable identity is required. Failures roll back newly resolved identity, reference and other writes. Concurrent supported evidence retries return one original request/Contact/reference/assignment/history/evidence result and retain the original link; changing trusted context or replaying through ordinary PUBLIC intake fails. Independent submissions without evidence remain independent creates, consistent with F046; there is no general new intake idempotency promise.

Ordinary PUBLIC intake still produces identified + Contact + no trusted link, or explicit anonymous + no Contact + no link. Contact changes never alter persistent identity. Automated tests show different Contact values under one subject resolve the same Requester and identical Contact under distinct subjects remains distinct. Names, email, phone, geography, network/device and tracking never participate in resolution.

## Authorized history and UI

Route: `GET /api/v1/staff/service-requests/:serviceRequestId/requester-history?page=1&pageSize=25`. No direct requester-ID route, directory, lookup or search exists. Authentication and existing PUBLIC read permission precede current-request SQL scope admission. Parent must be identified PUBLIC with a trusted link. The same `staffRequestReadScope` relation constrains linked rows, count and category aggregation by active Organization, persisted audience and current effective Department/Division scope. Requester ID is not authorization. Invalid IDs and inaccessible/unlinked parents fail safely. Unknown query fields fail strict validation.

The synthetic authorization example is **five linked / three independently accessible → three returned/countable**, with category counts for those same three only and no indication that other requests exist. Permission/scope gain or loss changes the next response, never the identity link. Same-request snapshot consistency follows existing Activity reads; no long-lived snapshot or cache retains revoked authority.

Default page size 25, maximum 100; pages 1–1,000,000. Sort createdAt descending, then UUID descending. Current request is included, counted and marked **Current request**. Rows expose only navigation request ID, stored reference, versioned Issue name, status, createdAt and current marker. Category summaries use current repository taxonomy. Time-window and status summaries and Service Location are deliberately deferred to keep the initial projection small. Contact, Notes, Communications, attachments, Activity, tracking, source and subject are absent.

Request Management places **View Request History** immediately after Contact for eligible linked requests. It shows **Trusted identity linked**, without fetching history/count merely on detail load, hover or focus. Explicit open loads the existing named native dialog, factual **accessible requests** count, recent request links and category counts. Normal same-tab staff navigation independently reauthorizes the destination. Closing clears state; reopening retrieves afresh. Existing request/auth remounts and abort checks suppress stale data. Pagination clears old rows, errors are safe/retryable, and an empty page says only that no accessible requests are on that page. Close/Escape/focus restoration reuse `RequestDialog`. Contact remains a separate explicit action and permission.

## Audit, logging, performance and threats

Each successful history response requires a committed `requester_history_audit` insert. Typed allowlist: audit UUID, Organization, current request UUID, staff UUID, fixed action `history_viewed`, server correlation UUID and database timestamp. The table rejects UPDATE/DELETE/TRUNCATE. No subject, requester ID, Contact, description, count, payload or hidden request IDs. Failure returns no history. History does not fetch Contact or create Contact-view/security Activity/operational Activity events. Normal logger uses its existing allowlist; captured automated HTTP logs contain no provider subject, Contact or history payload. Live logging privacy: **PASS**, confirmed by the developer after three authenticated history reads; provider subjects/identity claims, Contact values, history response bodies and bearer tokens were absent.

History uses five fixed SQL operations (parent admission, count, category aggregate, joined paginated rows, audit insert), plus existing staff authorization. No per-row query or storage access. The unique identity index and partial Organization/requester/createdAt/UUID history index match actual lookups. Category/count cost scales with linked authorized history. No production load-test claim. Threat model and residual in-flight revocation/local-operator risks are in ADR-012.

## Migration and development baseline

Migration required: **yes**, `20260926000000-add-trusted-requester-history`. Disposable apply/down/reapply passed, creating zero inferred identities/links and preserving historical rows/grants. Rollback refuses retained identity/link/audit data. After automated validation and target verification, the existing compiled migration CLI applied it to personal localhost:5432 / reqro_dev / reqro_dev_user, development profile: **26 applied / zero pending**, verified with the normal migration status CLI after UAT.

One fictional synthetic Requester and two identified PUBLIC requests were deliberately retained via CLI after dry-run inspection:

- **SR-202609-000011** — Damaged Street Sign, open, revision 2; existing F048 default assignment applied.
- **SR-202609-000012** — Streetlight Out, open, revision 1; no default assignment.

The same trusted identity has different fictional Contact per request. Provider subject is deliberately omitted from this report. No pre-existing request was linked. SR-202609-000010 stays anonymous, unlinked, with zero Contact rows; the existing INTERNAL request is unlinked with staff attribution intact.

| State                                                   |     Before | After fixture creation |
| ------------------------------------------------------- | ---------: | ---------------------: |
| Migrations applied                                      |         25 |                     26 |
| Requesters / development synthetic                      |          0 |                      1 |
| Service Requests                                        |         10 |                     12 |
| Linked identified PUBLIC                                |          0 |                      2 |
| Unlinked identified PUBLIC                              |          6 |                      6 |
| Anonymous linked / INTERNAL linked                      |      0 / 0 |                  0 / 0 |
| Duplicate trusted identities / cross-Organization links |      0 / 0 |                  0 / 0 |
| Contact                                                 |          6 |                      8 |
| Location / Answers                                      |    10 / 13 |                12 / 15 |
| Assignment rows / Watchers                              |     16 / 3 |                 17 / 3 |
| Operational Activity / security Activity                |   63 / 100 |               66 / 103 |
| Internal Notes / Communications                         |      3 / 4 |                  3 / 4 |
| Attachments / batches / attachment audit                | 3 / 3 / 48 |             3 / 3 / 48 |
| Tracking active / revoked                               |      1 / 5 |                  1 / 5 |
| Role permission rows                                    |         34 |                     34 |

All original row fingerprints are unchanged across Organizations, hierarchy, catalog, F049 policy/configuration audit, F048 defaults/configuration audit, requests, Contact, location, answers, assignment, watchers, Activity, Notes, Communications, attachments and staff/grants. Four existing private storage files retain identical checksums. Intentional additions are exactly the fixture's two requests, two Contact/location/answer rows, one assignment and three events in each creation/assignment stream. Final post-UAT fingerprint comparison passed for every original row and all four private files; tracking state/timestamps are unchanged. Three minimal history-view audit rows are the only additional UAT writes beyond the intentional fixture.

## Automated validation

| Check                                                                               | Result                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------- |
| Backend unit                                                                        | 234 passed                             |
| API E2E                                                                             | 40 passed                              |
| PostgreSQL integration, including HTTP security/forgery/history and migration tests | 230 passed, zero skips                 |
| Shared                                                                              | 64 passed                              |
| React                                                                               | 500 passed                             |
| TypeScript / backend build                                                          | Passed                                 |
| Backend lint                                                                        | Passed                                 |
| Frontend lint                                                                       | No configured script                   |
| Server formatting                                                                   | Passed                                 |
| Frontend production build                                                           | Passed; existing >500 kB chunk warning |
| Whitespace / documentation links / private-data review                              | Passed                                 |

Environment execution: shell `npm` was unavailable. Used the installed Node entry points corresponding to manifest scripts: `server/node_modules/typescript/bin/tsc` with `tsconfig.test.json`, `tsconfig.json --noEmit`, `tsconfig.build.json`; compiled `node --test` in `server/dist-test/test/unit`, `test/e2e --test-concurrency=1`, and `test/database`; root manifest's explicit eight-file shared Node test list; `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1`; server installed ESLint/Prettier; root installed Vite production build. Only TEST_DATABASE_URL was loaded for disposable tests, without printing it. Loading the entire personal API environment initially caused an external-identity configuration failure; isolated test configuration resolved that without changing application validation.

The `tsx` launcher failed at `uv_os_get_passwd` in this environment. The same compiled migration CLI was run from `server/dist-test` with ignored personal configuration; the built development-requester CLI ran from `server`. No authentication bypass, fallback identity or configuration weakening was used.

Focused tests cover model/provenance/production gate, uniqueness/concurrency, anonymous/INTERNAL/cross-Organization/link immutability, Contact-only/same/different Contact behavior, strict browser forgery, parent/row/count/category authorization, pagination/tie-break, scope gain/revocation, Contact independence, allowlisted projection/audit/logging, fail-closed audit, transactional creation failure and supported evidence retries. Full regressions cover F039/F044/F045/F046/F047/F048/F049. The final full database run includes the direct eight-way first-resolution race and equal-Contact/distinct-subject refinement; all 230 tests passed. Total automated checks: 1,068 passing tests.

## Live UAT and completion evidence

The developer restarted the updated API outside the restricted sandbox. Normal personal Entra authentication worked; no tokens were copied or decoded. Linked history passed with two accessible requests, newest first, current marker and Roads & Streets / Streetlights counts of one each. The audit table had zero rows before explicit open, proving no history disclosure on detail load; reopening refreshed the current marker. Normal same-tab navigation loaded SR-202609-000012, dismissed the dialog and focused its Issue heading. Contact-only SR-202609-000008 retained its separate Contact action and no history action. Anonymous SR-202609-000010 retained its anonymous label and no history action; INTERNAL DEV-202609-00000003 also had no history action. Light and dark dialog layouts passed visual review at 1440, 1280, 1024, 768 and 390 px, including mobile wrapping and reachable Close. Enter/Space activation, Tab/Shift+Tab containment, visible focus, Escape/Close and opener focus restoration passed. Original light theme and default viewport were restored. No screenshots or payload captures are retained. Live audit readback found three history_viewed rows across the two current requests, with only the seven allowlisted columns. Existing Contact/security Activity counts did not grow during these history reads. Two fixtures intentionally cannot fill a 25-row page; pagination is exercised automatically instead of creating excess personal-development requests. This is accessibility-oriented validation, not WCAG certification.

No new grants are required. Contact-protected history is proven by automated authorization tests, avoiding unnecessary live permission mutation. No requester tracking operation, credential inspection, production/client/cloud resource change, deployment, push, history rewrite or F051 work has occurred.

The retained F044 authentication lesson applies: when a bearer token is present but the sandbox-launched API returns 401 because Microsoft signing-key retrieval is blocked, use the developer-launched API outside that restricted sandbox for authenticated UAT. This is an authentication environment issue, not a permission/RBAC failure; do not change grants or weaken token validation.

## Changed files and handoff

- Database: `server/migrations/20260926000000-add-trusted-requester-history.ts`, `server/src/database/database.types.ts`, `server/src/database/development-requester-cli.ts`, `server/package.json`.
- API: `server/src/service-request/trusted-requester.ts`, `requester-history.service.ts`, `requester-history.controller.ts`, `create-service-request.service.ts`, `internal-request.repository.ts`, `service-request.module.ts`.
- UI: `react/src/staff/requests/RequesterHistory.jsx`, `RequestManagement.jsx`, `requestRepository.js`, `staffRequests.css`.
- Tests: `server/test/unit/trusted-requester.test.ts`, `server/test/database/trusted-requester-history-checks.ts`, `request-audience.integration.test.ts`, `development-staff.integration.test.ts`, `react/test/RequesterHistory.test.jsx`.
- Documentation: feature specification/report, ADR-012 and ADR index, feature index, Architecture, Roadmap and Product/Repository Context.

No dependencies were added. No frontend identity-provider configuration is needed. The guarded development CLI documents its explicit opt-ins through `--help`; the synthetic context is never enabled as an HTTP identity endpoint. The retained fictional Requester and two requests support future read-only UAT without retaining subject-bearing temporary inputs. Review this local checkpoint next; synchronization requires separate authorization, and production identity integration requires its own design/security approval.

Final security review found no Contact inference, authority shortcut, cross-Organization linkage or protected-domain projection. All 27 changed files are F050 implementation, tests or documentation. Documentation links and whitespace checks passed. Known local subject/configuration values and credential patterns are absent from the changes. The six temporary baseline/CLI/provider/intake/integrity files were physically removed; no logs, screenshots, payload captures or private attachments are committed. Existing ignored runtime configuration and private application storage are preserved.

All matching, profile/directory/search, manual merge/link/correction, historical Contact inference, anonymous correlation, IP/device identity, Requester Geography, requester scores/behavioral labels, automated decisions, requester-facing portal/history/Communication, analytics, production IdP and advanced routing remain unimplemented/deferred. Production without a trusted resident provider continues Contact-only identified intake without persistent linkage; it never guesses identity. See ADR-012 for production prerequisites.

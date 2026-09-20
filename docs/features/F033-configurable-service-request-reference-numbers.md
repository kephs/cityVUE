# F033 — Configurable Service Request Reference Numbers

## Purpose and identity

Reqro supports client-neutral Organization reference policies without changing technical identity. **THE HUMAN-FACING REFERENCE NUMBER IS NOT THE SERVICE REQUEST PRIMARY KEY.** UUIDs remain foreign keys and API identities. Complete references remain persisted in the existing `service_request.reference_number`; reads never reconstruct old references from current policy. No legacy/new-reference split is introduced.

**POSSESSION OF A REFERENCE NUMBER DOES NOT CONFER ACCESS TO A SERVICE REQUEST.** Sequential identifiers can reveal approximate volume and are not authorization secrets. No public tracking/enumeration endpoint is added. Existing reference lookup constrains Organization and PUBLIC audience; staff INTERNAL access remains F030/F031 controlled. List searching already uses scoped ILIKE, while exact repository lookup compares the persisted canonical reference case-sensitively. Canonical prefixes are uppercase. Existing resident confirmation, staff list/detail and API receipts render the persisted string without assuming the old format. Export/vendor-reference subsystems are not implemented; future external IDs remain separate from UUIDs and Reqro references.

## Previous implementation discovered

F011's foundation migration created a **global** `service_request_reference_sequence`, keyed only by six-digit month. A transactional PostgreSQL UPSERT allocated integers 1–999999. `periodKeyFor` derived YYYYMM from the server creation instant in `organization.default_business_timezone`; `formatReferenceNumber` emitted `SR-YYYYMM-NNNNNN`. Database constraints required that exact 16-character format and global uniqueness. All F029 creation paths already shared CreateServiceRequestService. The fictional `SR-202609-000001` therefore means the September 2026 period and allocated value 1, not a UUID, random token, client date or audience-specific number.

F033 evolves that same repository allocation call and domain formatter. There is one creation algorithm for resident PUBLIC/WEB, assisted PUBLIC, and staff INTERNAL; audiences and intake channels never select separate counters.

## Controlled configuration

`service_request_reference_config` has one row per Organization, with prefix, date_component, sequence_width, reset_policy, separator, revision and updated_at. Existing Organizations receive the backward-compatible defaults; new Organizations resolve to defaults and materialize a row on the first creation or configuration update. Reading/previewing defaults does not write a row or counter.

| Field | Policy |
| --- | --- |
| prefix | Optional empty string or 1–12 ASCII letters/digits. Lowercase is normalized to uppercase; whitespace, controls and punctuation are rejected, not trimmed. |
| separator | Hyphen or empty string only. No slash, query/path characters or multi-character separators. Only present components are joined. |
| dateComponent/resetPolicy | Exactly `none`/`never`, `year`/`yearly`, or `year_month`/`monthly`. Other combinations are rejected. |
| sequenceWidth | Integer 4–12; a minimum zero-padding width. |
| expectedRevision | Required current positive revision, bounded below integer exhaustion. Stale writes return 409. |

Defaults: SR / year_month / 6 / monthly / hyphen. Examples include SR-2026-000001, SR-202609-000001, 311-2026-00000001 and CASE-00000001. They are examples, not tenant-specific defaults.

**SEQUENCE WIDTH IS A MINIMUM DISPLAY WIDTH, NOT A MAXIMUM REQUEST CAPACITY.** 9999 becomes 10000 at width 4. No truncation, wrapping or six-digit exhaustion remains. PostgreSQL signed bigint and JavaScript BigInt preserve integer precision through 9,223,372,036,854,775,807; exhausting that numeric storage returns a safe conflict, rather than wrapping. Resident DTOs expose only the resulting string.

## Atomic allocation, uniqueness and effective time

Counters are keyed by `(organization_id, period_key)` where period is `never`, YYYY or YYYYMM. All requests in an Organization share that policy/counter regardless of audience/channel. New periods start at 1 unless migration established a higher safe value. Monthly/yearly periods use the existing Organization business timezone and server date. Browser dates cannot choose a period; no new timezone-management subsystem is introduced.

Creation locks/materializes the Organization configuration row, reads one complete policy, and uses atomic PostgreSQL `INSERT ... ON CONFLICT ... UPDATE ... RETURNING` on that Organization/period. Allocation is inside the existing request/contact/location/answer/activity transaction. It never uses runtime MAX()+1, scans history, parses old references or takes table-wide locks. Exact collision defense is an indexed Organization/reference lookup. The final database constraint is `UNIQUE (organization_id, reference_number)`; identical visible strings in two Organizations are valid and resolve only in scoped queries.

Configuration updates lock the same row. A creation already holding the lock uses the old complete policy; a later creation uses the new complete policy. Hybrid formats are impossible through these paths. Same-Organization creates serialize briefly; different Organizations have independent rows/counters. High-volume deployments should measure contention rather than assume a distributed counter is needed.

Failed transactions roll back the allocation and every associated write, allowing an uncommitted value to be reused safely. No promise of gapless numbering is made: references are identifiers, not accounting invoice numbers, and gaps may occur where technically necessary. Migrating prior global counter high-water values can itself leave tenant-local gaps.

## Configuration changes and historical safety

Prefix, separator and width changes never reset counters. Switching date/reset policy uses its existing period bucket or a new bucket, and switching back resumes the previously retained bucket. No counter editing or arbitrary starting numbers are exposed.

Syntax alone is insufficient. Under the configuration lock, administrative updates inspect this Organization's persisted references in bounded pages. The proposed policy recognizes only strings it could canonically generate, extracts their period/value, and checks that the corresponding retained counter has already passed them. If a proposed policy could regenerate any issued reference, the update fails with a deterministic 400. It does not guess, renumber, silently skip or reset. This covers numeric-prefix/no-separator ambiguities as well as immediate collisions. Administrative safety review can scan that Organization's history and temporarily delay its creates; **normal allocation does not scan history**. An out-of-band database import can still cause a fail-closed allocation conflict and requires an explicitly designed import process, deferred here.

The database prevents updates to an issued reference, UUID or Organization. Existing workflows update status/routing/revision without touching those fields. Historical rows retain references byte-for-byte through configuration changes.

## Administration and preview

New narrow Entra-only permission: `service_request.reference.manage`. No default, seed or personal grant is created. F030 internal.read, F031 internal.update, F032 catalog.issue_action.manage and creator status do not grant this capability. Organization comes exclusively from guard-resolved StaffAccess; the service also checks permission, identity, development-fallback exclusion and active Organization. This permission is Organization-wide configuration authority, not Department request access.

- `GET /api/v1/staff/service-request-reference-configuration`: current policy, revision and exampleReference.
- `POST /api/v1/staff/service-request-reference-configuration`: explicit prefix, dateComponent, sequenceWidth, resetPolicy, separator and expectedRevision. No generic Organization update, counter value, starting value, reference or Organization field is accepted.

Both return no-store. URL/body IDs cannot select another Organization; extra body fields are rejected, query Organization selectors are ignored and no Organization-ID route exists. Responses expose no counter internals. `exampleReference` demonstrates sequence 1 at the server's Organization-local date; it is not a promise of the next reference. GET/preview never reserves a number.

No suitable Organization settings UI exists; `/admin-preview` is a demo. No portal or F034 workspace is built. Existing HTTP logging is sanitized; no tokens, credentials, contacts or descriptions are added. There is no suitable general administrative audit store, so durable configuration audit/approval history is deferred. Revision is concurrency metadata, not an audit trail.

## Migration

`20260919040000-configure-request-references` locks affected tables during the migration, validates legacy format/month/nonzero suffix, creates default policy rows and replaces global counters with Organization-scoped bigint counters. Existing authoritative global month values are copied to each existing Organization, conservatively preserving their high-water mark. The legacy schema guarantees fixed formatting; validated historical suffixes are aggregated only at migration time to reconcile manually seeded rows/missing counters. The larger authoritative/historical value wins. This one-time MAX aggregate is not a request-allocation MAX()+1 algorithm. Ambiguous/invalid legacy data fails migration safely.

No ServiceRequest reference or audience/channel is rewritten. Organization relationships, F030/F031 grants and F032 actions are untouched. The reference column expands to 48 characters with an uppercase-alphanumeric/hyphen safety constraint; global uniqueness changes to Organization uniqueness.

Unused migration down/up is supported. Rollback refuses any request, counter, revised configuration or dependent permission grant, because active Organization-specific state cannot safely fit the prior global, six-digit design. Never force a destructive rollback after use.

## Validation and UAT

Automated coverage includes 50 simultaneous creations in each of two Organizations, independent counters with equal visible references, configuration-update races with 20 creates, safe migration/defaults/rollback/reapply, retained historical rows, formatting changes, period boundaries, no-reset behavior, width overflow, bigint precision, duplicate defense, transaction failure after allocation, preview without writes, stale revisions, historical collision denial, and real HTTP authorization/DTO rejection with only token verification replaced by fictional test identities. Existing F029–F032 suites retain their security checks.

Final verification results follow. Authenticated admin browser UAT remains pending: the existing personal grant CLI is geospatial-specific, and F033 does not invent a bypass or automatic grant.

## Deferred work

No arbitrary templates/scripts, counter editing, starting-number customization, per-audience/channel/Department series, imports/aliases/renumbering/reservations, external-ID management, distributed counters, audit history, approval workflow, integrations, notifications, cloud changes or production activation. Existing Organization timezone is reused; timezone editing is not introduced. F034 Staff Internal Request Workspace is not started.


## Final implementation evidence

Starting checkpoint: main at f5b200f9c02b41eb5b69be415fcca1b2bbc5228d, clean, 14 ahead of origin/main. The observed origin/main remained 6eb836892089bde09ab4255e9f6871a304065fca. No push, deploy, remote/cloud/client-resource changes or default/personal reference grants occurred.

| Validation | Result |
| --- | --- |
| Backend unit | 166 passed |
| API E2E | 36 passed |
| PostgreSQL integration | 51 passed, zero skipped |
| Shared | 62 passed |
| React | 157 passed |
| TypeScript, lint, formatting | Passed |
| Backend/frontend production build | Passed |
| Diff/secret review | Passed; no private local configuration values in the 21 changed files |

Database concurrency tests created 50 requests in each of two Organizations simultaneously (100 total), then separately 15 per Organization under different YEAR/YEARLY and NONE/NEVER configurations. All references were unique within each Organization and counters remained isolated. A further 20-create/configuration-update race produced only complete old/new formats. Width 4 progressed 9998, 9999, 10000, 10001. Monthly/yearly timezone boundaries and NEVER continuity passed. Migration forward/unused-down/reapply passed; operational rollback refusal passed. Configuration prefix/width/separator/date-policy changes, historical immutability, safe-collision rejection, preview, stale revision, allocation rollback and DB uniqueness tests passed. F029/F030/F031/F032 regressions passed; redirect-only HTTP submissions preserve both request and counter state.

After automated validation, target was reverified as localhost:5432 / reqro_dev / reqro_dev_user without printing credentials. Applied **20260919040000-configure-request-references** using `npm run database:migrate`; `database:status` confirmed all migrations executed and none pending. A before/after comparison verified byte-equivalent serialized existing ServiceRequest rows, Issue action definitions and role grants. In particular, **SR-202609-000001** remains unchanged. reqro_test was used only for isolated automated test schemas.

Live UAT used the existing local React app and migrated API. The normal Missed Collection intake retained questions, accepted fictional answers/contact/location, completed review and produced **SR-202609-000002**. The resident confirmation visibly displayed that reference. This clearly labeled synthetic PUBLIC request remains in personal reqro_dev. The historical request detail page required staff sign-in in the current browser session; its display check is pending, while its preserved value was verified in PostgreSQL. No authentication bypass was attempted. Live external-Issue configuration/UAT remains unavailable without an appropriate explicit administrator grant; the React handoff and direct resident/staff rejection/counter tests passed. Administrative read/update/preview/change UAT is pending for the same grant limitation.

The temporary API process was stopped after UAT. The confirmation tab was retained as a deliverable, the blocked detail tab closed, and the user's original map tab/Vite process left intact. No temporary UAT files were created. Retained warnings: pre-existing frontend chunks over 500 kB, Node DEP0190 from fixed-argument local npm orchestration, and Git LF/CRLF conversion notices. No warnings were suppressed.

Security review confirms no active MAX()+1 allocation, tenant-counter coupling, browser-supplied reference/counter/Organization authority, expanded public lookup, implicit administrative grant, reference-as-access-secret, changed audience/channel rules, F030/F031 permission weakening, F032 bypass, historical renumbering, or wraparound. No unsafe syntax or known historical collision is accepted by the configuration service. Direct privileged database writes/imports are outside this administrative API and remain constrained by database uniqueness/immutability; imports require future explicit design.

## Changed file manifest

Added:

- docs/features/F033-configurable-service-request-reference-numbers.md
- server/migrations/20260919040000-configure-request-references.ts
- server/src/service-request/reference-configuration.controller.ts
- server/src/service-request/reference-configuration.service.ts
- server/src/service-request/reference-policy.domain.ts
- server/src/service-request/reference-policy.repository.ts
- server/test/database/reference-policy.integration.test.ts
- server/test/unit/reference-policy.test.ts

Changed:

- docs/ARCHITECTURE.md
- docs/CITYVUE_CONTEXT.md
- docs/ROADMAP.md
- server/src/auth/auth.types.ts
- server/src/database/database.types.ts
- server/src/service-request/create-service-request.service.ts
- server/src/service-request/service-request.domain.ts
- server/src/service-request/service-request.module.ts
- server/src/service-request/service-request.repository.ts
- server/test/database/request-audience.integration.test.ts
- server/test/database/service-request.integration.test.ts
- server/test/database/staff-actions.integration.test.ts
- server/test/unit/service-request.domain.test.ts

No frontend source or dependencies changed. F034 remains unimplemented.

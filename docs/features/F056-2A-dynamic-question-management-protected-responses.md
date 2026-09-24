# F056.2A — Dynamic Question Management & Protected Responses

Status: implemented and validated locally. Starting checkpoint `1a9f36740608d601566cc452936bc2ed3666a9cc`, main. See the [implementation report](F056-2A-implementation-report.md) and [ADR-018](../architecture/decisions/ADR-018-dynamic-questions-protected-answers.md).

## Approved scope

Extend existing version-owned questions/options and normalized typed answers. Author short text, long text, number, yes/no and single select only. Publish replacement versions atomically using an internal draft build, existing core revision and independent action/policy/assignment revisions. Preserve historical rows and existing equals conditions; no new condition authoring.

Limits: 25 questions, 25 options per choice, 200 options total, prompt 200 Unicode characters, help 500, option label 100, short answer 300, long answer 2,000, finite numbers within ±1,000,000,000 with at most six decimals, schema 64 KiB and answers 32 KiB UTF-8. Historical content is not truncated.

Question and option numeric order remains unique; no adjacent swap or automatic renumbering. Incompatible published type changes are prohibited. Remove affects only the replacement version. Newly authored semantic keys are opaque; rewording retains keys, replacement versions receive new row identities.

## Approved security compatibility change

The user explicitly approved §26 migration: ordinary legacy `GET /api/v1/service-requests/:id` no longer returns answers. Its `/issues/:issueId` consumer must remain usable without answers permission. Both that page and unified staff detail use the protected answer-read path. Parent request authorization and `service_request.answers.read` are independently required. No counts, prompts or existence placeholders are disclosed before authorization.

Protected disclosure requires a committed metadata-only read audit and `Cache-Control: no-store`, including denial paths. No default grants or broad bundle additions. Audit failure prevents disclosure. Answers remain excluded from ordinary details, tracking, search, analytics, notifications, AI and exports, and do not populate Contact, Requester, Location, Participation, assignment or workflow.

## Submission compatibility

New submissions must use the current catalog version; stale versions return 409 without partial creation. Reload/review/revalidate is deliberate; no silent answer translation or resubmission. Existing F046 finalized-evidence retry returns the original successful receipt, even after configuration changes. This is not general idempotency.

## Gates and baseline

Read-only baseline reconfirmed: 33 migrations, 52 tables; 7 active Issues, 8 catalog versions, 17 questions, 13 options, 16 answers, 13 requests and 3 conditional definitions. Existing answer version/key mismatches: zero. Participation-read audits: 53; area audits: 9; Issue audits: 7. Existing values must remain unchanged apart from explicitly authorized migration metadata and legitimate versioned UAT additions.

The required pre-grant gate was observed: authenticated parent 200/protected answers 403, explicitly user-confirmed before dry-run and provisioning only answers.read. Post-grant read passed. User logging and responsive/accessibility checks passed. Historical integrity and final review remain mandatory before local commit. No push/deploy or F056.2B/F056.2C/F057.

## Validation record

Automated validation: 269 backend unit tests, 40 API E2E tests, 312 PostgreSQL tests (no skips), 64 shared tests and 590 React tests passed. Backend and frontend builds and backend ESLint passed; frontend build retains its existing chunk-size warning. Disposable PostgreSQL coverage includes migration apply → rollback → reapply, publication concurrency, protected authorization and audit failure, legacy answer removal, maximum-question schema and historical snapshots.

The development migration is applied (34 migrations). Immediately after migration, a read-only comparison of every pre-existing non-secret column across the 52 baseline tables found changes only in migration metadata and permission registration; the new read-audit table was empty and answers.read had zero grants. After user-confirmed 403 and UAT, the deliberate final state has one answer-read grant, two protected-read audits and three versioned configuration audits. All original answers remain unchanged. No development seed was run.

Authenticated pre/post-grant reads, normal Admin Add/Remove and controlled same-value/versioned edit/stale conflict passed. Resident required/Review draft checks passed without creating a development request. Three versioned schema changes were retained and the temporary question is absent from the final current schema; all original historical rows remain. Final results and safe counts are in the implementation report; this does not authorize synchronization or deployment.

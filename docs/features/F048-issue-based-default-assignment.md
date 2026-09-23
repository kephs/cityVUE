# F048 — Issue-Based Default Assignment

Status: implemented from synchronized `bf084dc3033fb56e2ba2b9f1dae0dc54241bf73b`. Automated validation, disposable and personal migrations, authenticated UI UAT and integrity checks passed. The user confirmed live logging privacy; see the [validation record](F048-implementation-report.md). No push, deployment or F049 work is authorized.

## Design

One optional default belongs to the stable Organization-scoped ServiceDefinition (Issue), independently of its published intake version. Reuse F037 `staff`, `role`, `group` target identities, composite foreign keys, scope/active/audience eligibility and one-current-owner constraint. None is valid. A dedicated configuration row retains a monotonic revision even after clearing; absent rows start at revision zero. Explicit expected revision and a parent Issue lock serialize configuration updates and creation reads, including the initially absent configuration.

All existing PUBLIC web, assisted PUBLIC and INTERNAL creation channels use the shared creation service. No explicit initial-assignment input currently exists. Server configuration alone chooses the initial owner. F046 finalized-batch retries return their original receipt before configuration evaluation. No default is reapplied by reading, editing, reopening, manual reassignment/unassignment or retry.

No configuration means normal unassigned creation. A configured target is revalidated with F037 for the actual audience and routing scope. Unavailable targets degrade to unassigned creation with minimal system audit evidence, without guessed fallback. A valid target creates one F037 assignment, advances revision consistently, and appends distinct System automatic-assignment Activity plus metadata-only audit inside the request/reference/contact/location/answers/evidence transaction. Required assignment/history/audit failures roll everything back. No watchers or grants are added.

Configuration is available only through explicit guarded personal development provisioning with dry run, expected revision, safe inspection and confirmed mutation. The current Issue action API authorizes redirect configuration only; its permission is not repurposed. Production administration UI/API is deferred. The development tool changes no permissions and accepts only the existing fictional Organization and eligible fictional/development targets.

Assignment is operational ownership, never authorization. Routing remains separate. Contact, Notes, Communications, attachments, tracking and Live Search retain independent existing policies. No requester projection gains configuration, assignment or Activity fields. No notifications, location/content/requester rules, fallback chains, balancing or general rules engine are introduced.

## Validation and evidence

The [implementation report](F048-implementation-report.md) distinguishes automated disposable tests from authenticated live UAT, retained fictional additions from pre-existing data, and development capability from production readiness. It records the passed user-confirmed live logging gate explicitly.

## Configuration and lifecycle contract

`issue_default_assignment` has a composite Organization/Issue primary key, one nullable typed target, same-Organization target foreign keys, revision and update time. STAFF references `staff_identity`; ROLE references the operational role, not an RBAC role; GROUP is the existing Team. Names are never keys. Current owner displays resolve current safe names; Activity retains the safe name snapshot at assignment time. Membership changes do not expand a Role/Team into individual owners or rewrite assignments.

Configuration accepts a target only if active and eligible for the Issue's current Department/Division in at least one supported audience. Creation checks the actual audience. STAFF needs existing independent request-read permission and scope. A public-only staff target therefore degrades safely for INTERNAL intake. Role/Team eligibility reuses F037; membership never supplies authorization. Wrong type, malformed/missing/foreign target and ineligible configuration fail without mutation. Physical deletion of a referenced target is prevented by foreign keys; deactivation or later scope/access changes can make a retained target unavailable.

Clearing retains the configuration revision with a null target. Changing/clearing affects future requests only. Expected revision is checked even for a no-op; a valid no-op creates no extra audit. A row lock on the stable Issue serializes competing configuration changes with creation's shared Issue lock, including an absent configuration row. No stale write silently wins. The append-only configuration audit records Organization, Issue, trusted development operator, action, target type/ID, revision and timestamp; no content, credentials or target name.

Creation's existing validated Organization/catalog/audience path and finalized-attachment retry check run first. For a new request the shared Issue lock protects action/default selection. Resolve the configured target against current scope; allocate the reference using F033's transactional sequence; insert request/contact/location/answers/evidence and ordinary creation history; insert one initial assignment if valid, advance revision 1 to 2 and updatedAt, append automatic Activity and security audit; commit and return the unchanged minimal receipt. None/unavailable keeps revision 1. Failures for a valid target roll back the request, reference allocation and all associated writes. Unavailable configuration instead records `service_request_created` metadata `defaultAssignment: {source: issue_default, outcome: target_unavailable}` and creates an ordinary Unassigned request. No internal configuration error is returned to the requester.

`request_auto_assigned` is displayed as **Request automatically assigned**, with actor **System**, the target snapshot and **Source: Issue default assignment**. It is ordered after Request created using database timestamps and has request revision 2. Manual F037 operations keep their existing actor/event/revision behavior. System assignment has no fabricated staff identity. Success security audit uses `service_request_assigned` with policy/source/action/revision only. No additional operational event is created for unavailable defaults.

F046 finalized-batch retries return the original receipt before reevaluation, including after configuration change, workflow change or manual reassignment. Concurrent retries create no second request, reference, assignment or Activity. Ordinary submissions without that supported batch mechanism remain independent creates; F048 does not invent general intake idempotency. There is no explicit initial-owner input or new Issue-change operation. Reads, reopening, routing, workflow changes and later manual unassignment cannot trigger the creation hook.

## Development operation

PRODUCTION ADMINISTRATION UI DEFERRED. No configuration HTTP endpoint, browser selector, new permission or permission grant exists. The local process operator must already have development database authority, explicit personal-Entra opt-in, mapped active staff, selected fictional Organization and applicable existing scope. This is not a production authorization scheme. Ordinary `service_request.assign` does not enable configuration through an API.

From `server`, load the existing ignored personal configuration into the process without printing it. The package command is `dev:issue:default-assignment` (the existing TypeScript CLI with `issue-default`). Inputs:

| Input                                | Meaning                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| Existing F036 environment/selection  | Strict development profile, personal tenant match, localhost:5432 / reqro_dev / reqro_dev_user; explicit Organization and mapped staff |
| `F048_ACTION`                        | `inspect`, `set` or `clear`                                                                                                            |
| `F048_ISSUE_ID`                      | Existing stable fictional Issue UUID                                                                                                   |
| `F048_EXPECTED_REVISION`             | Required for set/clear; inspection reports zero if absent                                                                              |
| `F048_TARGET_TYPE`, `F048_TARGET_ID` | Set only; `staff`, `role` or `group` and exact UUID                                                                                    |
| `--dry-run`                          | Read-only validation; no configuration, audit or grants written                                                                        |
| `--confirm`                          | Explicit mutation after inspecting the dry run                                                                                         |

Inspect with `issue-default --dry-run`, dry-run the proposed set/clear, then repeat it with `--confirm`. A conflict requires fresh inspection and deliberate review. Failures are sanitized by the established CLI. Keep personal selection files ignored. Raw SQL is not a production administration workflow.

## Security and performance

| Condition                   | Current owner?            | Automatically grants request access? |
| --------------------------- | ------------------------- | ------------------------------------ |
| Eligible STAFF default      | Yes, one staff target     | No                                   |
| Eligible ROLE default       | Yes, one operational role | No                                   |
| Eligible GROUP/Team default | Yes, one Team             | No                                   |
| Watcher relationship        | No                        | No                                   |
| Department/Division routing | No                        | No                                   |

ASSIGNMENT IS OPERATIONAL OWNERSHIP. ASSIGNMENT IS NOT AN AUTHORIZATION GRANT. Existing parent/audience/scope and independent protected-domain permissions remain authoritative, including after membership or permission revocation. Requester input cannot choose default target/type, source or Organization. Requester receipt/tracking projection excludes ownership/configuration/history. No personal data is added to logs or ordinary list/search payloads.

An unconfigured creation adds one indexed composite-key lookup. A configured creation adds that lookup, one Category share-lock read, one exact target share-lock read and one bounded F037 eligibility query. A valid target adds assignment insert, parent revision update, Activity insert and security audit insert. Eligibility is type/UUID/Organization-specific; it does not fetch the target catalog into memory or iterate members. Existing identity/membership indexes and the new composite primary key support these predicates. No list/detail N+1 query is introduced. Creation/configuration can contend on the same Issue; this deliberate serialization is not a production throughput claim. No load benchmark was performed.

Migration `20260924000000-add-issue-default-assignment` creates empty configuration/audit tables and extends actor/Activity constraints. It performs no historical assignment/backfill, inferred default, grant, routing or tracking change. Disposable down/reapply is supported before meaningful F048 data; down refuses to discard retained configuration, audit, System ownership or automatic Activity. Production rollout requires its own reviewed migration/configuration procedure.

Deferred: production configuration UI/API and authorization policy, geographic/requester/content/attachment rules, schedules, priority rules, multiple actions, fallback chains, workload balancing, round robin, SLA escalation and assignment notifications. No condition tables, arbitrary operators or general rules engine are implemented. No AI, external delivery or vendor integration is invoked.

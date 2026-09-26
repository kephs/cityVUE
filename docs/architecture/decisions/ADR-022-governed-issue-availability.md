# ADR-022 — Governed post-creation Issue Availability

Status: Accepted design by explicit user approval on 2026-09-25; implemented and validated locally. Supersedes only the unconditional post-creation Availability immutability in [ADR-019](ADR-019-issue-availability-governed-handoff.md) and its retention in [ADR-021](ADR-021-complete-atomic-issue-creation.md).

## Decision

Availability remains a stable Issue property. An authorized `PATCH /admin/issues/:id` may change it for future intake, within the existing atomic configuration transaction. Historical Service Requests retain persisted audience, channel, attribution, catalog-version references, answers, location and tracking. Availability-only changes do not publish a new catalog version.

The existing matrix remains: Internal Only and Internal & External permit Reqro Intake; External Only permits Reqro Intake or External Redirect. A draft conflict never silently changes Handling. The administrator must explicitly resolve it. The final Issue-row update applies Availability and any deliberate Handling change together. Active and Inactive Issues are supported; activation validation sees the final state.

## Database enforcement

Migration 37 (`20261007000000-govern-issue-availability`) replaces runtime functions introduced by Migration 35 without editing that migration. Configuration audit gains bounded transition metadata: prior/resulting Availability and Handling, prior/resulting action revision, and a database-stamped transaction ID. Existing core revision, actor, Organization, Issue, correlation, time and participating resource revisions remain in the same append-only record.

A before-insert audit trigger locks the scoped Issue, verifies the claimed preceding state and stamps the current transaction ID, ignoring any caller-provided stamp. An Availability update requires a matching record from that transaction, including exact prior/resulting values and revisions. A deferred constraint trigger rejects an audit without the completed final state and, when action revision advances, matching F032 action history/audit. A partial unique index permits only one transition record per Organization/Issue/resulting core revision. Existing audit update/delete/truncate rejection remains. No session bypass flag, reusable capability or unguarded Availability setter is introduced.

The API remains the authenticated staff authorization boundary. A shared application SQL identity cannot attest an HTTP caller or route. The database enforces mutation integrity, not independent Entra authentication, and does not defend against an owner disabling triggers or a compromised application SQL identity fabricating a complete command. Separate database role deployment is outside this decision.

## Transactions, revisions and rollback

Issue configuration takes the existing Organization-scoped Issue row lock and checks all four expected revisions before no-op comparison. Availability contributes to core revision exactly once per Save; Handling advances action revision only when that resource changes. Policy and Assignment retain independent revisions. Equivalent Availability produces no transition record or revision churn. Catalog publication remains limited to existing content changes.

The shared F032 preparation and history functions retain Admin read, Issue write, action management and Department/Division scope. Legacy F032 and atomic creation use the same functions. A combined Save validates the final matrix before mutation, updates the row once and appends required action history/audit in the caller's transaction. Any failure rolls back all participating writes.

Migration application changes no existing configuration values or historical requests. Unused down/up is supported. Down refuses after any retained governed transition, even if Availability has subsequently returned to its original value; it never deletes history or rewrites current values to make rollback possible.

## Historical integrity and concurrency

Creation already takes a shared stable-Issue lock and revalidates Availability, Handling, active state and published version. Configuration's exclusive lock therefore serializes with intake. Already-admitted creation can finish under its locked configuration; subsequent intake revalidates the committed replacement. Staff reads use persisted request audience; detail/tracking use the stored catalog version.

Disposable PostgreSQL proof covers PUBLIC/INTERNAL requests with answers and locations plus a PUBLIC tracking credential, exact before/after historical rows, stale/no-op behavior, matrix transitions, missing/mismatched/replayed/cross-Organization evidence, failure injection and migration rollback refusal. See the [post-UAT report](../../features/F056-5-post-uat-refinement-report.md) for actual evidence and validation limitations.

All other ADR-019/ADR-021 decisions remain accepted, including atomic Add Issue, source review, F032 scope, redirect validation, immutable action history and handoff governance. No new application permission or grant/provisioning change is authorized.

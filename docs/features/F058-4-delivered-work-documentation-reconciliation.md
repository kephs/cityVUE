# F058.4 — Delivered-work documentation and governance reconciliation

Status: documentation and governance reconciliation. **F058.4 changes no runtime behavior.** No React, server, test, migration, SQL, permission-catalog, API-contract, authentication, configuration, dependency or lockfile change is part of this record. No database was accessed. No Accepted UI Baseline was changed. No resident UI, branding, asset, navigation or client configuration was changed.

Baseline: branch `claude/roadmap-status-audit`, HEAD `36f13d8a17f9c9e1defbceae82cb5d1cfdc85454`, clean working tree, zero commits ahead of or behind `main`. A read-only roadmap and implementation-status audit was performed against this baseline, reviewed and accepted; this record implements its first recommendation.

## Why this reconciliation was necessary

[F057.4](F057-4-access-administration-architecture-refresh.md) was written because a fresh session, reading the durable documents in the order [the Codex Protocol](../development/REQRO_CODEX_PROTOCOL.md) prescribes, could reasonably conclude that delivered F057 work remained unimplemented. **The identical failure mode had already recurred one feature family later, for F058.**

At this baseline the repository showed:

- `main` and `origin/main` both at `36f13d8a17f9c9e1defbceae82cb5d1cfdc85454`, with **no outstanding unsynchronized feature work**.
- Six F058 commits — `cc5439c`, `114d381`, `ffe8e72`, `3b1bd88`, `dad644f47562e29419b0cdd2af6f5b421071ab48`, `6732837` — all ancestors of `main`.

The durable documentation showed:

- [ROADMAP](../ROADMAP.md), [ARCHITECTURE](../ARCHITECTURE.md) and [CITYVUE_CONTEXT](../CITYVUE_CONTEXT.md) all leading with "synchronization remains unauthorized … **F058.2 remains unstarted**".
- Every F058 feature record still carrying `not committed`, `not pushed`, `Synchronization is not authorized` or `Stop for manual visual review`.
- The [feature index](README.md) containing **no F058 entry at all**, its accepted-features table stopping at F041.
- `6732837` — the commit AGENTS.md names as *the* Accepted UI Baseline checkpoint — having **no feature record, no UAT record and no ADR**, so a future agent could not discover what was accepted there or why.

The roadmap's structure was itself the mechanism. Nineteen stacked reverse-chronological checkpoint paragraphs meant the paragraph a protocol-compliant reader encounters first was the newest *checkpoint*, not current state — and that paragraph was wrong. Appending a twentieth would have reproduced the defect. Restructuring was explicitly approved for this task.

## What F058.4 changed

### 1. ROADMAP restructured — current state separated from history

[ROADMAP.md](../ROADMAP.md) now opens with a reading-order statement and six authoritative current-state sections, followed by all historical material:

1. Current product state
2. Current authoritative checkpoint
3. Delivered capability families
4. Active and recommended next work
5. Planned, deferred and blocked
6. Production readiness gaps
7. Historical checkpoints

**All historical content is preserved.** The 152-line historical body was moved unchanged beneath section 7; the only edits to it are nine heading demotions (`##` → `###`, `###` → `####`) so the existing sections nest correctly under section 7. A line-by-line comparison confirms 118 inserted lines and **zero deleted historical lines**. Historical validation counts, UAT statements, live database observations, migration counts and authorization statements are retained verbatim and are explicitly marked as state at their own checkpoints, not current claims.

### 2. A durable record for `6732837`

[F058.3A — Service Request Workspace column row-sizing correction](F058-3A-workspace-row-sizing.md) was created. It records the sparse-content defect, why SR-202609-000013 exposed the superseded "content stack is always the taller side" assumption, the CSS Grid intrinsic-track excess-distribution root cause, the selected Candidate A correction (`grid-template-rows: auto auto 1fr`), the browser geometry evidence (≈ 1,074 px → 20 px on the sparse reproduction), what responsive and light/dark behavior was preserved, the nine committed regression cases, the manual UAT PASS, and — in full — **what constitutes the Accepted UI Baseline** at that checkpoint.

### 3. F058 status reconciled across the durable set

Current-state reconciliation lines were added to the four F058 records and to the durable documents. **Historical statuses, evidence, validation tables and limitations inside those records were not edited**, following the F057.4 convention.

## Authoritative F058 status

All slices are implemented, validated and synchronized. All listed commits are ancestors of `main` at this baseline.

| Slice | Capability | Commit | Manual UAT |
| ----- | ---------- | ------ | ---------- |
| F058.1 | [Request authorization and read consistency](F058-1-request-authorization-consistency.md) | `cc5439c8c48e574e9c5f82f51c2cc1e93147c726` | Not required for this slice |
| F058.2A | [Collaboration eligibility for INTERNAL requests](F058-2-collaboration-workspace.md); Migration 40 | `114d3814306d45fa8391c93d7045fe650b8e6e1d` | Authenticated mutation UAT remains a separate gate |
| F058.2B | [Service Request Workspace and List refinement](F058-2-collaboration-workspace.md) | `ffe8e727527da545cbf584c81c470cef35e9b381`, `3b1bd8803ab8320d936df6097380a7f4f603b082` | **PASS**, with three accepted corrections |
| F058.3 | [Workflow Activity narrative completeness](F058-3-workflow-activity-narrative.md) | `dad644f47562e29419b0cdd2af6f5b421071ab48` | **PASS** |
| F058.3A | [Workspace column row-sizing correction](F058-3A-workspace-row-sizing.md) | `6732837d86dd5a03a3e7604d869bd156fd010fa5` | **PASS** |

**Deliberately not started:** F058.2 outbound Requester Communication delivery and INTERNAL requester self-service. Recorded correspondence does not establish delivery; no email, SMS or notification capability exists in either package manifest.

## Migration 40 — live state is UNCERTAIN

`server/migrations/20261010000000-extend-internal-communication-attachments.ts` exists in the repository and is committed as part of F058.2A. It replaces only `protect_attachment_batch()` with an Organization-matched PUBLIC/INTERNAL communication predicate, so INTERNAL Requester Communication attachment finalization depends on it at the database level.

The last recorded observation was **39 applied / Migration 40 pending / 60 tables**, at the F058.2B checkpoint. **F058.4 accessed no database and makes no current claim.** Migration 40 must not be represented as applied without operator verification via `npm run database:status`. Until verified, authenticated UAT of INTERNAL communication attachment finalization is gated.

## ADR-024 — implemented, not ratified

[ADR-024 — Transaction-Time Authorization Coordination for Request Operations](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) remains **Proposed**. F058.4 does not change it to Accepted and does not amend its architectural decision.

The discrepancy is recorded rather than resolved:

- The architecture ADR-024 describes **is implemented on `main`** and is the live authorization model for request operations.
- F058.1, its implementing slice, **is delivered and synchronized**.
- ADR-024 **remains Proposed**, pending separate architecture and security ratification.

Implementation is not architectural approval. Ratifying — or amending — ADR-024 is a separate reviewed decision requiring explicit authorization, and the ADR's own "Evidence required before acceptance" section should be assessed against the delivered evidence at that time. Note that its required deterministic disposable PostgreSQL coverage cannot currently be re-executed in this environment, because `TEST_DATABASE_URL` is not configured.

## SEC-001 — untouched, flagged as the immediate security follow-up

[SEC-001](../security/SEC-001-multipart-dependency-follow-up.md) was **not modified**. Its security conclusion, dependency-state assessment, advisory inventory, tests and remediation recommendation are unchanged by F058.4.

The roadmap's "Active and recommended next work" section now identifies **SEC-001 reassessment as an immediate security follow-up**, recording the reason at a factual level only: SEC-001 is an open item whose stated premise — that no application multipart parser is registered — was invalidated when F046 introduced upload routes, and SEC-001's own text states that any such route invalidates the assessment. No reassessment, reachability analysis, residual-risk conclusion, test or dependency change was performed here. SEC-001 is a separate reviewed workstream after F058.4.

## Client neutrality — recorded, not changed

Resident-facing client-neutrality remediation is recorded in the roadmap as a high-value future candidate, for roadmap accuracy only. **No resident UI, branding, asset, navigation or client configuration was changed by F058.4.** No rename of the repository, package identifiers, Firebase configuration, deployment resources or runtime branding was performed; per [AGENTS.md](../../AGENTS.md) that remains a separately scoped task.

## Deliberately out of scope

Per the approved task boundary, stale statements outside the F058 and current-state narrative were **left for a later documentation cleanup** rather than opportunistically reconciled. Known examples, recorded here so they are not lost:

- The F048 and F049 records still describe production configuration administration as deferred, although `IssueFieldsDto` now exposes `defaultAssignment` and `requesterPolicy` through the authenticated Admin Issue API.
- `SECURITY_FRAMEWORK.md` still describes requester tracking under "Planned/future" although F044 delivered it, and its September 8 baseline paragraphs precede the F057.4 reconciliation line that corrects them.
- `server/README.md` retains Phase A framing ("Phase A contains no migration files and creates no tables") alongside 40 migration files.
- `ARCHITECTURE.md` retains historical per-feature checkpoint paragraphs below its durable sections, and its "Future integration and deployment architecture" section still closes with "F045 is accepted and synchronized. F046 is locally implemented … F047 is not selected or started", although F046 and F047 were both delivered and synchronized long ago. This sentence sits in a durable section rather than a dated checkpoint paragraph, so it is the most misleading of the deferred items and should lead the next cleanup.
- The `docs/features/README.md` "Accepted operational features" table still ends at F041. F058.4 added a pointer beneath it rather than restructuring the table, which belongs to a later cleanup covering F042–F057.

## Validation

Documentation-appropriate checks only. No application, backend or database suite was run; none applies to a documentation-only change. No dependency was installed.

| Check | Result |
| ----- | ------ |
| `git diff --check` | Clean; no whitespace errors |
| Line endings | All changed and new files are uniformly CRLF, matching the repository working tree |
| Trailing whitespace / tabs | None introduced |
| Local documentation links | All relative links in changed and new files resolve to existing files |
| Historical-content preservation | ROADMAP: 118 lines inserted, **zero historical lines deleted**; only nine heading levels demoted. Verified by line-by-line comparison against the baseline content |
| Roadmap / feature-index consistency | F058 slices and commits agree across ROADMAP section 2, the feature index and this record |
| Private-value and secrets review | No credential, token, key, secret, tenant, client, provider identifier or connection string introduced. Commit SHAs, migration filenames, permission key names and the fictional `SR-202609-000013` reference are existing non-secret repository identifiers |
| Database access | None |
| Runtime behavior change | None |

## Recommended next step

Human documentation review of this change set. After review, the roadmap's "Active and recommended next work" section records the recommended sequence: **SEC-001 reassessment** as the immediate security follow-up, then resident-facing client-neutrality remediation, then reference configuration administration. Each requires its own reviewed task and explicit authorization. The single highest-leverage unblocking decision remains provisioning a disposable PostgreSQL test database so `server/test/database` can execute.

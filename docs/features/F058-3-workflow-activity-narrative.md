# F058.3 — Workflow Activity narrative completeness

**Current state (F058.4 reconciliation): DELIVERED, manually accepted and synchronized as `dad644f47562e29419b0cdd2af6f5b421071ab48`, an ancestor of `main`.** The status line below records the state at the original checkpoint and is retained as historical fact; it is not a current claim. The PostgreSQL integration limitation below **does remain current**: `TEST_DATABASE_URL` is still not configured, so that suite still does not execute and is reported as skipped, never as passed. A subsequent manual UAT of this work surfaced a workspace layout defect, corrected separately by [F058.3A](F058-3A-workspace-row-sizing.md). See [F058.4](F058-4-delivered-work-documentation-reconciliation.md).

Status: implemented locally and validated except for the PostgreSQL integration suite, which cannot run in this worktree. Not staged, not committed, not pushed, not deployed.

Baseline: `3b1bd8803ab8320d936df6097380a7f4f603b082` on `claude/f058-3-activity-narrative`, clean working tree.

Manual UAT found that Recent Activity showed a lifecycle transition without the narrative staff had entered for it. This slice closes that presentation gap only. No schema change, migration, API change, authorization change or permission change is part of it.

## Investigation result

The narrative is **category A — already persisted on the existing Activity record and already projected.** It is not a persistence or projection defect.

End-to-end trace for Place on Hold, Close Request and Reopen Request:

| Stage                | Behavior                                                                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow form        | `WorkflowNarrativeForm` collects `reason` (Hold, Reopen) or `resolutionSummary` (Close).                                                                                                 |
| Mutation request     | `requestRepository.workflow` sends the action, `expectedRevision` and the action's narrative field.                                                                                      |
| Transaction/service  | `internal-request-mutations.service.ts` calls `normalizeOperationalNarrative`, then writes the request row, security `activity` row and `request_operational_activity` row in one `trx`. |
| Activity persistence | `request_operational_activity.narrative`, constrained non-null for `placed_on_hold`, `request_closed`, `request_reopened` and null for every other event type.                           |
| Activity API         | `internal-request.repository.activity()` selects `narrative` in its bounded page projection.                                                                                             |
| Frontend repository  | `requestRepository.activity` returns the projected item unchanged.                                                                                                                       |
| RequestActivity      | **The gap.** The narrative card was gated behind `!preview`, so the "View full activity" dialog rendered it and the Recent Activity sidebar preview did not.                             |

`start_work` and `resume` accept no narrative: `normalizeOperationalNarrative` returns null and the database constraint requires null. Routing, assignment and watcher events carry no narrative field. Hold and Reopen remain bounded to 500 characters, Close to 2,000, per [ADR-003](../architecture/decisions/ADR-003-operational-activity-history.md).

## Change

One condition in `react/src/staff/requests/RequestActivity.jsx`: the existing narrative card now renders whenever `event.narrative` is non-empty, in both the preview and the full history. The card's markup, label logic, plain-text rendering, long-narrative disclosure and CSS are the established treatment, unchanged.

No backend, shared, schema, CSS or API file changed.

### Terminology

Hold and Reopen display **Reason**. Close continues to display **Resolution**. The domain contract distinguishes an explicitly named resolution field — `resolutionSummary`, separately bounded to 2,000 characters and recorded as such in ADR-003 — and the accepted full-history view already labels it Resolution. Relabelling it Reason would have changed an accepted Activity presentation, which this feature is not authorized to do. Both surfaces now use the same label logic, so the preview and full history agree. No backend field was renamed.

## Preserved

Recent Activity placement and design, the timeline connector, event icons, titles, timestamps, actors, status badges, transitions, `Request routed` presentation including its routed treatment, routing icon and routing destination, assignment and watcher details, intake channel, "View full activity" behavior, and bounded pagination are unchanged. No event's presentation other than the addition of an already-persisted narrative was touched.

Narrative continues to inherit the visibility of the Activity stream that returns it. `request_operational_activity` has exactly one read path, reached only by the two staff controllers, both of which re-authorize the parent through `staffRequestReadScope` and `assertStaffRequestRead` and send `Cache-Control: no-store`. There is no resident or public Activity endpoint, so no requester-visible surface gains the narrative. The change adds no field to any payload and no request to any page.

## Validation

| Check                                 | Result                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `test:react` (focused workspace file) | 140 passed, 0 failed (clean on 4 of 6 runs; see the flakiness note below)                                 |
| `test:react` (full)                   | 782 passed, 1 failed — `IssueCreation.test.jsx`, pre-existing and flaky at the pristine baseline          |
| `npm test` (root)                     | 64 passed, 0 failed                                                                                       |
| `server:test`                         | 318 passed, 2 failed — both environmental subprocess timeouts, unrelated to Activity                      |
| `server:test:e2e`                     | 41 passed, 0 failed                                                                                       |
| `server:test:db`                      | **NOT EXECUTED — 20 tests, 0 passed, 0 failed, 20 skipped** because `TEST_DATABASE_URL` is not configured |
| `server:typecheck`                    | Clean                                                                                                     |
| `server:lint`                         | Clean                                                                                                     |
| `server:format:check`                 | 339 pre-existing CRLF findings across untouched server files; both changed files are Prettier-clean       |
| `build:react`, `server:build`         | Both succeeded                                                                                            |
| `git diff --check`                    | Clean                                                                                                     |

Frontend lint has no repository script; that remains true.

The two `server:test` failures are `development-startup.test.ts` (`spawnSync node ETIMEDOUT`) and `logging-sanitization.test.ts` (API startup probe returned no exit code). Both spawn child processes and neither touches Activity; no backend file changed. The `IssueCreation` and `MapPreview` failures were reproduced on a pristine checkout of the two changed files and vary between runs. No assertion was weakened and no timeout was raised to obtain a pass.

### Pre-existing flakiness in the workspace suite

`StaffRequestWorkspace.test.jsx` intermittently fails one test per run on this machine, a different one each time, always an existing test that asserts content is cleared after an access failure — for example `F041 Notes response 404 clears the inaccessible parent/contact/Notes`, which fails on `queryByRole` still finding the request heading. It is a timing race in those tests, not a narrative defect.

This was measured on both sides of the change, alternating a byte-exact pristine checkout with the change restored:

- Pristine baseline: 1 flake in 3 runs (135 tests).
- With this change: 1 flake in 3 runs (140 tests), plus 2 earlier clean 140/140 runs and 2 clean full-suite runs.

The rate and the affected test family are the same before and after, so the change does not introduce it. The F058.3 tests passed in every run and never appeared among the failures. The checkout is on a OneDrive-synced path, which is a plausible source of the I/O stalls behind these races and behind the two backend spawn timeouts.

### Tests added

In `react/test/StaffRequestWorkspace.test.jsx`:

- Hold, Close and Reopen each keep their narrative with the same event in Recent Activity and in full history, with the correct label, one event per transition, and the preview requesting `pageSize` 5 exactly once.
- An event without narrative renders no narrative card and no Reason or Resolution label, and the routed event retains `tone-routing`, `bi-signpost-split` and its destination.
- Older Activity pages retain narrative; the stream makes one request per page and none per event.

Two existing tests were scoped to the dialog because the narrative is now legitimately present in both places; each additionally asserts the preview carries the same narrative. Plain-text and XSS-safe rendering, safe actor display, routing detail and pagination assertions are retained as they were.

### Coverage relied on, not duplicated

Backend narrative behavior is already proven by retained tests: `request-activity.domain.test.ts` (required narrative, 500/2,000 bounds, plain-text and control/bidi rejection) and `request-activity-checks.ts` (each lifecycle transition persists exactly one event and narrative; stale retries persist none; insert failure rolls back state, revision, counters and audit; history reads enforce identity, current scope and audience; revocation clears access; newest-first pagination is deterministic; append-only constraints hold; narratives stay out of security audit).

## Synthetic visual UAT

The `RequestActivity` component was rendered twice from identical fictional data — once from the pristine baseline component and once from the change under review — over five events: Reopen, Close and Hold with narrative, plus Request routed and Work started without. Each rendered event's outer HTML was compared between the two captures.

| Surface         | Event            | Rendered markup       | Δ bytes |
| --------------- | ---------------- | --------------------- | ------: |
| Recent Activity | Request reopened | + narrative card only |    +149 |
| Recent Activity | Request closed   | + narrative card only |    +140 |
| Recent Activity | Placed on hold   | + narrative card only |    +129 |
| Recent Activity | Request routed   | identical             |       0 |
| Recent Activity | Work started     | identical             |       0 |
| Full history    | Request reopened | identical             |       0 |
| Full history    | Request closed   | identical             |       0 |
| Full history    | Placed on hold   | identical             |       0 |
| Full history    | Request routed   | identical             |       0 |
| Full history    | Work started     | identical             |       0 |

Zero unexpected deltas across all ten comparisons. Full activity history is byte-identical throughout, since the dialog already displayed the narrative. In Recent Activity, Request routed and Work started are byte-identical — routed treatment, routing icon and routing destination unchanged — and the three lifecycle events differ by nothing but the inserted card, so event icon, title, timestamp, actor, status badge and transition are all preserved. The three inserted cards are exactly:

```html
<div class="activity-narrative-card">
  <strong>Reason</strong>
  <p class="activity-narrative">
    Resident reported the problem remains unresolved.
  </p>
</div>
<div class="activity-narrative-card">
  <strong>Resolution</strong>
  <p class="activity-narrative">Damaged sign replaced and inspected.</p>
</div>
<div class="activity-narrative-card">
  <strong>Reason</strong>
  <p class="activity-narrative">Waiting for replacement part.</p>
</div>
```

A visual preview built from these captures and the application's own stylesheets records before/after Recent Activity, full history, an event without narrative, light and dark themes, and 390px narrow presentation. The capture harness was temporary and has been removed; no repository file retains it.

## Known limitations

- **PostgreSQL integration is NOT EXECUTED: 20 tests, 0 passed, 0 failed, 20 skipped, because `TEST_DATABASE_URL` is not configured.** This was independently confirmed from the authoritative primary `cityVUE` checkout, which produces the same result, so no configured PostgreSQL integration-test environment exists in either checkout. No `.env` was copied, no database URL was invented, no database was provisioned, no migration was run, and the suite was not pointed at the development database to satisfy this item. The narrative persistence and projection regressions listed above therefore remain unexecuted here; this feature's investigation established that persistence, transaction behavior, schema and API projection are unchanged, and the production change is limited to displaying the already-projected narrative in Recent Activity.
- Evidence is automated plus a synthetic component-rendered visual preview. No authenticated live staff UAT was performed and no live request or database was mutated.
- This worktree had no `node_modules`; root and server dependencies were installed locally to run validation. Node is v20.20.2 while one package requests >= 22, which is the likely cause of the two spawn-based backend failures.

## Recommended next step

Review the two-file production diff and the synthetic visual UAT evidence for the controlled local commit. PostgreSQL integration cannot be added to this evidence set until a `TEST_DATABASE_URL` environment exists; provisioning one is a separate, separately authorized activity and is not a prerequisite this slice can satisfy.

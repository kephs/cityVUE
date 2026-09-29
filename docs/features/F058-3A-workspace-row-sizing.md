# F058.3A — Service Request Workspace column row-sizing correction

Status: **DELIVERED, manually accepted and synchronized** as `6732837d86dd5a03a3e7604d869bd156fd010fa5`, an ancestor of `main`. This record is written retrospectively by [F058.4](F058-4-delivered-work-documentation-reconciliation.md); the commit was previously undocumented even though [AGENTS.md](../../AGENTS.md) names it as the Accepted UI Baseline checkpoint.

Parent: [F058.3 Workflow Activity narrative completeness](F058-3-workflow-activity-narrative.md), from `dad644f47562e29419b0cdd2af6f5b421071ab48`. The defect this slice corrects was observed during F058.3 manual UAT.

This is a **presentation-only** correction. No backend, API contract, repository projection, database, migration, permission, authorization, request revision or security behavior changed.

## The defect

On the wide-screen Service Request Workspace (≥1200 px), a large empty vertical gap opened between **Request Details** and the card below it in the left column whenever the right-hand controls column was taller than the left column's content.

The gap was layout whitespace, not a missing card. Every card rendered correctly, in the accepted order, with the accepted content and permissions. Only the vertical distribution of space was wrong.

## Why SR-202609-000013 exposed it

The accepted F058.2B layout assumed the left content stack was always the taller side. The F058.2B record states this explicitly: *"Because the content stack is always the taller side … the span never grows a row, so no height coupling reaches the left column."* That assumption held for the requests used during F058.2B review, where the left column measured 2,424 px against an 809 px controls column.

**SR-202609-000013 is the shape that breaks the assumption.** It is a sparse request: a short description, no service location, and no readable optional left-column cards — Additional Information, Request Evidence and Collaboration are all absent because their capabilities are unavailable or their content is empty. The left content column therefore collapses to nothing, while the right column still carries Actions, Request Management and Recent Activity at full height.

The committed regression reproduces exactly this shape and names it (`react/test/WorkspaceRowSizing.test.jsx`): *"The SR-202609-000013 shape: every optional left-column card is absent, so the content row has no intrinsic height while the controls column stays tall."* The test asserts `.request-column-content` settles to zero children while `.request-column-controls` holds more than one, and that neither column contains the other.

The assumption was reasonable for populated requests and wrong in general. Either column may be the taller one.

## Root cause — CSS Grid row sizing

The wide-screen layout places four grid items:

| Grid item | Contents | Placement |
| --------- | -------- | --------- |
| `.request-overview` | Overview | row 1, both columns |
| `.request-details` | Request Details | column 1, row 2 |
| `.request-column-controls` | Actions, Request Management, Recent Activity | column 2, **rows 2–3** |
| `.request-column-content` | Additional Information, Request Evidence, Collaboration | column 1, row 3 |

The controls column deliberately **spans rows 2 and 3** so the DOM can read `Request Details → Actions → Request Management → Recent Activity → Additional Information → Request Evidence → Collaboration` without duplication or CSS ordering tricks.

The rule declared `grid-template-rows: none`, so rows 2 and 3 were implicit tracks with intrinsic (`auto`) max sizing. **CSS Grid distributes a spanning item's excess height equally across the spanned tracks when those tracks have intrinsic max sizing.** When the controls column was taller than `.request-details` plus `.request-column-content`, half of its excess was added to row 2 — the row holding Request Details — and the left column gained a large gap beneath that card.

This is standard, specified grid behavior, not a browser bug. It only became visible once a request existed whose content column could collapse.

## The correction — Candidate A

One declaration changed in `react/src/staff/requests/staffRequests.css`, inside the existing `@media (min-width: 1200px)` block:

```css
-  grid-template-rows: none;
+  grid-template-rows: auto auto 1fr;
```

Making the trailing column-1 track **flexible** (`1fr`) removes it from intrinsic-track excess distribution. A spanning item's excess height collects in the flexible track instead of being split across both, so row 2 keeps its intrinsic height and Request Details retains the accepted gap above the content stack. Row 1 (Overview) and row 2 (Request Details) stay `auto`.

Candidate A was selected because it is a single declaration, confined to the existing desktop media block, and changes no DOM, no component, no card order, no focus order and no `order`, `float` or negative-margin trick. The committed rule carries an inline comment recording the mechanism so the reasoning is not lost again, and the superseded "content stack is always the taller side" comment was removed — the regression suite asserts that stale sentence is gone from the stylesheet.

Two supporting declarations already present were confirmed rather than added: `align-items: start` on `.request-workspace-layout` and `align-self: start` on `.request-column`, which keep each column top-aligned so neither column's height stretches the other's cards.

## Browser geometry evidence

Measured in a real browser on the sparse reproduction, wide-screen desktop:

| Measurement | Before | After |
| ----------- | ------ | ----- |
| Vertical gap below Request Details (sparse left column) | **≈ 1,074 px** | **20 px** |

20 px matches the accepted uniform 20–21 px card rhythm established and measured throughout F058.2B, so the correction restores the accepted spacing rather than introducing a new value.

Grid track sizing is geometry and cannot be measured in jsdom. The committed test file states this limitation in its own header comment and deliberately asserts only what jsdom can establish truthfully — the declared stylesheet rules and the DOM composition that made the coupling observable. The rendered gap is browser evidence, recorded here rather than asserted in a unit test.

## Preserved

- **Accepted section order, unchanged**, asserted for both audiences: `Overview → Request Details → Actions → Request Management → Recent Activity → Additional Information → Request Evidence → Collaboration`.
- **Recent Activity stays last in the controls column**, directly below Request Management — the placement accepted during F058.2B manual UAT.
- **Grid placement of all four items is unchanged**: `.request-details` at `grid-column: 1; grid-row: 2`, `.request-column-controls` at `grid-column: 2; grid-row: 2 / span 2`, `.request-column-content` at `grid-column: 1; grid-row: 3`, `.request-overview` at `grid-column: 1 / -1`. The regression asserts each declaration exactly.
- **Column definition unchanged**: `minmax(0, 1.7fr) minmax(22rem, 1fr)`.
- **Responsive behavior unchanged.** The change lives entirely inside `@media (min-width: 1200px)`. Narrow and single-column layouts, the 1199.98 px list card breakpoint and every other accepted responsive rule are untouched.
- **Light and dark behavior unchanged.** No colour, surface, border or token changed; the regression asserts no `border` declaration was introduced into the desktop block or the affected selectors.
- **No reordering trick.** The regression asserts no `order` property appears on the layout, either column or any of the placed cards, so DOM, visual and focus order remain in agreement.
- **Activity presentation unchanged.** The F058.3 narrative cards (`Reason`, `Resolution`), and the routed event's `tone-routing` class, `bi-signpost-split` icon, routing destination and deliberate absence of a status badge, are all asserted to be unchanged in the sidebar preview.
- **No additional reads.** The regression asserts `detail`, `options`, `watchers` and `activity` are each called exactly once, that the Activity preview still requests `pageSize` 5, and that requester contact and requester history are **not** fetched. Protected data remains explicitly requested, never prefetched.

## Validation

`react/test/WorkspaceRowSizing.test.jsx` was added with this commit and contributes **nine test cases**:

| # | Case | Establishes |
| - | ---- | ----------- |
| 1 | Desktop row sizing keeps the trailing column-1 row flexible | `grid-template-rows: auto auto 1fr` present, `none` absent, columns unchanged |
| 2 | Desktop placement of both columns is unchanged | All four placement declarations exact |
| 3 | Columns stay top-aligned and the stale taller-side claim is gone | `align-items: start`, `align-self: start`, superseded comment removed, no border introduced |
| 4 | No CSS `order` property reorders the columns or their cards | DOM, visual and focus order agree |
| 5 | Sparse left column still renders both columns as independent siblings | The SR-202609-000013 reproduction: empty content column, populated controls column, no nesting, no inline heights |
| 6–7 | PUBLIC and INTERNAL composition keep accepted section order and Recent Activity last | Accepted order and controls-column tail for both audiences |
| 8 | Activity narrative cards and the routed event are unchanged in the sidebar | F058.3 presentation preserved |
| 9 | Layout correction introduces no additional protected reads | Call budget and no contact/history prefetch |

Focused and full React validation were run by the originating work before the commit, alongside the F058.3 suite. **Exact per-invocation pass and failure counts for this commit were not preserved in a durable artifact at the time**, so none are asserted here; this record reconstructs validation *scope* from the committed tests rather than restating counts it cannot evidence. The adjacent [F058.3 record](F058-3-workflow-activity-narrative.md) retains its own measured counts, its `IssueCreation.test.jsx` pre-existing flake, and its **NOT EXECUTED — 20 skipped** PostgreSQL result caused by an unconfigured `TEST_DATABASE_URL`. If the originating invocation logs are available, adding them to this record would complete the evidence set.

No backend, API E2E, PostgreSQL or shared suite applies: this commit changed one CSS declaration, one CSS comment block and one new test file. No production JavaScript, JSX, server, schema or migration file was touched.

## Manual UAT

**PASS.** Authenticated manual UAT confirmed the gap is closed on the sparse request shape and that the accepted workspace composition, card order, responsive behavior and light/dark presentation are unchanged.

## What constitutes the Accepted UI Baseline

Under [AGENTS.md](../../AGENTS.md), any screen, component or layout that has passed manual UAT is an **Accepted UI Baseline**, immutable unless a current feature explicitly authorizes changing a named area. `6732837d86dd5a03a3e7604d869bd156fd010fa5` is the checkpoint AGENTS.md names for the **Service Request List** and the **Service Request Workspace**. At that commit the baseline comprises:

**Service Request Workspace**

- The wide-screen four-item grid and its placement: Overview full width; Request Details in column 1 row 2; the controls column spanning column 2 rows 2–3; the content stack in column 1 row 3; `grid-template-rows: auto auto 1fr`; `minmax(0, 1.7fr) minmax(22rem, 1fr)`; top-aligned columns.
- DOM and visual order: `Overview → Request Details → Actions → Request Management → Recent Activity → Additional Information → Request Evidence → Collaboration`, with Recent Activity last in the controls column.
- Overview composition: `Request # → audience → Intake Channel → Status`, Department / Division before Service Category, then Assigned to and Reported; the Issue icon, category accent, reference, audience badge, status and the truthful PUBLIC/INTERNAL banners.
- The Actions card and its capability-derived lifecycle and routing buttons, rendered only from server-provided `workflowActions` and `canRoute`, and not rendered at all when nothing is authorized.
- Request Management rows in order: Assignment, Watchers, Requester Contact, Request Tracker, Requester History.
- Request Details, Additional Information and Request Evidence as separate cards with their existing protected, explicitly-triggered reads.
- Collaboration tabs and Recent Activity, including the F058.3 narrative card treatment (`Reason` for Hold and Reopen, `Resolution` for Close) in both the preview and full history, and the routed event's routing tone, icon and destination without a status badge.
- The uniform 20–21 px card rhythm, responsive behavior, light and dark presentation, keyboard and focus order, terminology and iconography.

**Service Request List**

- The nine-column desktop order `# | Issue | Request # | Audience | Status | Department / Division | Assigned to | Reported | Action`, semantic cards below 1199.98 px, and no horizontal table scrolling.
- Pagination-aware row numbering from the authoritative response, the dedicated Request # column with no duplicate reference in the Issue cell, the clickable Issue link and Service Location.
- The single-row search toolbar `Live Search | Sort By | Direction | Refresh`, the filter panel, and the 1760 px desktop content cap.

Also frozen, from F057: the Access & Permissions discovery table and its Manage Access menu and pagination, the View Access drawer, and the Configure Access draft, review and confirmation flow.

A future feature may add adjacent capability without restyling any of the above. Changing a named area requires explicit authorization in that feature's scope; if a feature appears to require it, **STOP and request approval**.

## Scope statement

No backend, API contract, repository projection, database, migration, SQL, permission key, grant, authentication, authorization, request revision, routing, assignment, watcher, tracking or attachment behavior changed. No dependency, package manifest or lockfile changed. No database was accessed. No deployment occurred. [ADR-024](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) is unaffected and remains **Proposed**.

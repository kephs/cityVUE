# F057.3 — Configure Access

Historical initial status: F057.3A–C implemented locally following explicit architecture approval on 2026-09-26; personal authenticated F057.3D UAT remains deferred. Starting checkpoint: main `f866fa21193174a4e053251fe70ec4c5f2b15048`, clean, synchronized. No commit, push, deployment, migration or personal grant is authorized by this work.

## Approved scope

Expose the existing atomic operational-role command through a strict desired-state PATCH with canonical string `expectedAuthorizationRevision` and `managedPermissionKeys`. Preserve Organization-first locking, current actor resolution, target eligibility, self prohibition, immutable audit, one revision per changed transaction and retained empty ownership. No Migration 40, preview endpoint or idempotency key. Reject new redundant managed grants and any change to the target's effective Access Administrator status, including indirect changes through configuration-read. Unknown/corrupted owned state blocks ordinary Save.

Configure uses the existing drawer, three copy-once presets (PUBLIC Request Viewer, PUBLIC Request Work, Issue Configuration), Custom Access, managed checkboxes and read-only outside contributions/memberships. Dependencies require explicit Add Required Access. Review precedes Save; sensitive additions receive one extra native Reqro confirmation. Dirty navigation/preset replacement and stale refresh require deliberate confirmation. Successful Save returns authoritative View Access; uncertain outcomes require refresh without automatic retry. History describes contribution changes, not reconstructed historical effective access.

## Personal UAT prerequisite and stop

Implement a separate explicit personal-development manager provisioning opt-in with local database, profile, personal tenant and existing mapped-target validation. Preserve synthetic-only defaults and Reader separation. Only a supported bootstrap dry-run is authorized for the existing personal Reader identity. Actual bootstrap, manage grant, manual UAT target creation and F057.3D remain blocked pending separate user approval. Bootstrap permanently establishes the last-manager invariant; later removal cannot restore bootstrap false or erase history.

## Validation

Backend unit/API/PostgreSQL, shared and React suites, type checking, configured lint/formatting and builds are required. PostgreSQL mutation tests use disposable test schemas only. Development authorization fingerprints must remain unchanged through the personal dry-run. Record results and limitations here before completion.

## Reviewable implementation slices

- **F057.3A — Atomic Managed Access Backend:** strict controller PATCH, existing locked foundation command, shared authoritative detail projection, structured safe errors, refreshed capability discovery. Effective Administrator status is compared before and after every desired-state command; operational changes to Administrators remain supported. Dependency and integrity validation run before no-op detection. Set-based writes, audit and revision triggers remain the only mutation model.
- **F057.3B — Configure Access Draft UX:** `ConfigureAccess.jsx`, pure `accessDraft.js`, existing Access drawer/list integration and focused CSS. Presets copy into local state and never provision authority. Outside-only permissions are effective and read-only; mixed permissions expose only managed contribution removal. Self/inactive/integrity-limited targets stay view-only.
- **F057.3C — Review / Sensitive / Concurrency:** contribution-aware review and history, single sensitive-addition confirmation, dirty exit guards, disabled in-flight actions, late-response suppression, structured dependency feedback and refresh-before-retry. Successful changed/no-op results return authoritative View Access, refresh discovery and reset history. Current filters and page position are preserved, with empty-page correction.

No dependency was added. Runtime branding, authentication architecture, migrations and controlled-provisioning ownership remain intact. F057.3D personal authenticated mutation, user-confirmed accessibility/responsiveness and logging UAT are outstanding and require separate authorization.

## Validation record — 2026-09-26

Passed: 317 backend unit tests; 41 API end-to-end tests; 472 disposable PostgreSQL tests with zero skips; 64 shared tests; 696 full React tests, followed by 13 focused tests after final keyboard/navigation refinements (two additional distinct tests; 698 current React tests). Total distinct coverage: 1,592 tests. The PostgreSQL suite includes real protected HTTP success, rollback, status preservation, same-revision competing saves, and synthetic personal provisioning dry-run coverage. Discovery scale tests retain eight statements per list request.

The initial broad database invocation inherited personal external-identity settings and failed fixture startup; rerunning with only the dedicated TEST_DATABASE_URL and test profile passed all tests. An initial unconstrained unit run timed out a logging subprocess; the bounded-concurrency rerun passed all 317 tests without weakening assertions. npm is unavailable on PATH, so configured script entry points were invoked directly through Node. Build chunk-size warnings remain informational.

Synthetic browser checks use a mocked client and full registry metadata, with no authenticated identity or database mutations. Personal UAT is not inferred from these checks. Final type/build/lint/format and dry-run evidence are recorded with the prerequisite report.

Final checks passed: backend typecheck and build; full backend ESLint and configured Prettier check; frontend production build; `git diff --check`. Synthetic Edge browser screenshots at 1440×1000 and 390×844 confirmed usable drawer/review layout, no horizontal overflow and no page errors. Temporary served fixtures were removed. No dependency or migration file changed.

The [personal manager prerequisite dry-run](F057-personal-manager-uat-prerequisite.md) passed: proposed revision 1→2 and only `admin.access.manage` under separate Administrator ownership. All 60 development tables remained unchanged; actual revision 1/bootstrap false/Reader authority remain intact. Work stopped for explicit provisioning approval.

## Subsequent provisioning approval and manual UAT handoff

The user subsequently approved the exact personal bootstrap and minimal synthetic target preparation. Execution and all 16 postconditions passed; see the [provisioning execution record](F057-personal-manager-uat-prerequisite.md). Current Organization revision is `2`, bootstrap true; only `admin.access.manage` was added through separate controlled ownership. The existing seed fixture Alex Example is the separate manual target, with no managed access and five outside permissions; no target writes were necessary. Local UI/API are responding. No runtime Configure Access mutation was performed; F057.3D awaits user-performed manual UAT. Source remains uncommitted.

## Presentation-only polish before first mutation UAT — 2026-09-26

At user request, Configure Access now presents an Access Overview card, Quick Setup with explicit draft-only help, plain outside-only permission labels and a read-only source note, accessible checkbox assignment wording, independent category source/change counts, and a clear zero-change/dirty footer. Department/Division values use plain-language context with scope nuance in a collapsed disclosure. Permission Details remain collapsed by default. Overlapping source counts are never added into an effective total.

Only ConfigureAccess presentation, its CSS, affected React assertions and this record changed in this pass. The desired-state PATCH, accessDraft calculations, preset expansion, dependencies, sensitive classification, source rules, eligibility, audit, revision, authorization and database/membership semantics were not changed. No database or Configure Access mutation occurred.

Validation: all 18 affected Configure Access / discovery / discovery-race React tests passed, including overlapping-source counts, effective totals, disabled zero-change Review, collapsed Details and keyboard focus restoration. Frontend production build and changed-file Prettier checks passed; the existing build chunk-size warning remains. Synthetic Edge checks at 1440×1000, 390×844 and 320×740 had no horizontal overflow or page errors; keyboard traversal, Review focus restoration, light/dark presentation and a dirty review were inspected. Browser fixture Save was never clicked. Temporary served fixtures were removed. Screenshots remain in ignored local scratch for visual review.

Stopped for final user visual review; F057.3 work remains uncommitted and F057.3D remains incomplete. No push or deployment.

## Final discovery/configuration usability refinement — 2026-09-26

Presentation-only follow-up adds shared frontend wording translations, plain-language source explanations and collapsed Technical details. Public/internal permission wording is sentence case; existing Quick Setup preset names remain as approved. The general Create requests permission retains its name because it is also a requirement for internal creation. Permission keys, metadata, permission calculations and preset expansion are unchanged.

The discovery table uses a single Manage Access menu based on the existing Reqro Issue-actions pattern. Server-supplied target eligibility controls whether Configure Access is present; View Access is always available. Arrow keys, Home/End, Escape, Tab and drawer-close focus restoration are supported. Menu focus avoids scrolling, and the portal is kept inside the viewport. Pagination presents a result range, bounded 25/50/100 size selector and Previous/Page/Next group, with deliberate stacking below desktop widths and unbroken Status labels. Server paging behavior is unchanged.

Validation: 23 affected React tests passed, including menu keyboard/focus, ineligible rows, page bounds/sizes, View/Configure presentation and async discovery races. Frontend build passed with the existing informational chunk-size warning. Formatting and whitespace checks passed. Synthetic Edge checks at 1440×1000, 1280×900, 1024×768, 768×1024, 390×844 and 1024×500 passed in both light and dark themes: no horizontal overflow or page errors, menus fit the viewport, Configure receives keyboard focus and Escape restores the trigger. View/Configure screenshots were inspected. No Save was clicked.

Read-only verification confirms Alex Example still has five effective outside permissions and zero managed permissions; Organization revision remains exactly `2`. No authorization, API, transaction, audit, revision, dependency, source, membership, preset or database semantics changed. Temporary served synthetic fixtures were removed. Stopped for manual visual review, with all work uncommitted; no push, deployment or F057.3D completion.

## Dependency presentation refinement — 2026-09-26

The user confirmed the first manual runtime Save, adding only Create requests to Alex Example. Subsequent read-only verification passed all 30 requested checks (revision 2→3, one operational ownership/role and one runtime audit/delta, original outside permissions and memberships intact).

Presentation-only dependency refinement replaces duplicate top/inline/global warnings with one Additional access required panel near the affected category. It lists missing requirements by selected permission and names the staff member. Checkboxes reference this panel; Review focuses it. Explicit Add Required Access still uses the unchanged requiredAccess result and setter; no automatic addition or Save is introduced. A presentation-only confirmation names the newly added draft prerequisites, announces Nothing has been saved yet, and receives focus. Further checkbox/preset changes or authoritative refresh clear that confirmation.

Refresh Access is shown only for stale-state handling, never ordinary draft validation. Existing uncertain/denied authoritative refresh remains available as Check Current Access; its refresh-before-retry behavior is unchanged. Dependency calculations, metadata, draft selections, preset expansion, authorization, API, transactions and audit are otherwise unchanged.

Validation: the 23 affected React tests passed, followed by 10 focused Configure Access tests including an additional Manage Issue Handling two-prerequisite case. Build, changed-file formatting and whitespace checks passed; existing build chunk warning remains informational. Synthetic browser checks at 1280×900, 390×844 and 1024×500 verified one warning, zero Refresh Access buttons, correct error association/focus, one confirmation after explicit addition, no lingering warning, no overflow and no page errors. No Save was clicked. Temporary served fixtures were removed.

Read-only baseline remains revision `3`, only `service_request.create` managed, the original five outside permissions unchanged, Public Works / Streets intact, and Alex not an Access Administrator. Stopped for manual review with all work uncommitted. No provisioning, push, deployment or database mutation occurred in this refinement.

## Sensitive confirmation presentation — 2026-09-26

The single sensitive-addition confirmation now uses plain language and the safe target display name, lists sensitive additions together, lists only newly added non-sensitive prerequisites as required access, and states that Department/Division access will not change. Any unrelated non-sensitive additions are separately labeled rather than misrepresented as prerequisites. Technical permission keys are never displayed. Final actions are Keep Reviewing and Grant Access. The shared confirmation description wrapper now supports semantic paragraphs/lists; modal behavior is unchanged.

Confirmation triggering, sensitivity metadata, dependency calculation, draft mutation, API and database behavior are unchanged. Presentation-only prerequisite grouping reads the existing metadata graph without editing it or the draft.

Validation: 28 affected React tests passed, including multiple sensitive additions, separate prerequisite lists, cancel focus, Tab containment and focus restoration. Frontend build and changed-file formatting passed (existing chunk warning only). Synthetic native-dialog browser checks at 1280 and 390 pixels confirmed initial Keep Reviewing focus, forward/reverse keyboard containment, Escape cancellation and return to Review's Save Changes button. Grant Access was never clicked; temporary served fixtures were removed. Read-only verification confirms revision `3` and only `service_request.create` managed for Alex. No database mutation occurred. All work remains uncommitted; stopped for review.

## Review Changes presentation redesign — 2026-09-26

Read-only AccessReview presentation groups additions (human descriptions, sensitive badges and dependency reasons), conditional removals with truthful mixed-source retention, unchanged outside access/memberships, and current/after totals. Outside permissions remain collapsed behind View permissions; existing managed access that stays is separately disclosed. Review uses changes ready to save, with the existing Back to Editing / Save Changes controls and sensitive confirmation. At phone width the values and badge/name rows stack. Draft calculations, metadata, desired-state API and mutation behavior are unchanged.

Validation passed: 28 affected React tests plus 15 focused review/confirmation tests after one additional Alex-specific regression (29 distinct affected tests), frontend build, changed-file formatting and whitespace checks. Synthetic Edge checks at 1280×1000, 390×844 and 1024×500 in light/dark verified no overflow or page errors, keyboard-operable collapsed outside permissions, safe sensitive-dialog focus and Escape restoration. Grant Access was never clicked; synthetic fixtures cannot reach the real mutation API and were removed after checks.

**Historical baseline discrepancy found during that read-only verification:** committed Alex was revision `4`, with nine effective permissions and four managed permissions: Create requests, View configuration, Manage Issues and Manage Issue Handling. The original five outside permissions, Public Works / Streets and non-Administrator status remained. Audit recorded one runtime update at `2026-09-26T17:08:57.937Z`, revision 3→4, with exactly the three new added keys; its actor matched the selected personal staff identity. The user subsequently confirmed this as expected manual UAT. That refinement issued no database/API mutation and did not revert or modify the event. The screenshots deliberately used the requested synthetic revision-3 draft for presentation review.

## F057.3D final validation — 2026-09-26

The [final validation report](F057-3D-final-validation.md) supersedes earlier live checkpoint statements. Accepted manual UAT and separately approved fixture cleanup left revision **9**, Alex with three managed/five outside permissions, and Jordan with zero managed/seven outside permissions and retained empty ownership. Final automated validation preserved all 60 live table fingerprints exactly. The report records every requested security/concurrency/UX check, 1,636 distinct tests with passing evidence after one isolated React timeout retry, current migration/history state and limitations. Presentation refinements hide empty additions, clarify contribution removal and stale conflicts, and improve dark-theme button contrast. No backend runtime semantics changed in this final pass. All source remains uncommitted; stopped for review without staging, push, deployment or live mutation.

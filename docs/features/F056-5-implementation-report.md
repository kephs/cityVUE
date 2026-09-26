# F056.5 — Implementation and validation report

Current follow-up: [post-UAT refinement](F056-5-post-uat-refinement-report.md) is implemented and validated locally with an explicitly approved governed-Availability migration. Earlier completion/no-migration statements below retain their original checkpoint scope.

Status: Complete atomic Add Issue follow-up validated locally. Authenticated UAT and logging privacy PASS; all pre-commit gates passed. No synchronization authorized. This report accompanies [the feature specification](F056-5-issue-management-workspace-ux.md). No push, deployment or F057 work is authorized.

## Complete atomic Add Issue follow-up — current checkpoint

The user confirmed the additional Inactive UAT Issue must be preserved: development baseline is 9 Issues (8 Active, 1 Inactive), 13 Service Requests, 16 answers and 36 migrations. No development database writes were made by the agent. The user also resolved §§281/372: sources remain active Reqro Intake Issues only; redirect sources are rejected in both lookup and creation tests.

Add now presents General (Category first, name, description, Priority), optional source copying, Intake & Access (Availability, Handling and any External Handoff, Service Location, Geographic Eligibility, requester policy), Assignment and the reused Follow-Up Questions editor. Category search is authorized, active-hierarchy scoped, parameterized and capped at 25 with a hasMore signal. Source lookup is similarly bounded and same-Category; full source configuration is loaded only for deliberate review. Aborted and superseded responses are ignored. A stale source catalog version returns a safe 409 and disables Create until explicit refresh/review. Category/source replacement protects copied draft edits; loading a source disables the controls it will replace.

| Creation setting             | Initialization / controls                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Category                     | Required searchable existing Category; no source-derived authority                                                                                                                                    |
| Priority                     | Explicit low / medium / high / urgent; source prepopulation reviewable                                                                                                                                |
| Service Location             | Explicit required / optional / not_applicable (Not Used); source reviewable                                                                                                                           |
| Geography                    | Explicit no_geographic_restriction only; null reference. No authoritative restricted-policy registry exists, so synthetic F045 provider support does not expose restrictions or a free-text reference |
| Availability                 | Explicit INTERNAL_ONLY / EXTERNAL_ONLY / INTERNAL_AND_EXTERNAL; immutable after creation                                                                                                              |
| Handling                     | Existing matrix: internal-only/dual intake, external-only intake or authorized redirect. Required redirect destination/message/label validated before persistence                                     |
| Icon                         | Blank file-earmark-text; eligible source retains existing icon-copy behavior; no arbitrary client icon                                                                                                |
| Aliases / keywords / routing | Empty arrays / empty arrays / null, including copy                                                                                                                                                    |
| Undetermined eligibility     | Existing block behavior; no new policy                                                                                                                                                                |
| Requester policy             | Existing IDENTIFIED_REQUIRED default or deliberate ANONYMOUS_ALLOWED; not copied                                                                                                                      |
| Assignment                   | None default, Category-based existing eligibility lookup; explicit eligible target only, not copied                                                                                                   |
| Display Order                | Existing zero initialization; administrator may choose a nonnegative integer; not copied                                                                                                              |
| Questions / options          | Empty unless authored/copied; existing eight types/editor, bounds and helpers; generated keys for new items, independent database rows, active initialization; no submitted answers copied            |
| Conditions / validation      | New items null; reviewed inherited metadata retained through authoritative source helpers; no unsupported authoring                                                                                   |

The former POST shape required templateId but omitted complete policy/handling/question decisions. The extended strict shape requires categoryId, availability, defaultPriority, locationPolicy, geographicEligibilityMode, handling and questions alongside existing core/requester/assignment fields. templateId and expectedSourceVersion are optional only as a valid pair. React and all repository test/service callers were migrated; the old incomplete wire shape is intentionally rejected. No external-client compatibility claim is made.

One existing AdminIssueService transaction validates/locks Organization, Category hierarchy, source version and assignment eligibility, inserts an Inactive Issue and independent published catalog, initializes requester policy and optional assignment, invokes configureIssueAction on that same transaction for redirect, and appends required audit. No preliminary Issue or second browser save occurs. Core revision remains 2 after the existing publication-pointer sequence; policy starts 1; absent assignment stays 0; intake action stays 1. Redirect legitimately advances action 1→2 with one F032 history/audit entry; there is no fabricated revision-1 history. Existing Configure, lifecycle, published snapshots and operational references remain unchanged.

Redirect retains Admin read + Issue write + catalog.issue_action.manage and Category Department/Division scope. Capability is advisory; the server reauthorizes the command. No new permission, schema, migration, grant or provisioning change. Audits preserve the existing minimal projections and destination hostname only; no new request-body logging, tracking, analytics or browser persistence. Source reads do not access protected submitted answers. [ADR-021](../architecture/decisions/ADR-021-complete-atomic-issue-creation.md) explicitly supersedes only the old creation workflow in ADR-019.

Validation so far: backend unit 305 passed; API E2E 40 passed; PostgreSQL integration 403 passed with zero skips; shared 64 passed; full React 666 passed, then 30 affected tests passed with stale-source/manual-policy/prerequisite guidance coverage. After the user-requested Handling reorder, all 17 focused Handling/creation tests passed. The final full React run passed 669 tests across 47 files; the subsequent 17-test focused run covers the final placement change and one additional ordering regression. Total distinct validated tests: 1,482. TypeScript and backend build passed; configured server lint passed; server formatting passed. The read-only migration CLI reports 36 applied / zero pending; no migration ran. PostgreSQL failure injection covers inserts into stable Issue, catalog, questions/options, policy/audit, assignment/audit, F032 history/audit, creation audit, and the F032 action update itself. Every failure compares all participating artifact fingerprints. Matrix, missing explicit choices, unknown fields, unsafe URLs, unsupported geography, missing permission/scope, stale Category/source/assignment and redirect-source rejection are covered.

Resolved live UAT finding: the user confirmed Trash & Recycling with External only Availability. A read-only aggregate confirms the development staff has action-management permission but does not have redirect Department/Division scope for Trash & Recycling. Other active Categories have scope. No grant changes are authorized. This explains the unavailable Handling selector without changing authorization. The user was asked to complete redirect UAT using an already-scoped Category. The user subsequently replied PASS to the complete UAT/privacy request.

The historical sections below retain their original validation context and are not completion claims for this follow-up.

## Earlier presentation-only polish evidence (superseded creation behavior)

Accepted parent: `5c58d9edbb3fda2fbbccd84c3e54791e53451c60`, unchanged and not amended. Started on clean main, one ahead/zero behind origin/main `498d6fc88dfd34cddab9be2481d1fda971d6eb21`; direct remote verification during polish still matched. The later approved atomic-creation extension combines this polish into one intended follow-up commit: `feat(admin): complete atomic issue creation workflow`. No push or deployment; F057 remains unstarted.

The polish changes five frontend files: IssueConfiguration, IssueDiscoveryControls, IssueHandling, IssueResults and issueWorkspace.css. Three existing test files cover read-only section semantics, clear-action styles, authoritative page/filter/sort numbering and the real Add/existing Handling distinction. Existing specification/report and governance checkpoint documents record the result. No backend or shared shell file changes.

All eight requested presentation refinements are implemented as described in the specification's polish section. Synthetic browser review confirms no horizontal overflow at 1440, 1280, 1024, 768 and 390 pixels in both themes. Wide desktop pagination is right aligned; narrow layouts retain labeled cards and logical wrapping. At 1920px the Issue workspace measured 1558px wide; navigating to Overview retained the existing 92rem main maximum and shell padding. Configure surfaces, fixed Availability, explicit Add Availability and authorized Handling selection were reviewed in light/dark. At 1280×500 the drawer body scrolls while its header stays available; at 390px it fills the viewport without horizontal overflow. Native radio state and textual indicators identify Handling without reliance on color. Keyboard Tab from the final drawer action returns to Close inside the modal. These are accessibility-oriented checks, not a WCAG certification.

Authenticated polish UAT is **not yet accepted**: the user reported that Handling stays Reqro Intake and External cannot be selected. Clarification is pending about Add versus Configure. The existing Add contract deliberately has no Handling selector; synthetic Configure for an authorized External only Issue does expose both choices. Do not treat the earlier base-feature PASS as acceptance of this follow-up.

Read-only development integrity comparison currently finds identical counts and sorted row fingerprints for all 56 public tables: 8 Issues, 13 Service Requests, 16 answers and 36 applied migrations. The migration CLI lists 36 applied/zero pending. No implementation database writes, new fixtures, grants or provisioning changes. The final read-only comparison also found no changed tables. Temporary synthetic pages, browser tab, integrity script/baseline and test/build logs were removed. Commit remains pending the UAT gate.

Completed automated checks: backend unit 305, API E2E 40, PostgreSQL integration 382 (zero skipped), shared 64, React 658 across 46 files: **1,449 passing tests**. TypeScript, configured server lint, server/changed-file formatting, backend build, frontend production build, relative documentation links, private-data/credential review and git diff --check pass. The initial React run found one incorrect new test assertion against an inner section; the enclosing-card assertion was corrected and the complete rerun passed. Frontend build retains the existing advisory about chunks above 500 kB; React retains the existing module-type warning. No dependency or module-system changes were introduced.

### Polish security/domain review (§161)

| #   | Question                                                                    | Verified answer                                                                   |
| --- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Did this polish add a migration?                                            | NO                                                                                |
| 2   | Did it change schema?                                                       | NO                                                                                |
| 3   | Did it add an API?                                                          | NO                                                                                |
| 4   | Did it add a permission?                                                    | NO                                                                                |
| 5   | Did it change grants?                                                       | NO                                                                                |
| 6   | Did it change provisioning?                                                 | NO                                                                                |
| 7   | Did it change Admin authorization?                                          | NO                                                                                |
| 8   | Did it change Organization scope?                                           | NO                                                                                |
| 9   | Did widening affect unrelated Admin routes?                                 | NO                                                                                |
| 10  | Are Clear Search and Clear Filters secondary actions?                       | YES                                                                               |
| 11  | Did their behavior change?                                                  | NO                                                                                |
| 12  | Is the row number presentation-only?                                        | YES                                                                               |
| 13  | Is row number persisted?                                                    | NO                                                                                |
| 14  | Is row number an Issue ID?                                                  | NO                                                                                |
| 15  | Does row numbering account for pagination?                                  | YES                                                                               |
| 16  | Can filtering/sorting change row number?                                    | YES                                                                               |
| 17  | Are drawer sections visual grouping only?                                   | YES                                                                               |
| 18  | Did section grouping change Save boundaries?                                | NO                                                                                |
| 19  | Is existing Issue Availability still immutable after creation?              | YES                                                                               |
| 20  | Does existing Availability look intentionally read-only rather than broken? | YES                                                                               |
| 21  | Can Add Issue still explicitly choose Availability?                         | YES                                                                               |
| 22  | Does Availability automatically determine Handling?                         | NO                                                                                |
| 23  | Does External Only automatically mean External Redirect?                    | NO                                                                                |
| 24  | Can External Only + Reqro Intake remain valid where F056.2B permits it?     | YES                                                                               |
| 25  | Is Handling visually prominent?                                             | YES                                                                               |
| 26  | Is Reqro Intake understandable without color?                               | YES                                                                               |
| 27  | Is External Redirect understandable without color?                          | YES                                                                               |
| 28  | Does Handling presentation match actual §37 architecture?                   | YES                                                                               |
| 29  | Was a fake Handling selector introduced?                                    | NO                                                                                |
| 30  | Was Handling persistence changed?                                           | NO                                                                                |
| 31  | Was Availability persistence changed?                                       | NO                                                                                |
| 32  | Was F032 persistence duplicated?                                            | NO                                                                                |
| 33  | Is F032 specialized authorization unchanged?                                | YES                                                                               |
| 34  | Is the Availability/Handling validation matrix unchanged?                   | YES                                                                               |
| 35  | Is page-size behavior unchanged?                                            | YES                                                                               |
| 36  | Is pagination still server-side?                                            | YES                                                                               |
| 37  | Is pagination right-aligned on wide desktop?                                | YES                                                                               |
| 38  | Does responsive pagination preserve logical reading/tab order?              | YES                                                                               |
| 39  | Does the wider table still use safe summary projection?                     | YES                                                                               |
| 40  | Did widening introduce full configuration hydration?                        | NO                                                                                |
| 41  | Did numbering introduce a per-row query?                                    | NO                                                                                |
| 42  | Did section styling introduce a new network request?                        | NO                                                                                |
| 43  | Is atomic Save unchanged?                                                   | YES                                                                               |
| 44  | Are independent revisions unchanged?                                        | YES                                                                               |
| 45  | Is stale 409 behavior unchanged?                                            | YES                                                                               |
| 46  | Is Add Issue template behavior unchanged?                                   | YES                                                                               |
| 47  | Does new Issue still start Inactive?                                        | YES                                                                               |
| 48  | Are lifecycle actions unchanged?                                            | YES                                                                               |
| 49  | Is Change Order unchanged?                                                  | YES                                                                               |
| 50  | Are Dynamic Questions unchanged?                                            | YES                                                                               |
| 51  | Is Requester Policy unchanged?                                              | YES                                                                               |
| 52  | Is Default Assignment unchanged?                                            | YES                                                                               |
| 53  | Is F056.4 Admin shell preserved?                                            | YES                                                                               |
| 54  | Did logging privacy pass?                                                   | PENDING authenticated polish acceptance; synthetic checks passed where applicable |
| 55  | Did responsive UAT pass?                                                    | PENDING authenticated polish acceptance; synthetic checks passed where applicable |
| 56  | Did light/dark UAT pass?                                                    | PENDING authenticated polish acceptance; synthetic checks passed where applicable |
| 57  | Did keyboard/focus UAT pass?                                                | PENDING authenticated polish acceptance; synthetic checks passed where applicable |
| 58  | Did accessibility-oriented UAT pass?                                        | PENDING authenticated polish acceptance; synthetic checks passed where applicable |
| 59  | Were temporary artifacts removed?                                           | YES                                                                               |
| 60  | Did private-data review pass?                                               | YES                                                                               |
| 61  | Was anything deployed?                                                      | NO                                                                                |
| 62  | Was F057 started?                                                           | NO                                                                                |

The sections below preserve the accepted base F056.5 report and its original 1,445-test evidence.

## Implementation and files

- `react/src/admin/IssueConfiguration.jsx`: retains the existing controller/commands, adds drawer state, loading/error handling, dirty/pending-close confirmation, authorized read-only configuration and pagination placement.
- `react/src/admin/IssueDiscoveryControls.jsx`: two-row desktop filters, integrated Clear Filters, separate blue Search Issues surface, mobile collapse and Clear Search.
- `react/src/admin/IssueResults.jsx`: semantic summary table, responsive labeled cards, existing category accents and lazy keyboard-operated Actions menus.
- `react/src/admin/IssueDrawer.jsx`: shared native modal drawer with fixed header, scrolling body and compact order variant.
- `react/src/admin/issueWorkspace.css`: locally scoped workspace styling using existing design tokens.
- `react/test/IssueConfiguration.test.jsx`, `IssueDiscovery.test.jsx`, `AdminConfiguration.test.jsx`: updated interaction expectations and regressions for drawer/menu/URL/race/permission/empty-state behavior.
- This report, the feature specification, context, architecture, roadmap and feature index document the checkpoint.

No backend, API, migrations, dependencies, permission registration, grants, provisioning, branding persistence, F056.4 shell component/CSS or other product surfaces changed.

## Baseline, integrity and authority

Started on clean `main`; HEAD, origin/main and direct GitHub main matched `498d6fc88dfd34cddab9be2481d1fda971d6eb21`. No earlier commit was amended. Intended local commit message: `fix(admin): redesign issue management workspace` with that parent. Full commit identity and final clean/ahead verification belong in the post-commit response, avoiding a self-referential hash inside its own commit.

Migration status before and after: 36 applied, zero pending; no F056.5 migration or schema change. The read-only migration CLI required an unsandboxed retry because tsx hit the existing Windows `os.userInfo` ENOMEM sandbox issue; only `status` ran.

A repeatable-read, read-only comparison of all 56 public development tables found identical counts and sorted row fingerprints after UAT. No protected values were printed. Conditions are counted from non-null question visibility conditions. No persistent F056.5 fictional fixtures were created, no development grant changed, and no history was deleted or rewritten.

| Resource                                      | Starting / final accepted count |
| --------------------------------------------- | ------------------------------: |
| Issues                                        |                               8 |
| Active / Inactive                             |                           8 / 0 |
| Catalog versions                              |                              13 |
| Questions                                     |                              31 |
| Options                                       |                              30 |
| Questions with visibility conditions          |                               5 |
| Answers / selected answer options             |                          16 / 0 |
| Service Requests                              |                              13 |
| Redirect history                              |                               6 |
| Issue configuration audit                     |                              15 |
| Issue action audit                            |                               6 |
| Default assignment audit                      |                               3 |
| Requester policy audit                        |                               4 |
| Protected-answer read audit                   |                               4 |
| Attachment audit                              |                              48 |
| Requester history audit                       |                               3 |
| Participation area / collection audit         |                           9 / 2 |
| Service participation audit                   |                              53 |
| Registered permissions / role-permission rows |                         30 / 40 |

All pre-existing accepted records, assignments, policy states, question versions, answers, redirect history, Participation and Requester Tracking data remain intact. The integrity comparison itself is not an operational protected-answer access and does not display answer values.

## Validation evidence

| Suite or gate                                                    | Result                                                                                                                                        |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit                                                     | PASS: 305                                                                                                                                     |
| API E2E                                                          | PASS: 40                                                                                                                                      |
| PostgreSQL integration                                           | PASS: 382, zero skips, disposable reqro_test only                                                                                             |
| Shared                                                           | PASS: 64                                                                                                                                      |
| React                                                            | PASS: 654 across 46 files                                                                                                                     |
| Unique total                                                     | PASS: 1,445; focused reruns are not counted again                                                                                             |
| Backend TypeScript check, test compilation and build             | PASS                                                                                                                                          |
| Configured backend ESLint                                        | PASS; no frontend lint script exists                                                                                                          |
| Backend configured Prettier check                                | PASS                                                                                                                                          |
| Changed frontend/document formatting                             | PASS                                                                                                                                          |
| Frontend production build                                        | PASS, final production build                                                                                                                  |
| Documentation links, whitespace, secret/private-data diff review | PASS: 284 local documentation links; no broken links or flagged secret patterns in 14 changed files; manual diff and whitespace review passed |
| Authenticated UAT / logging privacy                              | PASS, user confirmed in this task                                                                                                             |
| Data integrity                                                   | PASS, all 56 development tables unchanged                                                                                                     |

Commands use the installed Node CLIs equivalent to package scripts because npm is unavailable on PATH: backend `tsc -p tsconfig.test.json`, `tsc -p tsconfig.json --noEmit`, `tsc -p tsconfig.build.json`; compiled backend unit/E2E/database suites with `node --test --test-concurrency=1`; all eight root shared test files; `vitest run --config vitest.config.mjs --maxWorkers=1`; backend `eslint .` and the configured Prettier patterns; frontend `vite build react --outDir ../dist-react --emptyOutDir`. TEST_DATABASE_URL was loaded without printing its value and checked to target local reqro_test.

The first full React run exposed an obsolete empty-pagination assertion and a jsdom timeout in the 500-row test. Empty pagination now asserts 0–0 of 0, disabled previous/next and retained size control. Scale assertions are scoped to native rows and the final row; expected 500 records, no editor, two discovery requests and the original 15-second timeout remain. Focused reruns are diagnostic evidence, not additional test counts.

Existing Node module-type reparse warnings and the frontend large-chunk advisory remain build/tooling limitations, not changed dependencies or deployment work.

## Scale, browser and UAT

The existing PostgreSQL F056.1 suite generated 525 disposable Issues and checked complete bounded pagination, all five sizes through 500, normalization, stable sorting, projection privacy, filters and scope. The React fixture rendered 500 summaries with one summary request plus Categories, no N+1, no detail/question/Service Request hydration and no mounted drawer. Category accents use the already-loaded category ID; only the selected menu mounts.

A temporary synthetic browser harness rendered the actual AdminConfiguration/IssueConfiguration components with 500 rows in 875 ms from render start to two animation frames after the rows appeared. It showed no page overflow or mounted editor. The last row's Actions menu opened with Configure, Change Order and Deactivate, with one menu present. This is one local development-browser observation, not a production latency guarantee or authenticated backend benchmark.

Synthetic visual review and DOM geometry checks covered 1440, 1280, 1024, 768 and 390 pixels in light/dark themes. Menus stayed in the viewport; dialogs fit without horizontal content overflow. Desktop uses the semantic table, narrower layouts labeled cards. Drawer widths measured 782px at desktop root font size and full 768/390px at the smaller widths. At 768×450 the Add dialog stayed 450px high with a 365px scroll area containing 1510px of content. Header/Close remained available. Mobile Close wrapping and card action alignment were corrected during review.

User separately confirmed PASS for authenticated discovery, browser history, Actions, Configure/Add, dirty close, Change Order, lifecycle, permitted combined saves/conflicts, all requested sizes/themes/short-height, keyboard/focus and normal logging privacy. Synthetic checks do not substitute for that authenticated session.

A final native-browser keyboard check found boundary Tab moving to browser chrome. An explicit visible-enabled-control Tab loop was added and verified in both directions; Escape returned to Add Issue. A dedicated React regression covers this behavior.

Accessibility-oriented result: native modal dialogs with named headings, keyboard containment/background inertness, focus entry/return, dirty-close decision, menu roles and keyboard navigation, semantic table headers/caption, mobile field labels, textual statuses, labeled page size and disabled boundary controls. No WCAG certification claim. Normal logs did not newly expose configuration payloads, redirect/question configuration, Service Requests, contact/identity, submitted values, private locations, attachment paths, provider subjects, bearer tokens or tracking credentials/digests. Logs and protected values are not reproduced.

## Completion-report coverage (§534)

| Requested fields | Result / evidence                                                                                                                                                                                                       |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1–7              | Local commit identity and final main/clean/staged/ahead state supplied after commit; verified starting parent above.                                                                                                    |
| 8–15             | 36 applied / zero pending; no migration/schema/permission/grant/provisioning changes.                                                                                                                                   |
| 16–31            | All sixteen design stops resolved in the feature specification, with inspected source and preserved behavior.                                                                                                           |
| 32–39            | Six filters, Sort By, Direction; 4 then 4+Clear desktop rows; Clear preserves sort/direction/size; blue search below filters; Issue/Category names only, 300ms debounce and aborted obsolete queries.                   |
| 40–48            | Authoritative N Issues; Issue/Category/Availability/Handling/Status/Actions; safe projection, stable IDs, existing deterministic accents, human wording and one Actions button.                                         |
| 49–52            | Configure/Change Order/Deactivate for active writers; Activate for inactive writers. No Delete. Read-only View Configuration with no mutation controls.                                                                 |
| 53–60            | Rows per page below results, default25, 25/50/100/250/500, max500, existing server pagination, URL history, page recovery and latest-query reconciliation.                                                              |
| 61–62            | Distinct organization-empty and filtered-empty messaging; page size remains available with zero range and disabled navigation.                                                                                          |
| 63–77            | Shared native modal drawer; bounded desktop width/full mobile width; explicit loading/retry/denial; aborted stale details; dirty and pending close decisions; focus entry/return, Save Changes/Create Issue and Cancel. |
| 78–90            | General, Intake & Access, Assignment, Follow-Up Questions; immutable existing availability; existing F032/F048/F049 and Dynamic Questions components/commands. Multi-select, Date and Information semantics preserved.  |
| 91–99            | Existing AdminIssueService transaction, Organization row lock, four expected revisions, one request, shared transaction participants, rollback/audit/no-op/stale behavior preserved.                                    |
| 100–106          | Add uses same drawer, bounded searchable templates, fresh server eligibility and independent copies; explicit availability, Inactive creation and authoritative list reconciliation.                                    |
| 107–111          | Compact Change Order; nonnegative integer/ties; same stale/no-op controls and stable category/order/name/ID sorting. No drag/drop.                                                                                      |
| 112–117          | Activate validates fresh detail; Deactivate confirms; immutable history preserved. Filtered-out saves get review feedback; Refresh reloads authorized server results.                                                   |
| 118–122          | F056.4 shell unchanged; Organization scope and API authority unchanged; user privacy/logging PASS; identical audit fingerprints.                                                                                        |
| 123–131          | 525 disposable database fixtures, 500 maximum rendered rows, no N+1/detail/question/Service Request hydration. Measured local browser 875ms; one lazy menu and local category accent computation.                       |
| 132–146          | Five widths, short-height, light/dark, keyboard/focus, semantic table/cards/menu/drawer/pagination checked; user authenticated UAT PASS; no certification claim.                                                        |
| 147–160          | Exact test/check counts and passed final gates recorded in Validation evidence.                                                                                                                                         |
| 161–175          | F032/F048/F049/F052/F053/F054/F055/F056/F056.1/F056.2A/B/C/F056.3/F056.4 and broader regression coverage retained; all suites PASS, zero failures/skips.                                                                |
| 176–187          | Exact counts in integrity table; no persistent F056.5 UAT additions, no deleted history.                                                                                                                                |
| 188–190          | Shell/product branding, Participation and Requester Tracking unchanged.                                                                                                                                                 |
| 191–192          | Temporary harnesses, integrity artifacts and logs removed; local hooks inventory contains samples only, no core.hooksPath override, no .husky/.github automation. Local commit does not deploy/migrate/provision.       |
| 193–196          | Deferred features remain absent; no push, no deployment, F057 unstarted.                                                                                                                                                |

## Security questionnaire (§517)

Source review, unchanged server contracts, full regression gates, integrity fingerprints and the user UAT response support the requested answers. Questions 1–95 match the approved YES/NO answers: no persistence/authority expansion, bounded Organization-scoped discovery and lazy detail, existing independent revision/atomicity rules, lifecycle/history integrity, safe read-only behavior and native modality. Questions 96–100: YES, user-confirmed logging/responsive/theme/keyboard/accessibility-oriented PASS. Question 101: YES, disposable scale and maximum-page browser checks passed. Questions 102–104: YES, temporary artifacts removed, private-data review passed and all regression/check gates passed. Questions 105–106: NO deployment, NO F057 start.

| #   | Security / architecture question                                                                   | Answer |
| --- | -------------------------------------------------------------------------------------------------- | ------ |
| 1   | Did F056.5 add a migration?                                                                        | NO     |
| 2   | Did F056.5 change database schema?                                                                 | NO     |
| 3   | Did F056.5 add a permission?                                                                       | NO     |
| 4   | Did F056.5 change grants?                                                                          | NO     |
| 5   | Did F056.5 change provisioning?                                                                    | NO     |
| 6   | Did F056.5 change Admin authorization semantics?                                                   | NO     |
| 7   | Is Issue discovery still Organization scoped?                                                      | YES    |
| 8   | Is full Issue configuration still Organization scoped?                                             | YES    |
| 9   | Is template search still Organization scoped?                                                      | YES    |
| 10  | Does the table use a safe summary projection?                                                      | YES    |
| 11  | Does the table hydrate full configuration for every row?                                           | NO     |
| 12  | Does the table hydrate Dynamic Questions for every row?                                            | NO     |
| 13  | Does the table hydrate Service Requests?                                                           | NO     |
| 14  | Does the table expose Requester Contact?                                                           | NO     |
| 15  | Does the table expose submitted answers?                                                           | NO     |
| 16  | Does the table expose private Service Locations?                                                   | NO     |
| 17  | Does the table expose tracking credentials?                                                        | NO     |
| 18  | Is Live Search still server-side?                                                                  | YES    |
| 19  | Were F056.1 searchable fields broadened?                                                           | NO     |
| 20  | Are filters still server-side?                                                                     | YES    |
| 21  | Is sorting still server-side?                                                                      | YES    |
| 22  | Is pagination still server-side?                                                                   | YES    |
| 23  | Is page size bounded?                                                                              | YES    |
| 24  | Is there an unlimited All page-size option?                                                        | NO     |
| 25  | Does changing page size broaden authorization?                                                     | NO     |
| 26  | Does Clear Filters preserve approved semantics?                                                    | YES    |
| 27  | Is Search Issues below filters?                                                                    | YES    |
| 28  | Is Search Issues immediately above results?                                                        | YES    |
| 29  | Is page size removed from the filter panel?                                                        | YES    |
| 30  | Is page size located with pagination?                                                              | YES    |
| 31  | Does the desktop table use only approved summary fields?                                           | YES    |
| 32  | Does Issue name use stable Issue identity?                                                         | YES    |
| 33  | Is Category safe summary data?                                                                     | YES    |
| 34  | Is Availability human-readable?                                                                    | YES    |
| 35  | Is Handling human-readable?                                                                        | YES    |
| 36  | Is Status human-readable?                                                                          | YES    |
| 37  | Is there one Actions control per row?                                                              | YES    |
| 38  | Is Delete absent?                                                                                  | YES    |
| 39  | Does Configure load full configuration only on demand?                                             | YES    |
| 40  | Can an unauthorized caller gain Issue write authority through the new UI?                          | NO     |
| 41  | Does read-only behavior match the existing authorization model?                                    | YES    |
| 42  | Does External Redirect still require the accepted specialized writer permissions?                  | YES    |
| 43  | Did F056.5 duplicate F032 persistence?                                                             | NO     |
| 44  | Did F056.5 duplicate F048 assignment persistence?                                                  | NO     |
| 45  | Did F056.5 duplicate F049 requester-policy persistence?                                            | NO     |
| 46  | Did F056.5 create a second Dynamic Question subsystem?                                             | NO     |
| 47  | Are existing Issue revisions still independent?                                                    | YES    |
| 48  | Was a fake global Issue revision introduced?                                                       | NO     |
| 49  | Are immutable catalog versions preserved?                                                          | YES    |
| 50  | Is the actual Save behavior accurately represented as atomic only if §109 verified it?             | YES    |
| 51  | If atomic Save exists, can one participating failure leave another participating change committed? | NO     |
| 52  | Are stale revisions still rejected?                                                                | YES    |
| 53  | Is stale configuration surfaced without silent overwrite?                                          | YES    |
| 54  | Does a no-op Save avoid unnecessary churn?                                                         | YES    |
| 55  | Is existing Issue Availability still immutable after creation where required?                      | YES    |
| 56  | Are valid Availability/Handling combinations unchanged?                                            | YES    |
| 57  | Does External Redirect remain separate from Reqro Intake?                                          | YES    |
| 58  | Is Default Assignment behavior unchanged?                                                          | YES    |
| 59  | Is Requester Policy behavior unchanged?                                                            | YES    |
| 60  | Are Dynamic Question types unchanged?                                                              | YES    |
| 61  | Is Information still no-answer?                                                                    | YES    |
| 62  | Is Multi-select behavior unchanged?                                                                | YES    |
| 63  | Is Date behavior unchanged?                                                                        | YES    |
| 64  | Does Add Issue still use searchable templates?                                                     | YES    |
| 65  | Does template creation still produce independent resources?                                        | YES    |
| 66  | Does new Issue creation still start Inactive?                                                      | YES    |
| 67  | Is template eligibility revalidated at Create?                                                     | YES    |
| 68  | Is Change Order still a nonnegative integer?                                                       | YES    |
| 69  | Are order ties still allowed?                                                                      | YES    |
| 70  | Is Category grouping preserved?                                                                    | YES    |
| 71  | Is order → name → stable ID preserved?                                                             | YES    |
| 72  | Was drag-and-drop ordering introduced?                                                             | NO     |
| 73  | Does Deactivate preserve Issue identity/history?                                                   | YES    |
| 74  | Does Reactivate preserve existing validation?                                                      | YES    |
| 75  | Is Delete still unavailable?                                                                       | YES    |
| 76  | Does opening the Actions menu create a backend mutation?                                           | NO     |
| 77  | Does opening the Configure drawer create a configuration audit?                                    | NO     |
| 78  | Does closing the Configure drawer create a configuration audit?                                    | NO     |
| 79  | Do successful mutations retain existing audit behavior?                                            | YES    |
| 80  | Does the drawer protect unsaved changes?                                                           | YES    |
| 81  | Does the drawer prevent stale Issue A data from rendering for Issue B?                             | YES    |
| 82  | Does a modal drawer prevent background keyboard interaction?                                       | YES    |
| 83  | Does closing return focus appropriately?                                                           | YES    |
| 84  | Does mobile avoid a narrow desktop drawer?                                                         | YES    |
| 85  | Does mobile avoid a squeezed desktop table?                                                        | YES    |
| 86  | Are Actions accessible by keyboard?                                                                | YES    |
| 87  | Is Status understandable without color?                                                            | YES    |
| 88  | Is Availability understandable without color?                                                      | YES    |
| 89  | Is Handling understandable without icons?                                                          | YES    |
| 90  | Is the F056.4 Admin shell preserved?                                                               | YES    |
| 91  | Is the Reqro brand lockup preserved?                                                               | YES    |
| 92  | Was branding persistence changed?                                                                  | NO     |
| 93  | Was Requester Tracking changed?                                                                    | NO     |
| 94  | Was Participation configuration changed?                                                           | NO     |
| 95  | Were protected Service Request answers accessed for Issue management UAT?                          | NO     |
| 96  | Did logging privacy pass?                                                                          | YES    |
| 97  | Did responsive UAT pass?                                                                           | YES    |
| 98  | Did light/dark UAT pass?                                                                           | YES    |
| 99  | Did keyboard/focus UAT pass?                                                                       | YES    |
| 100 | Did accessibility-oriented UAT pass?                                                               | YES    |
| 101 | Did scale/performance checks pass?                                                                 | YES    |
| 102 | Were temporary F056.5 artifacts removed?                                                           | YES    |
| 103 | Did private-data review pass?                                                                      | YES    |
| 104 | Did all required regression suites pass?                                                           | YES    |
| 105 | Was anything deployed?                                                                             | NO     |
| 106 | Was F057 started?                                                                                  | NO     |

No new configuration, dependency, environment variable, migration or manual setup is required. Existing staff sign-in and authorization remain the prerequisites.

## Deferred scope and next step

No destructive Delete, bulk operations, drag/drop, custom columns, saved views, advanced query builder, request-volume analytics, per-Issue Service Request counts, Last Used, import/export, new Dynamic Question/redirect/assignment/requester-policy subsystem, availability redesign, access/role/user/grant management, or F057.

All pre-commit gates are green. Temporary harnesses, integrity scripts/baselines and logs were removed. The single local commit records this accepted checkpoint; its full hash and final main/parent/clean/empty-staging/ahead verification are supplied in the completion response. Stop for review. GitHub synchronization requires separate explicit authorization; no deployment or post-commit database/UAT work.

UAT refinement: the user selected Trash & Recycling with External only Availability. Read-only scope inspection confirms that Category is outside the current staff redirect-management scope; the unavailable choice preserves F032 authorization. Add now explains missing Availability/Category or insufficient access. Per the user, Handling is directly below Availability, followed by External Handoff when selected, then Service Location and Geographic Eligibility. No grant change. Authenticated UAT and logging privacy subsequently passed.

Synthetic browser review of the current creation components with shared Admin styles confirmed final Availability → Handling order at 1440/1280/1024/768/390 in light and dark, no horizontal overflow, 1280×500 scroll access, Category keyboard selection and focus on the selected Change button, dirty-close confirmation, and final-action Tab returning to Close inside the modal. These are synthetic accessibility-oriented checks, not authenticated evidence or WCAG certification. The 56-table read-only development comparison remained identical to the confirmed nine-Issue baseline before the final manual UAT.

## Final follow-up gates and limitations

The user confirmed PASS after the scope explanation and Handling reorder. The post-UAT read-only comparison again found **zero changed tables out of 56**: 9 Issues (8 Active / 1 Inactive), 13 Service Requests, 16 answers, 36 applied migrations / zero pending. The user's existing Inactive UAT Issue is retained; no new development fixtures or operational artifacts were introduced by this work. Authorization/grants, tracking, participation, branding, attachments, answer snapshots, action history and protected-read audit data are unchanged. No migration command or provisioning mutation was executed.

TypeScript checks and backend production build pass. Server lint and formatting pass. Frontend production build passes with the existing >500 kB chunk advisory; React retains the existing module-type warning. No frontend lint script is configured. Relative changed-document link checks and credential-pattern review pass; final git whitespace/staged review accompanies the commit. The migration status CLI needed execution outside the sandbox because its Windows user-profile lookup failed inside it; it was read-only and reported all 36 executed migrations. Direct read-only remote verification still returns `498d6fc88dfd34cddab9be2481d1fda971d6eb21`.

Changed file groups: creation domain/DTO/routes/service and shared assignment validation; existing drawer/Handling/question editor plus two creation-picker/source components; retained discovery/result/CSS polish; strict creation and atomic-failure database fixtures/tests, React regressions and unit-call compatibility; feature/governance documents and creation-only superseding ADR-021. No dependencies, schema, environment variables, deployment configuration or permission catalogs changed.

Limitations: restricted geography has no authoritative configured selection source and remains unavailable for creation; no new icon/routing/condition editor; source copying is active Reqro Intake only; redirect still requires existing Category scope. No production scale/readiness claim follows from disposable development timings. Existing F045 location semantics, protected-answer access and immutable historical schemas remain authoritative. No manual setup is required beyond existing staff authentication and permitted scope. Temporary harnesses, logs and integrity artifacts are removed before the one local commit; the final response records its actual hash and clean/ahead verification. Stop for review; do not push, deploy or begin F057.

### Creation lookup contracts and retained state

All four new GETs are authenticated, no-store, require existing Admin read and Issue write, and perform no writes/audits: `/api/v1/admin/issues/creation/categories?search=…`; `/creation/sources?categoryId=…&search=…`; `/creation/sources/:id?categoryId=…`; `/creation/assignment-targets?categoryId=…&search=…` under that same Admin Issues prefix. Category/source search uses a 100-character bound, deterministic ordering and 25 results plus hasMore. The selected source read returns only reviewable catalog configuration. Assignment reuses the fixed six type/audience eligibility queries, not per-result hydration. Existing lightweight Issue summaries and server pagination are unchanged; no N+1 list expansion. These are bounded-query checks, not production-scale performance certification.

| Development artifact                          |      Before |       After |
| --------------------------------------------- | ----------: | ----------: |
| Issues / Active / Inactive                    |   9 / 8 / 1 |   9 / 8 / 1 |
| Catalog versions                              |          14 |          14 |
| Questions / options / condition definitions   | 32 / 30 / 5 | 32 / 30 / 5 |
| Answers / selected-option rows                |      16 / 0 |      16 / 0 |
| Service Requests                              |          13 |          13 |
| Issue action states: intake / redirect        |       8 / 1 |       8 / 1 |
| Redirect history / action audits              |       6 / 6 |       6 / 6 |
| Issue configuration audits                    |          16 |          16 |
| Requester policies / audits                   |       9 / 5 |       9 / 5 |
| Default assignments / audits                  |       3 / 4 |       3 / 4 |
| Protected-answer read audits                  |           4 |           4 |
| Role-permission rows / staff-role assignments |      40 / 4 |      40 / 4 |
| Applied / pending migrations                  |      36 / 0 |      36 / 0 |

The post-UAT whole-table hashes prove the counts did not conceal edits. The single pre-existing Inactive UAT Issue is preserved. No credentials/private values appear in this report. No active Git hooks or GitHub workflow directory were present; no automation was changed or externally triggered. No Firebase, Azure, Entra, DNS, external-provider, production/client resource or deployment change occurred. F032, F045, F048, F049, F052–F056.5 regressions are covered by the established complete suites. F056.3/4 remain synchronized historical checkpoints; F056.5 is complete locally and not synchronized; F057 remains unstarted.

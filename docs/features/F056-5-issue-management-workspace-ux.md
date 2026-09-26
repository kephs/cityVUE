# F056.5 — Issue Management Workspace UX

Current follow-up: [post-UAT refinement](F056-5-post-uat-refinement-report.md) is implemented and validated locally with an explicitly approved governed-Availability migration. Earlier completion/no-migration statements below retain their original checkpoint scope.

Status: COMPLETE LOCALLY — NOT SYNCHRONIZED. All pre-commit gates and authenticated UAT passed. No push or deployment authorized.

## Scope and baseline

Presentation refinement of `/admin/issues`, preserving the F056.4 Admin shell and all existing configuration commands. Started from clean `main`, matching local `origin/main` and GitHub at `498d6fc88dfd34cddab9be2481d1fda971d6eb21`. F056.4 is complete and synchronized. F057 remains unstarted.

No API contract, persistence, migration, schema, permission, grant, provisioning, dependency, branding persistence, Requester Tracking, Participation, or cloud change.

## Resolved design stops

| Request section | Inspected result and decision                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §9              | Existing Issue sizes are 25, 50, 100, 250, 500; default 25, maximum 500. Preserve them. The separate Service Request maximum remains 100.                                             |
| §25             | Existing authorized summary supplies all six approved columns: Issue, Category, Availability, Handling, Status, Actions. No new projection or query required.                         |
| §107            | Preserve component-local editor state; discovery remains in URL search parameters. No editor route or query key added.                                                                |
| §108            | Reuse native dialog modality and existing confirmation approach; extract one reusable IssueDrawer for Configure, View Configuration, Add Issue and compact Change Order.              |
| §109            | Verified the existing atomic transaction in AdminIssueService.change; retain one PATCH and four independent expected revisions.                                                       |
| §110            | Existing admin.issues.write controls mutation UI; server remains authoritative. External handling retains catalog.issue_action.manage plus existing scope rules.                      |
| §111            | Existing authorized read projection supports View Configuration. No mutation controls or assignment-target lookup for read-only users.                                                |
| §112            | Existing active boolean provides human Active/Inactive wording; no status lookup or new state semantics.                                                                              |
| §113            | Reuse IssueIcon and deterministic categoryId accent; no metadata fetch.                                                                                                               |
| §114            | Wide desktop: four filters first row, four controls plus Clear Filters second row. Wrap to two columns, then collapsible single-column mobile.                                        |
| §115            | Preserve pageSize query parameter, normalization, page reset, authoritative totals and server bounds. Move only its visible location.                                                 |
| §146            | Lifecycle remains separate actions; do not add a status checkbox to Configure.                                                                                                        |
| §148            | Existing Issue order is edited only through Change Order, eliminating duplicate editing. Add Issue retains its initial order input. Existing payload still carries the current order. |
| §198            | Preserve normal page scrolling and the F056.4 header; no sticky nested results container. Drawer has an independently scrolling body and visible header.                              |
| §227            | Label is Rows per page, beside pagination below results.                                                                                                                              |
| §258            | Preserve existing deactivation confirmation and immediate validated activation. No new confirmation rule or lifecycle API.                                                            |

## Discovery and results

Filters remain server-side AND predicates: Availability, Handling, Status, Category, Requester Policy and Assignment. Sort By and Direction remain. Clear Filters clears search and predicates, resets page to one, and preserves sort/direction/page size. Clear Search clears search only and resets the page through the existing debounce.

The blue-accented Search Issues surface follows filters, immediately before result feedback and the table. Search remains trimmed, bounded to 100 characters, debounced 300 ms, and searches only Issue or Category names. Existing AbortController and query identity protection remain.

The semantic table renders safe summaries only, keyed by stable Issue ID. Category name, human availability, Reqro Intake/External Redirect and textual Active/Inactive are visible. No description wall, raw revision identifiers, per-Issue request counts, private data, questions or full configuration are hydrated for discovery. Smaller screens use the same table DOM styled as labeled cards.

One Actions button per row opens one menu at a time. Configure is first, followed by Change Order and Activate/Deactivate for writers. Read-only users get View Configuration. Menu opening performs no API call or mutation. Arrow keys, Home, End, Escape and Tab are supported; menu positioning is measured and clamped to the viewport. Outside interaction, scrolling and resizing dismiss it. Delete is absent.

Pagination retains 25/50/100/250/500, default 25, maximum 500, authoritative total/range, Previous/Next, page recovery and URL Back/Forward/Refresh. Empty results still expose page size with 0–0 of 0 and disabled navigation. Organization-empty and filtered-empty messages remain distinct.

## Drawers and configuration

The native modal dialog is at most 46rem or 90vw on desktop and full width at 800px or below. It occupies the viewport height; its header remains available while content scrolls. Change Order uses a compact centered dialog. No global shell style changes are required.

Existing Issue actions fetch fresh authorized detail before editing. Loading, retryable failure, unavailable Issue and 401/403 denial have explicit handling. Closing aborts detail loading, preventing late responses from reopening the drawer. Unauthorized detail/save clears protected UI state and rechecks Admin authority.

Configure groups the established fields into General, Intake & Access, Assignment and Follow-Up Questions. Existing immutable availability, requester policy, assignment, redirect and dynamic-question controls are reused. External Redirect hides intake-only configuration without deleting its values. Information remains no-answer; Multi-select, Date and visibility conditions retain established validation and immutable catalog-version behavior.

Dirty close, Cancel and Escape require a discard decision. Cancel in that decision keeps the draft. Initial focus enters the editor, errors receive focus, clean close returns to the initiating action, and successful reconciliation focuses the saved row or status fallback. Native modality keeps background controls inert; an explicit Tab boundary loop keeps keyboard traversal within visible enabled drawer controls. A submitted save is single-flight; closing during it requires an explicit decision and explains that closing does not cancel the server mutation. No autosave or silent replay is introduced.

Add Issue reuses bounded searchable templates and existing server-side eligibility revalidation. Creation copies independent resources, requires an explicit availability, and starts Inactive. Change Order remains a nonnegative integer with ties allowed and existing category/order/name/stable-ID sorting. Lifecycle actions use fresh detail and preserve identity/history. Successful mutations reload the authoritative current query; an out-of-filter saved Issue has an explicit review action.

## Atomicity and authority

[AdminIssueService](../../server/src/admin/admin-issue.service.ts) owns the existing Kysely transaction. It selects the Organization-scoped stable service_definition row FOR UPDATE; compares core, action, policy and assignment revisions; invokes the existing policy, assignment and optional handling helpers on the same transaction; publishes immutable catalog/question versions as needed; validates active configuration; and writes the existing audits before commit. Failure rolls back participating resources. No-op saves preserve revision/audit state. Stale 409 blocks retry until explicit discard/refresh. No global revision or replacement persistence layer is introduced.

See the [implementation report](F056-5-implementation-report.md) for test counts, browser/UAT evidence, data integrity and release boundaries.

## Presentation polish follow-up (2026-09-25)

This follow-up starts from accepted local commit `5c58d9edbb3fda2fbbccd84c3e54791e53451c60` and must remain a separate local commit. It changes presentation only; no backend, API, schema, migration, permission, grant, provisioning or domain change is authorized. Authenticated polish UAT remains pending clarification of the reported Handling selection behavior.

The Issue route alone removes its 68rem content cap and uses smaller, bounded desktop side padding. The main-container override requires a direct `.issue-configuration` child; other Admin routes keep the existing shell width. Title/actions, filters, search, results and pagination share that wider space. Clear Filters and Clear Search are outlined secondary buttons with theme-aware text/borders. Their handlers, disabled state and reset semantics remain unchanged.

Desktop columns are Result Number (#), Issue, Category, Availability, Handling, Status and Actions. Result Number is `(page - 1) * pageSize + index + 1`, using the authoritative response page and page size. Page two at 25 rows begins at 26. Filtering and sorting can renumber an Issue; the number is neither an identifier nor persisted. Stable Issue IDs still key rows. The accessible header says Result Number; narrow cards hide this optional column. Numbering adds no query or configuration hydration.

General, Intake & Access, Assignment and Follow-Up Questions use restrained bordered section surfaces and existing semantic headings. Availability and Handling are subordinate headings. Grouping does not change backend resources or the existing atomic save transaction. Existing Availability is shown as a fixed value with “Availability is set when the Issue is created.” Add still requires an explicit Internal only, External only, or Internal and external selection.

Design stops §§36–37: the existing creation transaction copies an eligible template into independent resources, creates an Inactive Issue, and uses the existing Reqro Intake default. It does not accept Handling at creation. Therefore Add presents Reqro Intake intentionally, explains its consequence and directs staff to create an External only Issue, then configure Handling before activation. No fake selector or new creation semantic is introduced. External only plus Reqro Intake remains valid; Availability does not derive Handling. External Redirect remains available through Configure only for eligible existing Issues and existing specialized authority. The F056.2B matrix and F032 authorization/persistence are unchanged.

Handling uses a prominent labeled surface: Reqro Intake means “Requests are created and managed in Reqro.” External Redirect means “Users continue in an external service.” Authorized existing Handling radios retain native semantics, with a selected border, background and textual check indicator. Read-only users retain a clear current-value presentation.

The entire existing pagination group aligns right at wide desktop widths, wrapping naturally and aligning left at 800px or below without CSS reordering. Rows per page remains first, followed by authoritative range, Previous, page status and Next. Issue sizes remain 25/50/100/250/500, default 25 and maximum 500; Service Request pagination remains independently capped at 100. No URL, server-side pagination, stable sorting, recovery or race-protection contract changes.

## Superseding Add Issue decision (§§181–567)

Implementation in progress under [ADR-021](../architecture/decisions/ADR-021-complete-atomic-issue-creation.md). The user approved complete atomic creation with explicit Category/Priority/Location/Geography, optional same-Category reviewed source, questions and F032 Handling in one transaction. This supersedes the earlier polish section’s default-only Add Handling description. Source eligibility remains active Reqro Intake only; redirect sources are rejected by explicit clarification. The additional user-created Inactive Issue is preserved in the baseline: 9 Issues, 8 Active/1 Inactive, 13 requests, 16 answers, 36 migrations. Earlier polish remains uncommitted and will accompany this extension only after all gates pass.

UAT refinement: the user selected Trash & Recycling with External only Availability. Read-only scope inspection confirms that Category is outside the current staff redirect-management scope; the unavailable choice preserves F032 authorization. Add now explains missing Availability/Category or insufficient access. Per the user, Handling is directly below Availability, followed by External Handoff when selected, then Service Location and Geographic Eligibility. No grant change. Authenticated UAT and logging privacy subsequently passed.

Completion: full automated regressions and final focused ordering tests pass; user authenticated UAT/privacy PASS; all 56 development tables unchanged against the confirmed nine-Issue baseline. See the implementation report for exact validation counts and limitations. No migration, grant/provisioning change, push, deployment or F057.

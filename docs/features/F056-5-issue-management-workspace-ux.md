# F056.5 — Issue Management Workspace UX

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

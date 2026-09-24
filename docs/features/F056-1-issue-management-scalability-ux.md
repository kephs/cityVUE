# F056.1 — Issue Management Scalability & UX

Implementation from synchronized F056 `36065c0693b4855fe3587576bf327aef31f7bbaf`. Validation and commit gates are recorded in the [completion report](F056-1-implementation-report.md). This is a local development refinement; no push, deployment, F057 or dynamic intake authorization.

## Scope and compatibility

Issues now use server-side discovery and lightweight paginated summaries, URL-backed controls, fresh configuration on action entry and an independently searchable intake-template picker. The existing `GET /api/v1/admin/issues?page=…` response remains unchanged for F056 consumers. Its 25-row full configuration projection is not the new discovery API. The F052 administration snapshot remains a separate bounded compatibility resource.

New protected read endpoints:

| Endpoint                                      | Response                                                                                                                           |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/admin/issues/summaries`          | `items`, filtered `total`, `organizationTotal`, Organization `active`/`inactive` counts, normalized `page`, `pageSize`, `canWrite` |
| `GET /api/v1/admin/issues/categories`         | Organization-scoped Category `id`/`name` choices, ordered by configured order/name/id                                              |
| `GET /api/v1/admin/issues/templates?search=…` | Up to 25 eligible template `id`/`name`/`category` summaries and `hasMore`                                                          |
| `GET /api/v1/admin/issues/:id`                | `{ issue }` with the authoritative F056 editable resource and its independent revisions                                            |

Every endpoint requires normal Entra validation, trusted active staff/Organization context and `admin.configuration.read`; no grant is added. Writes still require both Admin read and `admin.issues.write`. All responses are `no-store`. Query DTOs reject unknown keys and repeated-array values. Browser Organization identifiers never establish scope.

Summary fields are limited to stable `id`, `name`, `categoryId`, `category`, `active`, `displayOrder`, `requesterPolicy` and a safe nullable `assignmentLabel`. No descriptions, editable revision bundle, template form, historical version collection, requests, requester/contact information, provider identifiers, assignment identities or membership collections are included. Only the current published version is joined for presentation and the existing requester-policy fallback. Assignment labels use the established safe staff-name expression and scoped role/team names; unavailable configured labels have a neutral fallback.

## Discovery contract

All supplied filters combine with AND inside the trusted Organization scope, before counting and pagination.

| Parameter         | Accepted values / default                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------- |
| `search`          | Trimmed, at most 100 UTF-16 code units; rejects control characters; default empty                    |
| `status`          | `all` (default), `active`, `inactive`                                                                |
| `category`        | Scoped Category UUID; omitted means all; foreign/unknown well-formed UUID returns no matching Issues |
| `requesterPolicy` | `all` (default), `IDENTIFIED_REQUIRED`, `ANONYMOUS_ALLOWED`                                          |
| `assignmentState` | `all` (default), `assigned`, `none`                                                                  |
| `sort`            | `default`, `name`, `category`, `order`, `status`, `policy`, `assignment`                             |
| `direction`       | `asc` (default), `desc`                                                                              |
| `page`            | Positive safe integer; default 1; beyond-last normalized to last nonempty page or 1 for no results   |
| `pageSize`        | 25 (default), 50, 100, 250, 500; no unlimited All                                                    |

Search is a literal case-insensitive substring of Issue name or Category name only. It uses PostgreSQL `strpos(lower(column), lower(parameter))`; `%`, `_`, backslashes and quotes are literal data, with no SQL or wildcard interpretation. Unicode lowercasing follows the database locale; accent folding, transliteration and fuzzy search are not promised. Description search is not implemented. SQL identifiers/direction are chosen from internal allowlists, never interpolated from arbitrary input.

Default sort preserves configured Category order, Category name/id, Issue order and Issue name. Explicit sorts and tie rules:

| Sort         | Primary; secondary ordering                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| `default`    | Category order/name/id, Issue order/name use requested direction                                                |
| `name`       | Issue name in requested direction; Category name, Issue order ascending                                         |
| `category`   | Category name in requested direction; Issue order/name ascending                                                |
| `order`      | Numeric Issue order in requested direction; Issue name, Category name ascending                                 |
| `status`     | Inactive before Active ascending; Issue name, Category name ascending                                           |
| `policy`     | Anonymous allowed before Identification required ascending; Issue name, Category name ascending                 |
| `assignment` | Safe assignment display label in requested direction, None first ascending; Issue name, Category name ascending |

Every ordering ends with stable Issue UUID ascending. PostgreSQL collation determines lexical label ordering. Ties remain valid; ordering is presentation only and never normalizes persisted values. Counts and page rows share a read-only repeatable-read transaction. Cross-request offset pagination is deterministic for a stable catalog; concurrent catalog edits can change page membership, so this is not a catalog snapshot token or atomic multi-area reorder contract.

## Interface and navigation

The `/admin/issues` page has a prominent Add issue action and search, clearly labeled filters/sorting/page size, counts and compact summary rows. Edit is primary; numeric Change order and activation/deactivation remain explicit secondary actions. At narrow mobile widths, a keyboard-accessible disclosure groups filters, sorting and page size; search, Clear filters and results stay readily available. Rows and actions wrap; no horizontal table scrolling is required.

Search is debounced 300 ms. Each list and template request aborts on supersession/unmount and ignores results after cancellation, including a transport that resolves despite abort. Filter, sort and page-size changes reset page 1. Stale list rows are hidden while loading; controls remain stable. Errors retain query controls and offer Refresh/retry. Empty Organization and zero matching Issues are distinguished.

Recognized query parameters live in the URL; defaults are omitted, malformed/unknown values normalize safely, and server page normalization replaces rather than adds history. Back, Forward, refresh and direct navigation restore the list state. Clear filters resets search/status/Category/policy/assignment/page while preserving sort, direction and page size. The URL is for non-sensitive configuration discovery, not request content, Contact, tokens or protected mutation drafts. Do not enter secrets into search.

Add/Edit remains a focused inline form to preserve the established F056 flow. Opening Edit, Change order or state change fetches authoritative detail before composing a command. Failed detail loading cannot open an editor or issue a mutation. Save continues to submit all four F056 expected revisions; no change to locking, 409 handling, atomic audit or immutable version creation. On success the current query is fetched again; rows leaving the filter disappear. A saved Issue outside the current page has a direct Review saved Issue action rather than forcing it into unrelated results. Cancel restores the initiating control when present, with a safe focus fallback. List context is preserved; unsaved drafts remain in memory only.

The Add-only template combobox independently searches eligible Issues across the Organization, including beyond the current list page/filter. Empty search has deterministic bounded results; truncation says to keep typing. Arrow keys move the active option, Enter selects, Escape closes, Tab follows normal focus order. Selected name/Category and Change template are explicit; changing template does not overwrite name, description, policy or order drafts. Selection uses stable Issue identity and does not create inheritance or audit. The unchanged F056 Create transaction revalidates eligibility, copies the current approved template fields and creates an inactive independent Issue. An inactive Issue/Category/Department/Division, non-internal-intake action or unpublished version is ineligible.

## Query and regression decisions

No migration/index was created or applied. A disposable 525-Issue fixture and representative `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` plans informed the decision; see measured observations in the report. Discovery uses three fixed SQL reads (Organization counts, filtered count, page) rather than per-row API hydration. Counts do not join assignment display labels. Direct scoped label joins replaced an early union-label join that the planner repeatedly scanned. PostgreSQL may choose indexed nested loops within one statement; that is distinct from application N+1 requests.

Scale tests also exposed alias shadowing in the existing effective requester-policy fallback for an Issue without an explicit policy row. The fallback subquery now has distinct aliases so it refers to the intended outer stable Issue. Explicit policy values and domain semantics are unchanged. F048–F056 regression tests cover the retained contracts, and the new synthetic detail check exercises this fallback.

## Threat model and limits

| Threat                                               | Mitigation / residual limit                                                                                                                                    |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-Organization Issue/Category/template discovery | Server-derived Organization on every join/query; foreign Category yields no matches; detail unavailable is generic                                             |
| Unauthorized discovery or writes                     | Existing Entra/active-context/read permission on each read; independent existing write authorization remains                                                   |
| Search/sort/URL injection                            | Strict DTO, bounded values, parameterized literal substring, static SQL allowlists; UI normalization is convenience only                                       |
| Oversized pagination/excessive cost                  | Explicit five sizes capped at 500, validated safe page, normalized offset, minimal projection; substring scanning is still proportional to scoped catalog size |
| Response races / wrong principal cache               | Abort plus ignore-stale guards, query-scoped state and auth teardown, no-store; already-disclosed authorized content is not retroactively erased               |
| Stale template/detail                                | Fresh detail on action; unchanged Create revalidation and optimistic mutation revisions; no silent conflict replay                                             |
| Projection expansion/membership disclosure           | Exact summary/template projection tests; safe label joins only; no membership enumeration in discovery                                                         |
| Raw search logging                                   | Existing structured allowlist logs route templates, not URL query/body/results; authenticated live check required before commit                                |
| N+1/rendering cost                                   | Fixed query count; no per-summary detail calls or mounted editors; automated 500-row rendering and real-browser fixture review                                 |
| Stable pagination during concurrent changes          | UUID tie-breaker prevents ambiguous stable-catalog ordering; concurrent edits can still change offset page contents                                            |

Synthetic local timing is development evidence, not a production load benchmark or availability guarantee. Page size 500 means a long scroll; 25 remains the default. Categories remain a scoped configuration-choice list, not a request-history download. Existing authenticated identity/token infrastructure is untouched; no new browser persistence or permission is introduced.

## Deferred work

Dynamic follow-up questions, question types/schema/conditions, external redirects/URL/handling-mode controls, workflow/SLA/escalation, new routing, destructive deletion, bulk operations, exports, saved views and F057 are unimplemented. A future Issue Intake & Redirect feature remains a candidate requiring its own approved scope. Existing F056 template copying does not constitute a new dynamic-form editor.

# F047 — Service Request Live Search

Status: implemented and locally validated; automated checks, authenticated UI UAT, live logging privacy and data integrity passed. See the [validation record](F047-implementation-report.md).

## Purpose and scope

Extend the existing staff Service Request list with live server-side search. Start from clean synchronized `main` at `f54f1e612117e4213825a3d8499c8632b76df31f`, following F046. The development checkpoint has 23 migrations, zero pending, three retained finalized fictional attachments and 1 active / 5 revoked tracking credentials. F047 grants no permissions, performs no development-data mutations and starts no F048 work.

## Contract

`GET /api/v1/staff/service-requests` accepts optional scalar string `q`. The existing `search` parameter remains an exact, case-insensitive Reference filter; when both are supplied they are ANDed. No endpoint, response field or permission is added.

| Rule             | Behavior                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Fields           | Persisted human Request Reference, versioned Issue display name, displayed Service Location only                                             |
| Normalization    | Trim leading/trailing JavaScript whitespace; preserve internal whitespace, punctuation and Unicode                                           |
| Bounds           | Empty/whitespace means no search. Nonempty terms need at least 2 and at most 160 UTF-16 code units; the raw input is bounded before trimming |
| Matching         | PostgreSQL case-insensitive literal substring, OR across the three fields; a multiword term is a single phrase                               |
| Literal symbols  | Escape backslash, `%` and `_` before adding surrounding substring wildcards; bind every pattern as a SQL parameter                           |
| Unicode          | PostgreSQL database collation controls case matching; no accent removal, transliteration, fuzzy matching or tokenization                     |
| Invalid requests | Malformed scalar/array/object, excessive length or a one-unit nonblank term receives safe HTTP 400; no input echo                            |
| Debounce         | 300 ms after typing; one-character input displays guidance without making a broad replacement query                                          |
| Result shape     | Existing minimized staff-list projection; no additional protected fields                                                                     |

Service Location reuses exactly the existing display expression: trimmed nonblank normalized address, otherwise trimmed nonblank entered address, otherwise null. The non-displayed alternative address is not searched. No requester-contact address is substituted.

## Authorization and excluded domains

The query starts with trusted Entra staff identity, active Organization, effective Department/Division scope and independently permitted persisted audiences. PUBLIC requires `service_request.view`; INTERNAL requires `service_request.internal.read`. The audience selector and All/My Requests/My Team/Watching only narrow that relation. Assignment, watchers and operational membership never grant read authority. SQL optimization may reorder physical operations; logically every result and count must satisfy all authorization and search predicates.

Do not search technical UUIDs, description/narratives, Contact names/email, Notes, Communications, attachment filenames/metadata/content/storage, Activity, assignment/watch identities/history, tracking credentials/digests/state, audit metadata, or identity/development metadata. The search predicate references none of those tables or fields. Existing assignment projection/sort/view logic remains separate and does not become a search operand. The search path accesses no attachment storage or tracking endpoint.

## List behavior

- Search composes with audience, work view, status, Department, Division, exact Reference and all/assigned/unassigned filters. Search changes reset page to 1.
- Count and rows use the same scoped filtering method before ordering and paging. Existing explicit Issue/Reference, status, Department/Division, assignment and Created sorts remain; UUID descending remains the deterministic final tie-breaker.
- Default page size is 25 and API maximum is 100. Search does not filter only the current browser page. Row numbers remain `(page - 1) × pageSize + index + 1`; they are not identifiers.
- Clear search applies immediately, resets page 1, preserves other applied controls and returns focus to the search field. Reset clears all query/filter/sort/page state using existing defaults. Refresh reloads the current settled query and controls; it does not clear search.
- Search lives above the existing filter form. Its visible label is **Search requests**, with placeholder **Search reference, issue, or service location**. It is outside the form, so Enter does not submit unrelated draft filters. The exact Reference control retains its explicit-submit behavior.
- AbortController plus the complete serialized query key prevent late responses from replacing newer searches, filters, sorts or pages. A pending/invalid input hides old rows/counts. Filter options remain mounted during loading; settled counts use a status live region. Loading, no matches, access errors and network/server failures remain distinct.
- The current URL retains `q`, consistent with other list state and detail/back navigation. Each settled query can enter browser history. Clear/Reset and browser back/forward cancel pending debounce. No local/session storage, search-history database, analytics or per-search security audit is introduced.

## Privacy and operations

Search text can contain a precise Service Location. URL state may therefore be sensitive operational data in browser history or copied links. Avoid sharing such URLs. Existing API operational logging records safe route metadata rather than raw request URLs/query strings; automated API tests inspect captured log output for a synthetic location marker. F047 does not add query logging or analytics.

When bearer authentication is present but a sandbox-launched local API cannot retrieve Microsoft signing keys, run authenticated UAT against the developer-launched API outside that restricted sandbox. This is an authentication/environment failure, not permission/RBAC failure. Never change grants or weaken token validation to compensate; never print or decode bearer credentials.

## Query strategy and performance

Use parameterized `ILIKE` against the existing joined Issue version and a correlated location expression shared with display. The existing count and row queries remain two database round trips; the workspace also retains its options request. No application-level per-result fetch or new N+1 round trip is introduced. The location subquery can execute within PostgreSQL per candidate/result row.

Read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` on eight local requests showed sequential Service Request scans; location's unique request index and Organization/catalog indexes were used, with existing ownership indexes in the row projection. Three terms yielded count times of 0.167–0.446 ms and list times of 0.393–0.837 ms. These small local observations are not load testing or production-scale readiness.

Leading-wildcard substring predicates generally cannot use ordinary B-tree indexes for text matching. Candidate scans and exact counts become more expensive as authorized volumes grow; page-size bounds limit returned rows, not all count/filter work. Debounce reduces request frequency, not each query's cost. Existing offset pagination can shift under concurrent writes and costs more for deep pages. No migration, trigram/full-text index, relevance ranking, dependency or external search service is justified by this development evidence. Reassess with representative load before production growth.

## Validation and completion gates

The [implementation report](F047-implementation-report.md) records passed automated validation, authenticated visual/functional UAT, integrity checks and user-confirmed live logging privacy. Local completion does not imply deployment or production readiness.

Issue-Based Default Assignment, anonymous submissions, identity/history, geographic participation, production attachment storage/scanning and requester attachment presentation remain deferred. F048 remains unassigned and not started.

# F069.1 — Department administration read API foundation

Status: implementation and offline validation complete; ready for the authorized local commit. PostgreSQL execution and frontend integration are deferred.

## Source and scope

The isolated `codex/f069-department-read-api` worktree at
`C:\Users\stKyle\reqro-worktrees\f069-department-read-api` starts exactly at
`0dbfd2404fc8997e20bca93432ca8d968e164495` (PR #71's verified F069 UI/refinement HEAD).
The existing UI worktree remains unchanged. No migration, grant, dependency,
authentication infrastructure, frontend, remote or deployment change is included.

The canonical catalog migration and database types confirm Organization-owned
Departments, Department-owned Divisions, Categories belonging directly to a
Department with an optional Division, and Category-owned Service Definitions.
Department/Division descriptions are nullable; Category descriptions are strings.
All three catalog resources support active, inactive and archived status.
There is no Department revision field. Operational teams, assignment and routing
are separate resources.

## HTTP contract

All routes are under `/api/v1/admin/departments`:

| Method | Suffix                      | Response                       |
| ------ | --------------------------- | ------------------------------ |
| GET    | (none)                      | Paginated Department summaries |
| GET    | `/:departmentId`            | One Department summary         |
| GET    | `/:departmentId/divisions`  | Paginated Division summaries   |
| GET    | `/:departmentId/categories` | Paginated Category summaries   |

A page is `{ items, total, page, pageSize }`. Total is the count after search and
status filtering, before pagination; an out-of-range page returns an empty items
array and the actual total. No page is silently clamped.

Department summary: `{ id, name, description, status, displayOrder,
divisionCount, categoryCount }`. Division summary: `{ id, departmentId, name,
description, status, displayOrder }`. Category summary: `{ id, departmentId,
divisionId, name, description, status, displayOrder, iconKey,
serviceDefinitionCount }`. Optional divisionId and nullable descriptions remain
JSON null, not omitted. No raw rows or unbounded nested collections are returned.

Counts include **all lifecycle statuses** of direct related records within the
same Organization and parent, independently of collection filters. Service
Definition counts count canonical definitions, including unpublished definitions,
not versions or available resident services. No draft content, version metadata,
assignments, staff identities, grants, timestamps or revisions are exposed.
Category aliases/keywords are omitted because this foundation does not edit them.

Collection query parameters (all other parameters rejected):

- `page`: canonical positive decimal integer, default 1, maximum 10000.
- `pageSize`: 10, 25 (default), 50 or 100.
- `search`: maximum 100 UTF-16 code units before trimming; control characters,
  malformed surrogate text, arrays and objects rejected. Case-insensitive literal
  substring matching against name and description. `%`, `_` and backslash are
  literal characters, not SQL patterns.
- `status`: all (default), active, inactive, archived.
- `sort`: displayOrder (default), name, status; status sorts lexically.
- `direction`: asc (default), desc.

Every order has an ascending ID tie-breaker. Sort fragments and table choices
are static allowlists; values are parameters. Detail accepts no query parameters.
Malformed UUIDs return 400; valid unavailable or cross-Organization IDs return the
same safe 404, including relationship endpoints. Empty existing relationships
return a successful empty page.

## Security and read consistency

All routes retain `StaffAccessGuard`, `@RequireEntra()` and
`@RequirePermission('admin.configuration.read')`. Normal token validation and
provisioned active staff resolution remain authoritative. The service repeats
`assertConfigurationRead` and rejects development fallback identities. Ordinary
request permissions do not confer access. Operational Department/Division
membership does not restrict or expand this Organization-level authority,
consistent with ADR-014.

Every query derives tenancy from `access.organizationId`. The service checks an
active Organization inside the same repeatable-read, read-only transaction used
for the parent check, totals and rows. Counts correlate both Organization and
parent IDs. There are no client-selectable tenants or mutation routes. Responses
set `Cache-Control: no-store`; the existing global sanitized error boundary and
configured database statement timeout remain in force. There are no grants,
provisioning, audits, row locks, row/sequence writes or automatic migrations.

Each HTTP request is one snapshot; separate page requests may observe later
commits. This follows existing configuration-read semantics, not the operational
request-write coordination protocol. Correlated counts remain in one bounded
page statement; there is no application-level per-record query loop.

## Validation and remaining gates

Offline tests cover strict query validation, SQL parameterization and scope,
transaction intent, service identity denial, inactive Organization denial, safe
not-found, existing error sanitation, and actual controller/guard/service HTTP
admission using synthetic token and database doubles. HTTP tests use ephemeral
local listeners, not the existing API or frontend services. Token doubles do not
constitute Entra UAT; SQL recording does not prove PostgreSQL execution.

`server/test/database/admin-department.integration.test.ts` is compiled but NOT
EXECUTED in this milestone. It uses the existing disposable TEST_DATABASE_URL
pattern, verifies the dedicated `reqro_f0592_test` / `reqro_test_user` database identity, creates a unique schema, and
uses only synthetic fixtures. It covers two Organizations, active/inactive/
archived Departments, separate parent Divisions/Categories, optional Division,
literal search, stable pages, scoped totals and aggregates, safe cross-tenant
404s, unchanged catalog rows, and PostgreSQL read-only enforcement. Its fixture
writes and schema setup/cleanup require separately authorized execution; none
occurred during implementation.

Before frontend integration: independently review the contract/security; authorize
and execute disposable PostgreSQL coverage; perform authenticated Entra UAT;
then separately authorize replacing the fictional-preview boundary. F069 UI
remains preview-only. Mutations require separate permission, concurrency, audit
and lifecycle decisions. No production readiness or accessibility certification
is claimed here.

## Completed offline validation

- Focused compiled unit invocation: `node --test admin-department.test.js admin-department-http.test.js admin-configuration.test.js` from `server/dist-test/test/unit`: **37 passed**, zero failed/skipped.
- Full compiled backend unit tier: `node --test` from `server/dist-test/test/unit`: **1179 passed**, zero failed/cancelled/skipped. Focused tests are included in this total, not additional distinct tests.
- `npm run typecheck`, `npm run build`, and `npm run lint` in `server`: passed.
- `node server/node_modules/typescript/bin/tsc -p server/tsconfig.test.json`: passed, including the strengthened disposable-database identity guard. Database tests were compiled only.
- Scoped Prettier checks for all changed backend files and the new feature document: passed. `git diff --check`: passed.
- Unmodified `npm run format:check` reported 530 untouched CRLF-checkout files. A read-only LF-normalized check found zero substantive formatting differences in those files. `npm run format:check -- --end-of-line auto` passed repository-wide without modifying configuration or unrelated files. The original invocation remains a recorded failure, not a clean pass.
- Initial development compilation found a missing name/tokenVersion in a synthetic principal; initial lint found seven new type-import/test-style issues. Those were corrected without relaxing tests. A transient file lock and one incorrect command working directory prevented an intermediate edit; the corrected compilation and checks above passed.

Dependencies were installed from the existing backend lockfile only in this
worktree, with lifecycle scripts disabled. No dependency or lockfile changed.
No Docker command, PostgreSQL test, migration, seed, live API/E2E suite or
persistent database connection was executed. No F067 worktree/service, API3001,
frontend5174, Entra configuration, Azure or production resource was changed.
GitHub was inspected read-only; no branch push, PR creation or merge occurred.

Exact source/test file allocation:

- `server/src/admin/admin-department.controller.ts`
- `server/src/admin/admin-department.domain.ts`
- `server/src/admin/admin-department.queries.ts`
- `server/src/admin/admin-department.service.ts`
- `server/src/admin/admin.module.ts`
- `server/test/helpers/admin-department.fixture.ts`
- `server/test/unit/admin-department.test.ts`
- `server/test/unit/admin-department-http.test.ts`
- `server/test/database/admin-department.integration.test.ts`
- This feature record and `docs/features/README.md`.

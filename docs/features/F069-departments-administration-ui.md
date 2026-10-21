# F069 — Departments Administration UI foundation

Status: frontend implementation and offline validation complete; prepared for the authorized local commit. No live Department management is enabled.

## Scope and verified baseline

Repository: `kephs/cityVUE`. Codex Desktop's existing isolated worktree is
`C:\Users\stKyle\.codex\worktrees\21d9\cityVUE`, reused without creating a second
worktree. Starting HEAD, local `origin/main`, and a read-only `git ls-remote`
check of current remote `main` all matched
`68672415dfa0c56debdbc3a7d157ce06c997e6d0`. The initial tree and index were clean,
with zero commits ahead/behind `origin/main`. The Desktop checkout initially
had detached HEAD; `codex/f069-departments-admin-ui` was created there.
No existing F069 branch or feature record was found.

The task authorizes frontend implementation, offline validation, and one local
commit after successful validation. No backend changes, migrations, persistent
data writes, identity/permission changes, remote writes or deployments.

## Verified domain

The canonical catalog migration
`server/migrations/20260902000000-create-organization-service-catalog.ts` and
`server/src/database/database.types.ts` establish:

- Organization owns Department through `organization_id`.
- Department has `name` (varchar 200), nullable `description` (text), `status`
  (`active`, `inactive`, `archived`) and nonnegative integer `display_order`.
  Names are unique within the Organization. IDs and timestamps are server-owned.
- Division belongs to a Department with an Organization-aware composite foreign
  key. It is not an operational Role/Team or a participation area.
- Category belongs to a Department and optionally a Division in that Department.
  A Division is not required between Department and Category.
- ServiceDefinition belongs to Category. Published versions hold service content
  and routing metadata; existing operational request routing and assignment are
  separate contracts. This UI makes no authoritative routing claim.

No Department revision column or administrative Department write contract was
found. Public catalog categories expose only partial resident catalog labels;
they cannot supply a complete administrative directory, inactive departments or
authoritative relationship inventory. The Admin configuration snapshot also
lacks such a directory. Neither is repurposed to infer it.

## Interface and data boundary

`/admin/departments` uses the existing `/admin/:section?` route and Admin shell.
The existing `StaffRouteGuard requireEntra`, authenticated configuration GET and
server `admin.configuration.read` checks are preserved. Loading, safe errors,
401/403 denial and retry use the existing shell. Department content mounts only
after this read succeeds; a changed client/account or denied refresh removes it.
No new permission, grant, tenant identifier or authentication fallback exists.

The initial state explicitly says live Department administration is unavailable.
An administrator may deliberately open a fictional preview. No sample records
are combined with tenant data. Every count, directory and relationship is
labeled fictional, with no municipality-specific branding.

`departmentPreview.js` is a documented frontend boundary with a fresh fixture
factory and field validation. It has no network client, storage adapter or
mutation transport. A future authoritative adapter must replace this boundary,
not append real data to the fictional list.

The preview provides summary counts, name/description search, all/active/inactive/
archived filtering, display-order and name sorting, responsive directory cards,
details, read-only Division/Category/ServiceDefinition examples, and empty states.
Operational routing is explicitly unavailable. Theme colors come from existing
Bootstrap tokens, with textual status labels in addition to color.

Creation defaults to inactive as a conservative preview choice, not a new server
default. The form permits only verified Department fields. Name validation trims
input, enforces 1–200 Unicode characters and exact-name uniqueness in the preview;
this does not invent a case-insensitive database uniqueness policy. Display order
must be an integer from 0 to PostgreSQL integer maximum 2147483647. Description
has no invented schema limit. No relationship editing is offered.

“Apply local preview” updates component memory only, and explicitly reports that
nothing was saved to a server. Leaving the section or reloading discards it.
Dirty drafts warn on reload and route navigation. Cancel, Close and Escape offer
Keep editing or explicit Discard changes. Existing native modal drawer and
confirmation components provide keyboard containment; focus enters the heading
and returns to the invoking control, or the directory heading if filtering
removed that control. Invalid submission announces errors and focuses the first
invalid field. There is no Save or Publish control.

## Future bounded backend milestone

First approve a Department administration read contract: trusted staff-derived
Organization, explicit administrative permission/scope policy, bounded paging,
search/filter/sort, minimized fields, authoritative relationship projections,
no-store responses and denial/error semantics. Add read-only endpoints and
tenant-isolation tests before replacing the unavailable state. Public catalog
visibility is not administrative authority.

Writes require a separately approved permission and grant policy, resource
revision model (and separately authorized migration if necessary), expected-
revision conflict handling, server validation, atomic immutable audit,
Organization-aware relationship checks, and explicit lifecycle-impact rules for
inactivation/archiving. Authorization must be rechecked server-side. No API path,
new permission key, migration or write implementation is invented by F069.

## Validation and limitations

Executed with the bundled Node v24.19.0 runtime and locked local frontend
dependencies. `npm` was initially absent from PATH. The first offline install
using the located npm CLI failed on sandbox access to the existing cache; the
authorized elevated retry of `npm ci --offline --ignore-scripts --no-audit
--no-fund` succeeded (348 packages). Dependencies were installed only in this
worktree; no manifest or lockfile changed and no install lifecycle scripts ran.

- `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 react/test/DepartmentsConfiguration.test.jsx react/test/AdminConfiguration.test.jsx react/test/IssueConfiguration.test.jsx`:
  **3 files, 65 tests passed; zero failures or skips**, one focused invocation,
  50.58 seconds. This is not a repository-wide suite total.
- `node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir`:
  **passed**, 365 modules, with the Vite advisory about chunks over 500 kB and
  plugin timing diagnostics. No thresholds or build settings were changed.
- Existing Prettier tooling was copied read-only into ignored local tooling and
  used to format/check the five new JSX/JS/CSS/test/feature files: **passed**.
  The two existing files retain their surrounding formatting to avoid unrelated
  churn. There is no configured frontend lint or formatting script; server lint
  is not a frontend check and was not run.
- `git diff --check`: **passed**. Reviewed the exact source, documentation and
  test file set for scope, generated artifacts, credentials and mutation paths.

Tests cover navigation, loading/denied/error states, client changes and stale
authorization responses, opt-in fictional data, summaries, search/filter/sort,
empty states, field validation, create/edit previews, no network/storage writes,
truthful nonpersistence feedback, reload reset, unload and route blocking,
Cancel/Keep editing/Discard, focus restoration, keyboard activation, cancel
events and read-only relationships with and without a Division.

This milestone is an offline frontend foundation. Authenticated manual UAT,
browser visual/responsive review and native browser focus containment were not
executed; jsdom tests do not establish those results or accessibility
certification. No Docker, PostgreSQL or backend integration suite was run.
No persistent database, F067 source/worktree/UAT harness, running service on
3001 or 5174, original checkout source, Git remote, Azure or production resource
was modified. No push, PR, merge, provisioning or deployment was performed.

## Exact feature file allocation

- `react/src/admin/AdminConfigurationPage.jsx`: section registration and gated mount only.
- `react/src/admin/DepartmentsConfiguration.jsx`: directory, detail, forms and draft guards.
- `react/src/admin/departmentPreview.js`: isolated fictional examples and verified field validation.
- `react/src/admin/departmentsConfiguration.css`: scoped responsive/theme presentation.
- `react/test/DepartmentsConfiguration.test.jsx`: focused component/authorization regressions.
- `docs/features/F069-departments-administration-ui.md`: scope, domain, evidence and next milestone.
- `docs/features/README.md`: feature index entry.

No setup or environment-variable changes are required. To review manually, use
normal staff authentication with existing Admin configuration read authority,
open `/admin/departments`, and choose **Open fictional preview**. Do not provision
new authority or bypass sign-in for this milestone.

Related: [Admin authorization](../architecture/decisions/ADR-014-administrative-configuration-authorization.md),
[F052](F052-organization-administration-foundation.md),
[development protocol](../development/REQRO_CODEX_PROTOCOL.md).

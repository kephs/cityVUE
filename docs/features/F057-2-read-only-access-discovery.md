# F057.2 — Read-Only Access Discovery

Status: COMPLETE LOCALLY — NOT SYNCHRONIZED. Baseline: synchronized F057.1 `e495d9bae5b30aa57674c71a169c8fa1a146540f`. Reader provisioning is a separate prerequisite, described in [its report](F057-access-reader-prerequisite.md) and the explicit [ADR-023 amendment](../architecture/decisions/ADR-023-administrative-access-management-controlled-delegation.md). F057.3 is UNSTARTED. No push or deployment.

## Read-only application boundary

`/admin/access` presents Access & Permissions through the existing Admin shell. Navigation and direct-page admission require the server-projected `canReadAccess` capability. Every API independently requires authenticated Entra workforce context, `admin.configuration.read` and `admin.access.read`; development fallback cannot satisfy discovery. Access-read alone does not imply configuration-read or access-manage. Each operation re-resolves actor eligibility and current authority in a repeatable-read, read-only database transaction. React is not the security boundary.

GET routes under `/api/v1/admin/access`:

- `/principals`: Organization-scoped summary, count and bounded page.
- `/permissions`: code-defined registered permission metadata.
- `/scopes`: Organization Department/Division filter options.
- `/principals/:id`: current effective permissions, source contributions, memberships and Access Administrator status.
- `/principals/:id/history`: paginated governed F057 change sets and normalized deltas.

There are no POST, PUT, PATCH or DELETE access routes, no runtime grant/revoke/configure controls, no editable permissions/memberships and no role editor. F057.2 adds no migration, permission, grant, bootstrap or authorization writer. Migration 39 belongs solely to the approved Reader prerequisite. Current personal development: **39 applied / 0 pending / 60 tables / 32 registered / 27 manageable permissions**.

## Discovery semantics

Search is case-insensitive literal display-name matching, trimmed at edges, limited to 100 characters, rejecting controls. SQL wildcard characters are literal; bound parameters prevent string SQL interpolation. Sort is lowercased display name followed by internal UUID. Page sizes 25/50/100, default 25; search/filter changes reset page one. Only the requested page is hydrated into API summary objects. Summaries omit raw grants, role detail and identity-provider values.

Filters combine with AND:

- Reqro Status is local `staff_identity.active`: All/Active/Inactive, default All.
- Access Category requires at least one effective registered permission in the code-defined category. Inactive staff have no effective categories.
- Department and Division filters require their own active membership row in the trusted Organization. Division membership does not imply Department membership.
- Access Source uses effective registered contributions. Only operational F057 ownership counts as managed. Administrator/Reader provisioning, F027/F036 and existing roles count as outside. Empty owned roles do not contribute; overlapping roles count once in effective access.

The shared effective-contribution query preserves existing active-role/assignment semantics. Unknown database permission keys are excluded by the registered code catalog. Access Administrator requires active staff with all three effective prerequisites, even when contributed by different roles.

## Accepted presentation

The main table retains Search Staff, Clear Search/Clear Filters, numbering, View Access, status and source summaries. Operational Scope uses correct Department/Division plurals. Wide-desktop pagination aligns right; narrower layouts wrap and show labelled rows. Status help reads: “Read-only view. Status reflects whether the staff member is active in Reqro.”

The View Access drawer is summary-first:

1. Access Overview: permission count, assignment summary and Access Administrator Yes/No.
2. What This Staff Member Can Do: categories collapsed by default with counts; Administration and Other Capabilities are presentation aliases, not metadata changes.
3. How Access Is Assigned: source totals with assignment details on demand. Mixed contribution totals may overlap while effective permissions remain distinct.
4. Departments & Divisions: distinct read-only lists; active units show names and inactive units show an Inactive badge.
5. Recent Access Changes: history remains collapsed/on-demand, paginated by change set.

Expanded categories use compact grouped permission rows. Names are primary, descriptions secondary, Details tertiary. Keys appear only inside Details with Requires and Access assigned. Sensitivity remains visible as text (“Sensitive access”); source badges appear where they distinguish contributions. No color-only meaning or repetitive per-permission disclaimers.

Source labels are presentation aliases for unchanged API classifications: **Assigned outside Access & Permissions**, **Assigned in Access & Permissions**, **Assigned from multiple sources**.

Memberships affect scope-sensitive operations, not every Organization-wide permission. Inactive organizational unit behavior can vary by operation; F057.2 does not change it. The drawer explains that Division access is listed separately from Department access and retains the technical inheritance clarification in a disclosure.

## History and privacy

History uses retained governed F057 audit only; no older events are fabricated, and reads do not audit themselves. It groups permission deltas by immutable change set, shows safe staff/provisioning attribution, revisions, dates and human labels. Empty history is truthful: “No access changes have been recorded by Reqro for this staff member yet.” Boundary: “Reqro records access changes made through the current access-management system. Older access may not appear here.”

Responses are no-store. Data remains in memory; search is not persisted to browser storage or address-bar state. Existing MSAL identity caching is separate. Auth/client changes and request identity checks suppress stale responses. Normal UI/API projections exclude provider tenant/object/subject identifiers, bearer tokens, raw claims, Requester data, Service Request content, protected answers/contact/location and tracking credentials. Internal staff IDs are legitimate scoped references, not authority.

## Permanent scale and race evidence

`server/test/database/access-discovery.integration.test.ts` migrates a disposable schema, seeds fictional Organizations and 20/200/2,000 staff populations, then removes and verifies removal of the schema in `finally`. Accepted development data is not seeded with scale fixtures.

Each population passes count correctness, deterministic ordering, complete pagination without duplicates/omissions, bounded 25/50/100 results, source and category filtering, AND combinations, unknown permission exclusion, inactive-staff behavior, Organization isolation and safe projection. Authorization tables are compared before/after reads; no revision/audit/role/membership writes occur. Current authority is rechecked after revocation in the disposable fixture. Count/page EXPLAIN ANALYZE checks exercise unfiltered, search, status, category, membership and source variants.

| Principals | Page 25          | Page 50 | Page 100 | Result |
| ---------- | ---------------- | ------- | -------- | ------ |
| 20         | 8 SQL statements | 8       | 8        | PASS   |
| 200        | 8 SQL statements | 8       | 8        | PASS   |
| 2,000      | 8 SQL statements | 8       | 8        | PASS   |

Counts include transaction and authorization statements. The constant round-trip count proves no per-principal permission/role/membership/source query growth. This is correctness/bounded-query evidence, not a production benchmark.

The category remediation confirms with PostgreSQL `pg_typeof` that the aggregated/coalesced `keys` operand is `character varying[]`, while the bound category operand is explicitly `text[]`. Casting `keys::text[]` at the overlap boundary fixes the operator mismatch; no schema or category/security semantic changes.

`react/test/AccessDiscoveryRaces.test.jsx` uses deferred promises resolved B then A, with the mock deliberately ignoring abort. Search (Dev → Development), filter, page, detail and history races all PASS. Page race directly exercises the production request hook because the first pending list has no page controls yet. Detail/history tests switch staff and prove no previous staff content replaces newer intent. No arbitrary sleep is used.

## UAT and accessibility evidence

Authenticated manual UAT: **PASS**, explicitly accepted by the user after final visual/wording refinements. No browser automation repeated it. Backend type alignment and added automated tests leave accepted rendered behavior unchanged.

Responsive widths 1440/1280/1024/768/390 and short-height: CSS/test review and general user acceptance, not separately recorded per-viewport manual passes. Light/dark use existing theme variables and accepted presentation; no newly captured theme screenshots. Accessibility-oriented checks cover semantic table/list/dialog, labelled filters/search/mobile rows, text statuses/sensitivity, native category/Details disclosure, heading focus and close focus restoration. Native Tab/Shift+Tab/disclosure activation/Escape remain supported by the established drawer/browser implementation and manual acceptance; jsdom is not claimed as a browser keyboard certification. This is not WCAG certification.

Automated repository logging/privacy regression checks pass. Direct live-console inspection was not performed. No HAR, identity export, secret or temporary UAT artifact is retained.

## Final comprehensive validation

| Suite                  |    Passed | Failed | Skipped |
| ---------------------- | --------: | -----: | ------: |
| Backend unit           |       315 |      0 |       0 |
| API E2E                |        40 |      0 |       0 |
| PostgreSQL integration |       460 |      0 |       0 |
| Shared                 |        64 |      0 |       0 |
| React                  |       689 |      0 |       0 |
| Distinct total         | **1,568** |  **0** |   **0** |

Targeted runs are subsets, not added again: 50 PostgreSQL foundation/Reader/discovery tests and 36 React discovery/race/Admin tests. Search, filter, page, detail and history races each PASS. Backend TypeScript/test compilation, configured ESLint (zero errors/warnings), configured Prettier, both production builds, whitespace, changed-document links and private-value review PASS. Vite retains its large-chunk warning; Node reports the existing shared module-type warning. Neither changes application behavior.

Regression suites PASS for F057.1, Reader prerequisite, Entra/Staff Access Guard, F027/F036, F032, F045, F048/F049, F052–F055 and the F056/F056.1/F056.2A/B/C/F056.3/.4/.5 family. These are repository automated regression results, not new manual acceptance of every older feature. No browser automation or direct live-console inspection was performed.

Commit separation: Reader migration/foundation/CLI/types/tests and ADR/F057.1/Reader report first; discovery service/controller/module/capability, shared query/export hunks, UI/navigation/styles/tests and discovery/current-state documentation second. Accepted baseline history is unchanged. No synchronization, deployment, grant change, Entra/cloud/client modification or F057.3 work is authorized by completion.

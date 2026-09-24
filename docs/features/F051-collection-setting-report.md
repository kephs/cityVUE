# F051 Organization collection setting — follow-up report

Date: 2026-09-23. Separate follow-up to accepted `dc3801df31c4a728731f4ca5be13e692561c9d72`; that commit is not amended. See the [specification](F051-requester-geography-service-participation.md), [original report](F051-implementation-report.md), and [dated ADR-013 amendment](../architecture/decisions/ADR-013-operational-participation-geography.md).

## Implemented behavior

The smallest storage model is `organization.service_participation_collection_enabled`, a non-null boolean with default false. The separate migration enables no Organization and performs no historical request backfill. After development migration, the previously approved fictional Organization was explicitly enabled through the guarded CLI; its three existing areas alone do not enable collection. New Organizations remain disabled.

The requester-safe configuration projection is `{collectionEnabled, items}` with only active area id/label choices. It carries no staff configuration, identity, history or counts. Disabled returns false and an empty list. Enabled with no active areas returns true and an empty list, allowing operational distinction without displaying a broken requester control.

| Configuration             | Requester experience                                                                | Server creation policy                                                                   |
| ------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Disabled                  | Entire section, question, help, selector, Prefer not to say and Review entry absent | Omitted input becomes NOT_COLLECTED with no area; supplied PROVIDED or DECLINED rejected |
| Enabled, active areas     | Existing optional question, explanation, choices and Prefer not to say              | Valid PROVIDED or DECLINED accepted; omitted input remains NOT_COLLECTED                 |
| Enabled, no active areas  | Entire section absent; ordinary submission remains available                        | Omitted input becomes NOT_COLLECTED; supplied PROVIDED or DECLINED rejected              |
| Configuration unavailable | Optional section absent; no technical requester error                               | Server still applies current policy; omission remains valid                              |

Resolved unavailable configuration clears stale component selections. Explicit geography validation locks the Organization setting for share in the request creation transaction, serializing with setting updates. Public web/API, trusted intake and staff-assisted PUBLIC intake share enforcement. INTERNAL behavior is unchanged. A stale open browser can receive a safe rejection after a policy change and must refresh; the API does not silently accept prohibited collection. Already-finalized evidence retries preserve the original receipt before current collection validation.

Anonymous submissions remain anonymous, with no Contact or F050 Requester link. Identified submissions preserve Contact rules. Staff attribution, Service Location and F048 assignment remain independent. The setting creates no requester profile geography, identity inference or new tracking operation.

## Configuration and deferred administration

The existing development participation CLI now supports `enable --dry-run/--confirm`, `disable --dry-run/--confirm`, and read-only `status`. It retains development profile, fictional-data opt-in, personal database/role/port and fictional Organization guards. Repeated setting operations are idempotent. Status reports disabled/ready/incomplete and active-area count; it provides the operational diagnostic for missing areas. Default area provisioning does not enable collection. See [server commands](../../server/README.md).

Only the collection boolean changes. Disabling neither deletes/deactivates areas nor rewrites PROVIDED, DECLINED, NOT_COLLECTED or area relationships. Re-enabling restores the same active choices; requests created while disabled are never backfilled.

Production Admin Portal status: **DEFERRED**. Intended future control: Settings → Service Requests → Intake Settings → Service Participation → Collect service participation information [On/Off]. Suggested copy: “When enabled, requesters may optionally select an approved participation area or choose Prefer not to say. When disabled, Reqro does not ask for this information during Service Request intake.” Historical deletion is not part of this control. Administrative mutation authorization/audit, area management/governance and threshold administration remain deferred. No staff mutation API or broad grant was added.

## Security and regression results

Historical analytics continues when collection is disabled. Tests compare authorized aggregates before and after disabling. Existing analytics implementation is unchanged: dedicated `analytics.service_participation.read` plus independently authorized PUBLIC scope, zero default grants, threshold 5 with hard minimum 5, suppression before serialization, no grand totals or percentages. The setting grants no analytics access. Existing authorization, suppression, logging/audit privacy and projection tests pass.

F044 tracking, F047 Live Search, F048 default assignment, F049 identity and F050 trusted identity/history behavior and projections remain unchanged. Service Location is still separate from participation. Disposable PostgreSQL tests verify disabled forged PROVIDED and DECLINED rejection through public HTTP, assisted HTTP and trusted service intake, with no associated writes. They also cover incomplete configuration, ordinary anonymous NOT_COLLECTED creation, re-enabled DECLINED creation, retained original requests/areas/grants, and immutable disabled-period state.

## Validation

Installed Node entrypoints were used for the existing package scripts because npm was unavailable in the execution environment; no dependency changes were needed.

| Check                                                                 | Result                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------ |
| Backend unit                                                          | 237 passed                                                   |
| API E2E                                                               | 40 passed                                                    |
| PostgreSQL integration                                                | 244 passed, zero skips                                       |
| Shared JavaScript                                                     | 64 passed                                                    |
| React                                                                 | 509 passed in 35 files; focused participation suite 9 passed |
| TypeScript test compilation, typecheck and backend build              | Passed                                                       |
| Backend ESLint                                                        | Passed                                                       |
| Frontend production build                                             | Passed; existing large-chunk advisory remains                |
| Frontend lint                                                         | No configured script                                         |
| Formatting, whitespace, local Markdown links and private-value review | Passed before commit                                         |

Commands correspond to `server` test/test:e2e/test:db/typecheck/build/lint/format:check and root test/test:react/build:react scripts. PostgreSQL used the separately configured disposable test database. The new migration was applied, rolled back and reapplied there, proving disabled defaults and unchanged grants. Rollback refuses retained participation configuration rather than silently dropping policy. Development is at **28 applied / 0 pending migrations**; no destructive development rollback was attempted.

Live UAT used the developer-launched API outside the restricted sandbox. In a temporary intake tab, enabled collection displayed the exact optional question, explanation, Prefer not to say and the three fictional choices. The guarded CLI dry-run/confirm disabled collection; refreshed intake removed the whole section. Re-enabling through dry-run/confirm restored the same choices. No request was submitted, no device location requested and no attachment uploaded.

Enabled and disabled layouts were checked at 1440, 1280, 1024, 768 and 390 pixels in light and dark themes, using DOM overflow checks and visual inspection. No horizontal overflow or empty participation placeholder was observed. Enabled controls retain labels/help and visible keyboard focus; Tab moves from the selector to Take Photo. Disabled participation is absent from the accessibility tree and tab order; Tab moves from anonymous identity selection directly to Take Photo. Review/payload absence and stale-selection clearing are also covered by React tests. These are accessibility-oriented development checks, not certification. The temporary tab was closed and theme/viewport restored.

## Development integrity and final state

Before/after row-hash comparisons found no change to any of the 13 existing requests, including **SR-202609-000013**, their geography/identity/Requester links, or the three area rows. Counts and original rows remain unchanged for: 8 Contacts, 13 Locations, 16 answers, 18 assignments, 3 watchers, 105 security Activity records, 68 operational Activity records, 3 Notes, 4 Communications, 3 attachments/batches, 48 attachment audit records and 3 Requester History audit records. Four private attachment files retain their hashes.

Roles, all 35 role-permission rows, 4 staff role assignments, 4 Department memberships, 4 Division memberships, F048 defaults and all six Issue identity policies are unchanged. The previously accepted narrow analytics grant/scopes were neither added nor removed. Tracking remains **1 active / 5 revoked** with identical id/state/timestamp metadata; no credential or digest was read for this comparison and no tracking operation occurred.

All original participation audit rows remain unchanged; two additional analytics-read audit rows were recorded during the session (5 → 7). These append-only audit additions are distinguished from historical domain mutation. The only intended Organization change is the new collection boolean, finally **enabled**, with three active areas and diagnostic state **ready**. Temporary integrity scripts/baselines are removed before commit.

## Changed files and delivery

Added: this report and `server/migrations/20260928000000-add-participation-collection-setting.ts`.

Changed: `server/src/database/database.types.ts`, `server/src/database/development-participation-cli.ts`, `server/src/service-request/participation.domain.ts`, `server/src/service-request/participation.service.ts`, `server/test/database/participation-checks.ts`, `react/src/residentIntake/ParticipationInput.jsx`, `react/src/pages/report/ReportIssuePage.jsx`, `react/test/Participation.test.jsx`, `server/README.md`, `docs/ARCHITECTURE.md`, `docs/CITYVUE_CONTEXT.md`, `docs/ROADMAP.md`, ADR-013, the F051 specification and original implementation report.

Separate commit subject: `feat(config): add service participation collection setting`. The enclosing commit is the follow-up checkpoint; its exact hash and final clean-working-tree check are reported at delivery. Expected local relationship after that commit: 2 ahead / 0 behind the unchanged last-known `origin/main` (`a093cfa3ec635250b2f44128652a075dd5a4ab81`); this is not a fresh remote query. No push, deployment, remote synchronization or F052 work is authorized or performed. Stop for review after this checkpoint.

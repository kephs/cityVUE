# F056.2B — Implementation and validation record

Status: implementation and validation complete. The user personally performed manual UAT and inspected live API logs, confirming all PASS and authorizing the local commit. No push or deployment. Starting HEAD: `a917de52a0fe61cfb5620e7da31e9a33f56368ad`.

## Decisions and compatibility

See [the specification](F056-2B-issue-availability-external-handling.md) and [ADR-019](../architecture/decisions/ADR-019-issue-availability-governed-handoff.md). The user approved the third protected answer-read audit as intentional manual UAT between checkpoints; all three are preserved. The user approved §149 Option A and the §88 F032 authorization compatibility migration. No grants or provisioning bundles changed. Action-only principals intentionally can no longer write handling, including through the retained F032 POST route.

Request audience classifies a request. Issue availability determines eligible intake contexts. Handling determines whether Reqro collects it. Channel records origin; requester policy determines identification requirements. These remain distinct.

| Availability            | Reqro Intake (`internal_intake`)   | External Redirect (`external_redirect`) |
| ----------------------- | ---------------------------------- | --------------------------------------- |
| `INTERNAL_ONLY`         | Valid, authorized internal intake  | Invalid                                 |
| `EXTERNAL_ONLY`         | Valid, external intake             | Valid, explicit handoff only            |
| `INTERNAL_AND_EXTERNAL` | Valid in either authorized context | Invalid                                 |

Resident PUBLIC and opt-in trusted development-provider PUBLIC creation use external context. Staff-assisted PUBLIC also uses external context after existing staff authorization. Authorized INTERNAL uses internal context. Channel, arbitrary browser claims and staff authentication alone cannot determine context. The staff catalog defaults to PUBLIC/external; its internal query additionally requires the existing internal-creation permission. Creation checks current availability/handling under the stable Issue lock. F046 finalized retry receipts retain their earlier precedence.

## Persistence and mutation

`service_definition.availability` is required, has three bounded values and no database default. A CHECK enforces the handling matrix; an UPDATE trigger prevents conversion. Creation requires explicit availability, keeps the Issue inactive and copies a compatible same-Organization intake template once. Existing Issues have read-only availability. Later template changes never propagate.

The implementation reuses F032 `action_type`, `redirect_url`, `redirect_message`, `redirect_label` and `action_revision`. Both writers call `configureIssueAction` within their transaction, requiring `admin.configuration.read`, `admin.issues.write` and `catalog.issue_action.manage`, plus existing Organization and Department/Division scope. F032 route, DTO, response and expected action revision remain supported. Its GET remains scoped action-management read. Broad Admin list/detail does not receive full redirect configuration; authorized scoped editing does. No history API or UI was added.

Modern Save composes core, action, requester-policy, assignment and question publication changes atomically. These resources keep independent revisions. Valid equivalent action writes create no revision, history or success audit. Stale expected action revision returns 409 before no-op acceptance. Required history/audit failures roll back the entire transaction. Returning to Reqro Intake clears current redirect fields but retains immutable history and all copied question configuration. Activation revalidates current handling, URL/text, published configuration and Category/Department/Division eligibility; Reqro Intake validates its question configuration.

`issue_action_history` contains Organization, stable Issue, resulting action revision, complete configuration, trusted actor, correlation and time. Its composite foreign keys prevent cross-Organization references; its unique Organization/Issue/revision index supports lookup. UPDATE, DELETE and TRUNCATE are rejected. Existing redirects in other environments receive one honestly marked baseline at their actual current revision with no invented actor or earlier history. `issue_action_audit` is a separate immutable metadata record with prior/resulting action/revision and parsed hostname, not full destination or resident content. It references the corresponding history revision. Creation's existing configuration audit records selected availability.

Migration `20261005000000-issue-availability-external-history.ts` checks pre-existing action/redirect consistency, backfills compatible intake Issues to dual availability and creates constraints/history/audit. Disposable PostgreSQL tests passed apply → rollback → reapply; retained configuration/history blocks destructive rollback. Development target was verified as localhost:5432, actual loopback, database `reqro_dev`, role `reqro_dev_user`, development mode. Migration count is 34 → 35, with zero pending migrations. Applying it preserved all original-column fingerprints, including revisions and timestamps; only the migration ledger changed. Existing seven intake Issues already supported both contexts; this backfill preserves that behavior.

## URL and resident behavior

HTTPS is required. HTTP, javascript/data schemes, userinfo, malformed ports/authorities, controls, backslashes, localhost/local hostnames and parsed literal loopback/private/link-local addresses are rejected. This includes normalized alternative IPv4 notation and IPv4-mapped IPv6, IPv6 unique-local and link-local ranges. Public IPs, valid nonstandard HTTPS ports, static paths/query strings and fragments are allowed. Input and normalized URL length are bounded to 2,048. Hostname display comes from URL parsing, including punycode normalization. Message/label are bounded plain text, escaped by React. Legacy omitted message/label defaults remain compatible; explicit blank values are invalid.

No DNS resolution, destination fetching, iframe, health probe, dynamic substitutions, requester-data forwarding or click telemetry was introduced. Static configured query strings are passed unchanged; they must not contain secrets. Literal-address checks cannot establish destination trust, prevent DNS rebinding or eliminate homographs. Organization-approved domain governance and DNS-based destination controls remain production prerequisites/future work.

Issue selection resolves current server state before showing the handoff. The handoff shows message and hostname and requires explicit Continue. Continue reloads by Issue identity with no-store response behavior. Revision/destination/message/label changes refresh the handoff, announce the change, focus its heading and require another Continue. Reqro Intake changes clear unsent answers and return to current intake; required identification is initialized correctly. Inactive/invalid/unavailable state prevents navigation. Successful navigation uses only the freshly resolved URL, in the same tab with `no-referrer`. No caller-supplied destination is accepted by the API.

The redirect path collects no Service Request, Contact, Requester linkage, Dynamic Question answers, Service Location, participation, assignment, Activity, attachment or tracking credential. It shows no intake question/location/attachment controls. No request identity, staff identity, location, participation, attachment, bearer or tracking data is appended to navigation.

## Admin UI and discovery

Add Issue requires an explicit availability radio choice. Existing availability is read-only. Authorized external-only Issues expose handling radios and a conditional Destination URL / Handoff message / Button label editor with parsed hostname. Internal-only and dual Issues show fixed Reqro Intake. Redirect hides intake settings/questions while preserving their data. Save is deliberate; Cancel discards drafts. Validation uses safe fixed language. Live UAT prompted a correction so redirect failures mention handoff settings, and a regression covers required identification after switching back to intake.

Availability and Handling join the existing server-side AND filters, Organization scope, live search, URL state, sorting, pagination and 25/50/100/250/500 sizes. Summary projection adds two bounded fields without full URLs, history or schemas. Existing bounded query structure has no per-Issue lookup. Redirect Issues are excluded from intake template choices. F052 diagnostics validate availability, handling consistency and redirect configuration in bounded batches, return safe findings and never repair data.

## Automated validation

| Check                                                                               | Result                                         |
| ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| Backend unit (`node --test`, compiled unit directory)                               | 273/273                                        |
| API E2E (`node --test --test-concurrency=1`, compiled E2E directory)                | 40/40                                          |
| PostgreSQL (`node --test`, compiled database directory, isolated TEST_DATABASE_URL) | 325/325; zero skips                            |
| Shared root tests (eight protocol files)                                            | 64/64                                          |
| React full suite (Vitest, maxWorkers=1)                                             | 598/598, 44 files                              |
| Post-UAT React changes: ReportIssueApiMode + IssueConfiguration                     | 23/23                                          |
| TypeScript test/build configurations                                                | PASS                                           |
| Backend ESLint                                                                      | PASS                                           |
| Frontend production build                                                           | PASS; existing >500 kB chunk warning           |
| Formatting, whitespace, links, private-value review                                 | PASS; repeat final staged review before commit |

No frontend lint script exists. Tests use disposable schemas and synthetic identities, not authentication bypasses in live UAT. The independent handling suite covers all missing-permission combinations for both writers, valid scope, cross-Organization/Department/Division denial, scoped legacy GET, stale/no-op parity, atomic history/audit failures, concurrent action writes, immutable history, activation repair, context matrix and creation/action lock ordering. Existing F032 and F045–F056.2A regression suites pass, including finalized attachment retries, published-child immutability, protected answers and legacy disclosure closure. The initial activation validator incorrectly passed stored metadata into the editable-field validator; correcting its projection restored the full regression suite without weakening assertions.

Disposable 525-Issue discovery plans retain bounded page sizes. Availability uses Category/Organization indexes and database filtering; the incompatible availability/handling combination returned zero rows before hydration. No redundant low-cardinality index was added. Focused read-only development plans returned seven eligible rows in external/internal contexts (0.120/0.098 ms execution), using Category and published-version indexes with a small Issue scan. The five-row history lookup used its composite unique index as an Index Only Scan (0.084 ms). These limited plan probes supplement repository-query review; they are not end-to-end timings or production benchmarks. Normal list never loads history.

## Live UAT and development integrity

Normal personal Entra authentication was retained. The existing principal already intentionally held all three permissions; §546 forbids revoking them merely to manufacture a denial. Automated permission-matrix coverage supplies denial evidence. No grant or bundle changed.

Observed: AND/no-results filters, native Back/Forward/refresh and Clear filters; explicit inactive creation; fixed availability; copied questions retained; authorized handling Save; localhost rejection; activation; public discovery; explicit same-tab reserved-domain navigation; stale destination and message refresh without navigation; action-to-intake without external navigation; deactivation blocking stale Continue. Equivalent legacy and modern writes returned 200, legacy revision stayed unchanged and modern `changed` was false. Stale action returned 409. A full database fingerprint before/after those requests was identical.

The only new Issue is `Fictional External Permit Handoff`, final active, External-only, External Redirect, order 0, core revision 5, action revision 6, catalog version 1. Its retained destination uses reserved `example.org` with fictional static path/query/fragment. Earlier history retains the reserved `example.com` configuration. There are five legitimate handling history/audit entries: initial redirect, destination change, message change, return to intake, and restore redirect. Creation/activation/deactivation added three configuration audits during agent UAT. The user subsequently activated this same Issue during manual UAT, explicitly confirming that action; it added a fourth configuration audit and advanced core revision 4 → 5 without changing action revision 6. This intentional user-created development history is preserved. The source Pothole and every pre-existing Issue remain unchanged.

| State                            | Baseline     | Current                                     |
| -------------------------------- | ------------ | ------------------------------------------- |
| Issues                           | 7 active     | 8 active / 0 inactive (one fictional Issue) |
| Catalog versions                 | 11           | 12 (one independent template copy)          |
| Questions                        | 22           | 25 (three copied questions)                 |
| Options                          | 27           | 27                                          |
| Conditional questions            | 3            | 4 (one copied condition)                    |
| Submitted answers                | 16           | 16                                          |
| Service Requests                 | 13           | 13                                          |
| Issue configuration audits       | 10           | 14                                          |
| Requester policy / policy audits | 7 / 3        | 8 / 4 (new Issue initialization)            |
| Handling history / audit         | absent       | 5 / 5                                       |
| Protected answer-read audits     | 3 reconciled | 3                                           |

The original-row fingerprint comparison excludes only the new fictional Issue and its legitimately copied children/policy/audits, plus the newly added nullable column. Every original application-table fingerprint equals the accepted baseline. Service Requests (including SR-202609-000013), answers, Contact, Requesters, location, assignments, Activity, attachments, tracking, prior versions/questions/options, grants and all prior audits are preserved. Tracking remains 1 active / 5 revoked. Participation remains enabled revision 3, five active areas, threshold 5; Fictional North-East Area and its user-created audit remain untouched. Branding remains REQRO_DEFAULT revision 3. Analytics-read audits remain 53.

Responsive override reported success but the page remained 859 px; the user personally completed the required 1440/1280/1024/768/390 light/dark, responsive/visual and keyboard/focus checks and confirmed PASS. Existing-width inspection showed wrapping and visible focus. This validation is not a WCAG certification. Live API logging privacy: PASS, based on the user’s firsthand inspection of the developer-launched API logs. No raw logs were pasted. Final read-only integrity review identified only the user-confirmed activation of the fictional UAT Issue and its audit; all other fingerprints remain unchanged. Temporary HTML/JSX helpers and the synthetic database-test log were physically removed. Changed Markdown links and whitespace checks pass. The only credential-pattern candidate was a pre-existing accepted test-fixture connection; no new secret candidate was introduced. The [150-question security review](F056-2B-security-review.md) records evidence and the completed live logging gate. Pre-commit HEAD was the accepted checkpoint, 0 ahead / 0 behind the existing origin/main tracking reference. The authorized local commit uses `feat(intake): manage issue availability and external handoff`, with the accepted checkpoint as its parent. No push or deployment is authorized; the final response records the resulting hash and clean-tree verification.

## Deferred work

No availability conversion, per-context handling, dual-context redirects, redirect templates, allowlist, DNS validation, click telemetry, dynamic parameters, requester forwarding, destination fetching, iframe, richer question types/conditional authoring, workflow/SLA, F056.2C or F057. No deployment or push. Stop after the authorized local feature commit for review.

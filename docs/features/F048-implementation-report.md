# F048 implementation and validation record

Date: 2026-09-23. Starting branch: `main`, clean and synchronized at `bf084dc3033fb56e2ba2b9f1dae0dc54241bf73b` (0 ahead / 0 behind). Starting personal development baseline independently verified: 23 migrations, zero pending; eight requests; three retained attachments; tracking 1 active / 5 revoked. Only local synthetic/personal development resources were used.

Status: implemented and locally validated. Automated checks, authenticated UI UAT, integrity verification and user-confirmed live logging privacy passed. Delivery is the local F048 commit only; no push, deployment or F049 work occurred.

## Delivered behavior and decisions

The [feature contract](F048-issue-based-default-assignment.md) documents configuration identity/storage, exact creation ordering, target eligibility, CLI usage, revision/history semantics, security boundaries, query impact and deferred work. It extends existing [F037 ownership](F037-assignment-ownership-watchers-foundation.md) rather than introducing another ownership model.

| Area                                         | Actual result                                                                                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Issue configuration                          | Stable Organization-scoped Issue → one optional STAFF, operational ROLE or GROUP/Team; names are display-only                                                                  |
| None                                         | Normal unassigned request, revision 1, original receipt and creation event                                                                                                     |
| Valid default                                | Exactly one normal current owner; revision 2 and updatedAt advance; System automatic Activity and minimal security audit                                                       |
| Invalid selection at configuration           | Reject wrong type/UUID, foreign Organization, missing/inactive/ineligible target; no mutation                                                                                  |
| Previously valid target unavailable          | Create Unassigned with safe creation-audit outcome; no guessed fallback or internal error disclosure                                                                           |
| Clear/change                                 | Future creates only; retained revision prevents stale/ABA overwrites; existing requests remain untouched                                                                       |
| Configuration concurrency                    | Explicit expected revision plus stable Issue lock; two conflicting changes cannot both win                                                                                     |
| Creation concurrency                         | Coherent old/new config per transaction; at most one current assignment per request                                                                                            |
| Valid assignment/history/audit write failure | Entire request/reference/contact/location/answer/evidence transaction rolls back                                                                                               |
| STAFF                                        | Independent audience read permission and Department/Division scope required; later access loss cannot be bypassed by retained ownership                                        |
| ROLE/Team                                    | One canonical target, no expansion to members; membership and ownership grant no access                                                                                        |
| PUBLIC / INTERNAL                            | Both use the shared service; target revalidated for actual persisted audience                                                                                                  |
| Channels                                     | PUBLIC web and existing staff-assisted web/phone/walk_in/staff/api paths covered; no new intake surface                                                                        |
| Explicit initial assignment                  | Not an existing input; no precedence mechanism invented; forged assignment fields rejected                                                                                     |
| Retry                                        | Existing F046 finalized-batch receipt returned before config resolution; concurrent retry, config change and manual reassignment cannot duplicate or replace ownership/history |
| Independent submit                           | Existing semantics retained; no general creation idempotency introduced                                                                                                        |
| Manual override                              | Normal F037 reassign/unassign succeeds and persists through reads; default is not an enforcement policy                                                                        |
| Routing / Issue / reopen                     | No routing modification, new Issue-change operation or read/reopen hook; future default changes do not touch old requests                                                      |
| Watchers                                     | No automatic watcher; existing Watching semantics preserved                                                                                                                    |
| Administration                               | PRODUCTION ADMINISTRATION UI DEFERRED; guarded explicit development CLI only, no configuration HTTP endpoint or new grants                                                     |

Configuration and current ownership are separate. The retained Issue default is Alex Example; the new request's initial/current owner is Alex Example. If staff later deliberately changes that request's owner, the Issue default remains unchanged and only new requests use it. Automated tests prove the corresponding Team A → manual staff owner → unassigned sequence without reapplication.

## Security and privacy review

ASSIGNMENT IS OPERATIONAL OWNERSHIP. ASSIGNMENT IS NOT AN AUTHORIZATION GRANT.

| Condition                   | Current owner? | Request authorization automatically granted? |
| --------------------------- | -------------- | -------------------------------------------- |
| Eligible STAFF default      | Yes            | No                                           |
| Eligible ROLE default       | Yes, the role  | No                                           |
| Eligible GROUP/Team default | Yes, the Team  | No                                           |
| Watcher                     | No             | No                                           |
| Department/Division routing | No             | No                                           |

Threats exercised include cross-Organization/wrong-type target substitution, inactive targets, revoked staff access, forged intake assignment, stale config writes, partial assignment/audit failure, duplicate retry, and ownership/membership confused with permission. Composite FKs, canonical F037 validation, existing server-side audience/scope permissions, transaction locks/constraints and bounded projections remain authoritative. The CLI requires deliberate local development process authority and existing mapped personal staff/scope; it does not turn ordinary request-assignment permission into Issue configuration authority. Browser input cannot configure a default.

Contact, Notes, Communications and attachments retain their independent parent/read/create checks. Negative tests deny protected domains to unrelated owners/members and after staff permission revocation. Tracking remains independently managed; no tracking credential was retrieved, issued, rotated or revoked. F046 evidence, current authorization, staging/finalization and tracking-projection regressions pass. F045 Service Location remains operational data, never an assignment selector. F047 search remains limited to reference, Issue and displayed location, not owner/configuration/protected content.

Activity has only approved safe historical target display, System actor and source label. Assignment audit records policy/source/action/revision, not description, contact or credential. Append-only config audit records trusted operator, typed target UUID, Issue/Organization, action/revision/time; no target name or content. Required audit failure is atomic. Automated captured structured logs exclude fictional protected markers. The user confirmed the fictional marker “F048 ownership training check” was absent from normal developer-launched API logs. This is developer-observed live evidence, separate from automated captured-log tests; no log dump, bearer token, personal tenant configuration or credential was supplied.

No condition tables, rule ordering/operators, multi-action rules, geographic/schedule/requester/history/content/attachment/workload rules, balancing, round robin, fallback chains, SLA escalation or assignment notifications were introduced. No AI or vendor integration is involved.

## Automated evidence

Commands use the installed Node entry points equivalent to the repository scripts because npm is not on this shell's PATH. Approved environment values are loaded into processes without being printed. Database tests use disposable `reqro_test` schemas, not personal-data failure injection.

| Gate                                                                                       | Result                                                                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Backend unit (`test:compile`, `node --test` in compiled unit directory)                    | 232 passed                                                                                                                              |
| API E2E (`node --test --test-concurrency=1` in compiled E2E directory)                     | 40 passed                                                                                                                               |
| PostgreSQL integration (`node --test --test-concurrency=1` in compiled database directory) | 205 passed, zero failures/skips, including final strict-style revalidation                                                              |
| Shared root test files from `package.json`                                                 | 64 passed                                                                                                                               |
| React (`vitest run --config vitest.config.mjs --maxWorkers=1`)                             | 490 passed across 33 files                                                                                                              |
| TypeScript test compile and application no-emit                                            | Passed                                                                                                                                  |
| Backend ESLint                                                                             | Passed after correcting strict-style findings                                                                                           |
| Frontend lint                                                                              | No configured frontend lint script; not claimed                                                                                         |
| Backend formatting                                                                         | Passed                                                                                                                                  |
| Backend / frontend production builds                                                       | Passed                                                                                                                                  |
| Whitespace, documentation links, private-value review                                      | Whitespace, 145 local Markdown links and private-configuration checks passed; final staged scope/privacy review completed before commit |

Focused database evidence covers None; all three target kinds with PUBLIC and INTERNAL; configuration dry run/no-op/CAS/audit; unavailable target degradation and Unassigned discovery; channel parity; location independence; manual override; rollback on assignment/Activity/audit failure; concurrent creation/configuration; preserved existing data; and safe meaningful rollback refusal. F046 retry tests explicitly create with Team A, change default to Team B, retry concurrently with original receipt/unchanged assignment/history, manually reassign and retry again without change, then create a separate new request that receives Team B.

Regression suites cover F029 intake/audience, F035 Activity, F037 ownership/watchers, F039 contact, F040 mixed workspace/authorized views, F041 Notes, F042 Communications, F044 tracking, F045 locations, F046 attachments and F047 filters/search/sorting/pagination. Existing My Requests/My Team/Watching selection stays within SQL-authorized requests. F048 uses the same current-assignment relation; it adds no alternate filter/sort implementation.

During validation, fixture errors were corrected (location was initially sent to a not-applicable Issue; a new published disposable version now allows it; retry manager now uses its typed identity). New UI assertion matches the combined target/type text. An existing DesignSystem assertion referenced the toolbar selector removed in accepted F047; it now checks the actual responsive control grid without changing application CSS. A ReportIssueApiMode timeout under concurrent validation passed on the complete React rerun. No authentication, immutability or eligibility guard was relaxed to make tests pass.

## Migration and personal development integrity

Required migration: **Yes**, `20260924000000-add-issue-default-assignment`. Disposable apply → down → reapply passed before development application; historical rows and grants remained unchanged. Meaningful configuration/history blocks destructive down. No default is inferred and no historical request is assigned.

Actual development connection verified as localhost/loopback:5432, `reqro_dev`, `reqro_dev_user`, development environment/profile. The established compiled migration CLI applied F048 successfully: **24 applied / zero pending**. The tsx launcher initially failed with the local `uv_os_get_passwd`/ENOMEM environment error before connecting; the existing compiled CLI under Node 24 applied the same migration, without changing its behavior.

CLI inspection showed revision 0 / None; a read-only set dry run validated Alex Example; confirmed set produced revision 1. Retained configuration: **Damaged Street Sign → Alex Example · Staff**, fictional CityVUE Development Municipality. Six Issues total: **one with a default, five without**. Existing Team fixtures are Division-specific and not eligible for this Department-level Issue, so their scope and all routing were preserved.

Pre/post row fingerprints were compared without exposing raw data. All pre-existing rows remain identical except the intentional reference sequence advance to 9. Thirty-one pre-existing tables are entirely identical; six retain all historical rows plus expected additions; the one sequence row advances. New configuration and append-only config audit each contain one intended row.

| Domain                                 | Before → after                 | Explanation                                                                      |
| -------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| Service Requests                       | 8 → 9                          | Only SR-202609-000009 added; Open, PUBLIC, Web, revision 2                       |
| Assignment rows                        | 14 → 15                        | One System-created Alex Example assignment; one current owner on new request     |
| Operational Activity                   | 59 → 61                        | Request created then Request automatically assigned; no historical event changed |
| Security activity                      | 93 → 95                        | New request creation and automatic assignment audits                             |
| Answers / locations                    | 11 → 12 / 8 → 9                | One fictional intake answer/location                                             |
| Watchers                               | 3 → 3                          | None added to new request                                                        |
| Contact / Notes / Communications       | 6 / 3 / 4 unchanged            | Anonymous new request; no protected content additions                            |
| Attachments / finalized batches        | 3 / 3 unchanged                | All three retained object bytes match stored checksums                           |
| Tracking                               | 1 active / 5 revoked unchanged | No credential operation                                                          |
| Role-permission rows / staff-role rows | 34 / 4 unchanged               | Full rows and scope/membership fingerprints unchanged; no grant operations       |
| Issues / published versions            | 6 / 6 unchanged                | Default stored separately; no catalog/routing edits                              |

No live manual reassignment/unassignment was performed. The retained request remains assigned to Alex Example and provides a useful automatic-Activity fixture. No additional live no-default request was necessary: existing unassigned requests plus disposable creation tests cover that state without unnecessary permanent records.

## Authenticated live UAT

Used the existing normal personal Entra session, developer-launched localhost API and local Vite UI. No token extraction, fallback identity or auth bypass. The established F044 lesson remains applicable: restricted-sandbox Microsoft signing-key retrieval failures are authentication connectivity failures, not RBAC failures; use the developer API outside that sandbox.

One anonymous fictional PUBLIC request was created through normal Report an Issue intake: **SR-202609-000009**, Damaged Street Sign, fictional Service Location. The receipt exposed the normal reference/location only, with no assignment, config or staff identity. No attachment/contact/Note/Communication or tracking operation was needed.

| Live observation                          | Result                                                                                                            |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Request Management → Assignment           | Alex Example · Staff, normal summary; no permanent AUTO badge                                                     |
| Manage Assignment                         | Existing dialog shows owner and normal Change Assignment / Unassign actions                                       |
| Recent and Full Activity                  | Distinct automatic event, System, Alex Example · Staff, source label; creation appears earlier                    |
| Assigned / Unassigned                     | Includes / excludes new request respectively                                                                      |
| Assignment sort and reference Live Search | Normal result and owner displayed; no extra search field introduced                                               |
| Desktop/mobile                            | 1440px and 390px; readable Assignment/Activity, controls fit, source text wraps                                   |
| Light/dark                                | Automatic Activity remains readable in both themes; restored light mode                                           |
| Keyboard                                  | Enter opens Assignment/Activity; initial Close focus, Tab navigation, Escape close and focus restoration verified |
| Manual override                           | Covered in database/API tests; optional live mutations intentionally omitted                                      |
| Reload                                    | Owner retained; exactly one automatic event visible after fresh load                                              |
| Developer API log marker                  | User confirmed absent from normal developer-launched API logs                                                     |

Fictional staff Activity example:

```text
Request automatically assigned
System
Assigned to
Alex Example · Staff
Source: Issue default assignment

Request created
Resident · Intake: Web
```

Newest-first presentation is intentional; database chronological order is creation then automatic assignment.

## Files, limitations and delivery

New: F048 migration, development CLI boundary, configuration/resolution helper, shared assignment insertion helper, focused unit/database coverage, feature contract and this report. Updated: database types/CLI/package script; shared creation and F037 ownership caller; Activity allowlist/presentation; fixture migration setup and F046 retry tests; React repository/workspace/design-system tests; architecture/context/roadmap/index documentation. No dependency, hosting, authentication, search, routing or production-resource change.

This is a validated development foundation, not a production administration release. Production UI/API authorization and operational rollout remain deferred. Configuration lookup is an indexed Organization/Issue lookup; target validation is a bounded exact-type/ID query plus scope predicates, with no catalog/member fetch loop or list N+1. Configured creation adds bounded reads and four assignment/revision/history/audit writes. Shared-Issue lock contention and production-scale throughput have not been load-tested. Existing frontend chunk-size warning remains. Accessibility observations are not certification.

The completion response records the resulting local commit hash, clean working tree and ahead/behind state. No push, force-push, shared rebase, deployment, production/client resource use, tracking operation or F049 work is authorized or performed. Next step after local completion is review, with GitHub synchronization requiring separate authorization.

## Current delivery checkpoint

This record accompanies the local `feat(requests): add issue default assignment` commit on `main`, directly after `bf084dc3033fb56e2ba2b9f1dae0dc54241bf73b`. Scope: 28 added/modified files. The user confirmed the remaining logging check as absent. The final integrity comparison preserved the recorded development baseline and intentional additions. Temporary F048 validation logs, scripts and fingerprints were removed before commit. The accepted `origin/main` reference remains unchanged; no remote synchronization was performed.

Changed files:

- `docs/ARCHITECTURE.md`
- `docs/CITYVUE_CONTEXT.md`
- `docs/ROADMAP.md`
- `docs/features/F048-implementation-report.md`
- `docs/features/F048-issue-based-default-assignment.md`
- `docs/features/README.md`
- `react/src/components/ui/presentation.js`
- `react/src/staff/requests/RequestActivity.jsx`
- `react/src/staff/requests/requestRepository.js`
- `react/test/DesignSystem.test.jsx`
- `react/test/StaffRequestRepository.test.js`
- `react/test/StaffRequestWorkspace.test.jsx`
- `server/migrations/20260924000000-add-issue-default-assignment.ts`
- `server/package.json`
- `server/src/database/database.types.ts`
- `server/src/database/development-issue-default.ts`
- `server/src/database/development-staff-cli.ts`
- `server/src/service-request/assignment-write.ts`
- `server/src/service-request/create-service-request.service.ts`
- `server/src/service-request/issue-default-assignment.ts`
- `server/src/service-request/request-activity.domain.ts`
- `server/src/service-request/request-ownership.service.ts`
- `server/test/database/attachment-checks.ts`
- `server/test/database/issue-default-assignment-checks.ts`
- `server/test/database/reference-policy.integration.test.ts`
- `server/test/database/request-audience.integration.test.ts`
- `server/test/database/service-request.integration.test.ts`
- `server/test/unit/issue-default-assignment.test.ts`

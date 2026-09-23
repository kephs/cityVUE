# F049 implementation and validation record

Date: 2026-09-23. Started on `main` at synchronized F048 `58453d18ef2e4e4c8e2b0419cac983fd224d6a13`, clean, 0 ahead / 0 behind the existing `origin/main` reference. No remote operations were performed. Scope: the original F049 specification with the subsequently approved **two-policy** decision; IDENTIFIED_OPTIONAL is intentionally absent.

## Delivered behavior

| Area                             | Result                                                                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| IDENTIFIED_REQUIRED              | PUBLIC requester must be identified; existing name requirement, optional email; anonymous submission rejected                               |
| ANONYMOUS_ALLOWED                | Explicit identified/anonymous choice; no preselected anonymous option; identified follows the same Contact contract                         |
| Anonymous                        | Persisted `anonymous`, no Contact relationship/row; contradictory Contact rejected before writes and by database trigger                    |
| Identified                       | Persisted `identified`; F039 protected Contact remains separately authorized and audited                                                    |
| Historical Contact-less requests | Existing explicit identity retained; an identified request with no Contact remains identified, not inferred anonymous                       |
| Legacy/unspecified state         | Not needed or added: the original schema already required explicit `identified` / `anonymous`; no new input can select an unspecified state |
| Issue policy                     | Stable Organization-scoped, revisioned configuration; affects future creation, never rewrites historical identity                           |
| Staff-assisted PUBLIC            | Existing web/phone/walk_in/staff/api channels preserve authenticated staff submitter even when requester is anonymous                       |
| INTERNAL                         | Authenticated staff requester and submitter remain required; no anonymity or resident Contact shortcut                                      |
| Default assignment               | Separate F048 configuration, resolution and normal owner/history; identity changes do not overwrite assignment configuration                |
| Tracking                         | No live credential retrieval, issue, rotation, revocation or link opening; identity remains independent                                     |
| Communications                   | New anonymous correspondence and correspondence staging denied, even with permissions; authorized historical reads remain available         |
| Search/list                      | No identity column/filter/sort/search expansion; searchable fields remain Reference, Issue name and displayed Service Location              |

The [feature contract](F049-anonymous-request-policy.md) and [ADR-011](../architecture/decisions/ADR-011-explicit-requester-identity.md) record the design. No dependency, authentication architecture, vendor adapter, runtime branding or production infrastructure change was made.

## Configuration, migration and concurrency

Migration `20260925000000-add-requester-identity-policy` creates policy and append-only policy-audit tables plus identity/Contact guards. Organization/Issue composite keys and staff-actor foreign keys enforce tenant integrity. Policy values are database constrained; revisions are positive integers. Existing request identity enum constraints remain. No permissions are registered or granted.

The migration preserves current published legacy behavior: `not_allowed` → IDENTIFIED_REQUIRED; `allowed` and behaviorally equivalent `allowed_with_limitations` → ANONYMOUS_ALLOWED. New unconfigured Issues derive the same mapping from their current publication; an explicit configuration pins policy independently of future versions. Missing publication defaults to identification required. Existing immutable versions are not rewritten. Effective intake catalog output adds the two-valued policy and retains a compatible derived legacy field, without configuration revisions, actors or audit history.

Disposable schemas passed apply/down/reapply with unchanged historical requests. Up refuses contradictory historical anonymous Contact rather than repairing it. Down refuses any retained configuration audit or policy that cannot map back without loss. Meaningful retained request data is not deleted. Personal development target was independently verified as localhost:5432 / reqro_dev / reqro_dev_user with development environment/profile before the established migration CLI applied the migration. Final state: **25 applied / 0 pending**.

The guarded CLI reuses F036 personal-resource checks and F048 explicit Issue/Organization/staff/scope selection. `issue-identity --dry-run` supports `F049_ACTION=inspect`; set additionally requires `F049_POLICY` and `F049_EXPECTED_REVISION`. `--confirm` is the deliberate mutation mode. Existing ignored F036 configuration supplies personal identity inputs; no such values are documented or committed. Damaged Street Sign inspected as ANONYMOUS_ALLOWED revision 1; setting that same policy in dry-run returned `changed: false`. No live configuration mutation or new grant was necessary. Production administration UI/API and policy-admin permission design remain deferred.

Policy writes lock the stable Issue exclusively, check revision, then write config/audit together. Creation holds the compatible shared Issue lock. Tests cover invalid enums (including IDENTIFIED_OPTIONAL), foreign Organization, stale revision, no-op, zero-write read-only dry-run, competing updates with exactly one winner, creation racing a policy change, and audit-failure rollback. Independent F048 rows remain unchanged throughout identity-policy configuration tests.

## Creation transaction and historical retry

Actual order: establish trusted Organization/audience/staff context; load submitted published Issue version; validate identity/Contact consistency, questions and location input; evaluate existing geographic eligibility; begin transaction; validate/lock an F046 claim if supplied; return an already finalized claim's original receipt; lock Issue and validate current action and effective identity policy; resolve eligible F048 default; allocate reference; insert request; finalize evidence if any; insert identified Contact only; insert Service Location and answers; append creation security audit and operational Activity; apply initial owner with normal revision/System history; commit; return creation receipt.

Invalid/missing identity, prohibited anonymous choice, missing identified name and contradictory Contact fail without request/reference writes. Existing request, Contact, reference, assignment, evidence-finalization, Activity and audit failure tests retain transaction rollback. Geographic lookup and earlier staging occur outside the creation transaction; no broader atomicity claim is made.

The F046/F048 retry fixture now creates anonymous evidence with Team A, changes identity policy to required and assignment default to Team B, then retries. It returns the same request/reference/original receipt, remains anonymous with zero Contact, and preserves owner/history/evidence. Concurrent retries and a later manual assignment also preserve the original receipt and do not duplicate records. A new independent anonymous request is denied under the required policy. After policy is allowed again, independent creation uses the current assignment default. General non-attachment submission retry/idempotency semantics are unchanged.

Both historical directions are covered: anonymous created under allowed stays anonymous after required; identified created under required stays identified after allowed. Database attempts to rewrite identity or attach Contact to anonymous fail. No historical Contact is deleted, fabricated or reclassified.

## UI and live UAT

Normal personal Entra session and the developer-launched API outside the restricted sandbox were used. No token copying, fallback identity or authentication bypass. The F044 signing-key retrieval lesson remains applicable: sandbox JWKS failure is authentication connectivity, not a reason to change grants.

Identity controls live in Details, after Service Location and before Photos & Files. Labels are **Report anonymously** and **Provide my name**. Required Issues hide the anonymous option and require the existing name field. The API continues to support optional email; the existing requester UI collects name only. The explanation states that anonymous Contact is not collected and warns against identifying free text/evidence. Validation announces a missing choice; the group has accessible help/error associations.

Live draft checks passed: allowed begins with neither choice; keyboard Space selects; allowed anonymous → Missed Collection required removes the anonymous choice and requires name; reverse Issue change retains identified rather than silently selecting anonymous. Identified → fictional Contact → anonymous → identified leaves name empty. Repeating the toggle before the one submission removed the draft from Review and persistence. Review says **Reporting anonymously**; Back/Edit preserves that choice and keeps Contact absent. Confirmation explicitly says submitted anonymously and displays the authoritative reference.

Exactly one new retained PUBLIC web request: **SR-202609-000010**, Damaged Street Sign, fictional Service Location, Open, revision 2, one active Alex Example owner through the existing F048 default. No additional identified or assisted requests were created live; those creation paths use automated evidence. Database readback confirms expected Organization/Issue, one location and answer, zero Contact/Contact-view audits, zero Notes, Communications, Watchers, attachments and tracking credentials for this request. Staff UI shows **Not provided — submitted anonymously**, no Contact View button, and the truthful correspondence-unavailable notice. No new communication destination is fabricated.

| Staff state                                   | Presentation and evidence                                                                                              |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Anonymous, irrespective of contact permission | Explicit anonymous absence; no View; API safe absence with no contact audit; live + automated                          |
| Identified + contact.read                     | Separate, audited access; dedicated populated Contact dialog; live existing SR-202609-000006 + automated               |
| Identified without contact.read               | Protected; View follows existing permission-denied flow; automated F039/F040 and React coverage; no live grant changes |
| Historical identified without Contact         | Remains identified; authorized empty Contact response is audited; existing integration regression                      |

The existing identified Contact dialog was opened three times for theme/viewport contrast, adding exactly three normal Contact-view security audits. Values were not reproduced in the report. Native dialog focus began on Close, remained contained, Escape closed and returned focus to View. Parent request status/revision/updatedAt, Contact and operational history stayed unchanged.

| Width | Intake choices/name/help | Anonymous Review / Back | Anonymous staff detail | Authorized identified dialog |
| ----- | ------------------------ | ----------------------- | ---------------------- | ---------------------------- |
| 1440  | Light/dark pass          | Light/dark pass         | Light/dark pass        | Light/dark pass              |
| 1280  | Light/dark pass          | Light/dark pass         | Light/dark pass        | Light/dark pass              |
| 1024  | Light/dark pass          | Light/dark pass         | Light/dark pass        | Light/dark pass              |
| 768   | Light/dark pass          | Light/dark pass         | Light/dark pass        | Light/dark pass              |
| 390   | Light/dark pass          | Light/dark pass         | Light/dark pass        | Light/dark pass              |

No horizontal document overflow; identity text and labels wrapped, controls stayed reachable, and keyboard focus was visible. Screenshots and DOM geometry were inspected without committing browser artifacts. Existing desktop navigation wraps at 1280; this pre-existing navigation behavior is outside the F049 control changes. Protected Contact contrast without a grant is automated, not a claimed live revocation exercise. This validation is **not a WCAG certification**.

## Privacy, authorization and prior features

ANONYMITY DOES NOT GRANT STAFF ACCESS or remove existing request authorization. PUBLIC/INTERNAL admission, Organization and hierarchy scope, F039 Contact permission, Notes/Communication permission and ownership-versus-RBAC separation remain. Config cannot be set through requester input. Anonymous Contact denial produces no successful view audit. Policy audit includes only technical Issue/Organization/staff IDs, old/new policy, revision and time. Existing creation audit retains safe classification/channel/actor metadata, never the Contact draft.

Live logging privacy: **PASS, user confirmed “absent.”** Normal developer API logs for the representative submission contained no fictional pre-anonymous Contact draft, raw intake/Contact bodies or bearer tokens. Automated HTTP logging checks also passed. Logs retain safe operational route/status/duration/correlation metadata; no raw captures or draft values are retained here.

ANONYMOUS REQUESTER != UNKNOWN SERVICE LOCATION. F045 operational issue location can remain precise; it is neither requester identity nor residence. Optional device geolocation and Service Location are not used for identity matching. Requester Geography remains unimplemented.

F046 anonymous Request Evidence remains eligible under existing format/size/scan/storage/parent authorization. EXIF/GPS removal and immutable finalized associations remain unchanged. No filename, checksum, metadata, photo/document content or description is analyzed to establish requester identity. Three retained attachment objects passed checksum verification. Existing historical anonymous correspondence can still be read with its independent permissions; new writes and staging are denied. F042 still records correspondence without delivery.

F044 remains independent: no automatic issuance, no identity derived from a credential, unchanged minimized requester projection, **1 active / 5 revoked**. No active credential was retrieved, decoded or opened. F047 searches only **Request Reference, Issue name, displayed Service Location**; not identity mode, Contact, Notes, Communications, Activity, attachments or tracking. F048's retained Issue default and SR-202609-000009 remain unchanged.

No hidden anonymous correlation through IP/user-agent, cookies, fingerprints, location, filenames, EXIF/GPS, description similarity, references, tracking, staff guesses or name/email fragments. No profile, requester history, geography, scoring, analytics or vendor integration was introduced. Infrastructure logs can exist independently; application-level anonymity does not establish infrastructure untraceability or legal guarantees.

## Automated evidence and data integrity

Passed suites: 233 backend unit, 40 API E2E, 216 PostgreSQL integration (zero skipped), 64 shared, 493 React: **1,046 tests**. Backend tests compile using `node node_modules/typescript/bin/tsc -p tsconfig.test.json`, then `node --test` in compiled unit/E2E/database folders (E2E/database use `--test-concurrency=1`). PostgreSQL uses the separately configured TEST_DATABASE_URL loaded without printing credentials. Shared tests use the root manifest's exact Node test list. React uses `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1`.

Backend ESLint, TypeScript no-emit, configured Prettier, backend production build and Vite React production build passed. Frontend has no lint script. Vite retains the existing >500 kB chunk warning. Migration apply/down/reapply and meaningful rollback refusal passed. Changed Markdown links, whitespace and final private-value checks were reviewed before local commit.

Read-only before/after fingerprints compared all 40 pre-existing domain tables. No historical row disappeared or changed except the normal reference-sequence increment for the single new request. Intentional additions: one request, answer, location and owner; two operational events; two creation/assignment security events; three identified Contact-view audits. No new Contact, tracking, evidence, Note, Communication, watcher or grant. New migration tables contain six seeded policy rows and zero policy audit rows. Existing request identities, requests/revisions/timestamps, assignments, watchers, Contact, Activity, Notes, Communications, tracking and catalog rows remain preserved.

Final personal development: 25 migrations / zero pending; five ANONYMOUS_ALLOWED Issues, one IDENTIFIED_REQUIRED; ten requests (three PUBLIC anonymous, six PUBLIC identified, one INTERNAL identified); six Contact rows; no legacy/unspecified identity; three unchanged attachment objects; tracking 1 active / 5 revoked; grants and F048 default unchanged. The retained anonymous request has zero Contact and one normal initial owner. Temporary logs, fingerprint baseline and UAT scripts are removed before commit.

## Changed files and completion boundary

New: F049 migration; requester-identity policy helper; focused database checks; feature specification/report; ADR-011. Updated: catalog repository/service/DTO; database types and guarded CLI/package command; shared creation service; Contact/Communication services and scope projections; attachment parent guard; staff detail capabilities; requester form/review/confirmation; staff Contact/Collaboration presentation; associated unit/database/React fixtures and tests. Architecture, context, roadmap, feature index, README and dated ADR-005/008 amendments document the decision.

F049 is a **development foundation**. Production policy administration/governance, approved privacy wording, infrastructure logging and abuse-control review, records/legal requirements and production deployment validation remain prerequisites. No new email/phone UI, requester delivery, general idempotency, requester profiles or identity correlation is claimed. No new dependency, broad data rewrite, client resource change, push or deployment occurred. F050 was not started. Delivery is the local feature commit after final review; the Git completion message records its hash and final ahead/behind state. GitHub synchronization requires separate authorization.

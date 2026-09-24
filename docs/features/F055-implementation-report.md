# F055 implementation and validation record

Status: implemented and validated locally, including authenticated UAT and user-confirmed responsive/logging checks on 2026-09-24. Starting clean synchronized `main`: `3378141b458c3408b677fd4558a0396b7a41fb2b`. No push, deployment or F056.

## Scope and decisions

See the [specification](F055-admin-participation-area-management.md) and [ADR-016](../architecture/decisions/ADR-016-participation-area-name-uniqueness.md). The existing authoritative F054 shell manages coarse Organization-defined Participation Areas. No framework, routing, identity, vendor integration, branding asset or deployment change. No dependency was added.

Names are trimmed and stored with chosen capitalization; PostgreSQL enforces trimmed case-insensitive uniqueness across active and inactive resources in each Organization. Inactive names remain reserved. Another Organization may reuse the name without information disclosure. The existing exact unique constraint is retained for CLI conflict-target compatibility. Migration fails atomically on collisions, without rewriting or merging rows. Unicode boundary whitespace matches JavaScript trim; lowercase uses configured PostgreSQL semantics, without accent folding, transliteration or internal-space normalization. Control/format/unpaired-surrogate characters are rejected in new names; plain HTML-like text renders as text.

Stable UUID identity and immutable historical request references remain unchanged. F051 analytics uses the current area label, not a snapshot. Deactivation preserves the row and historical contributions, removes new requester selection and is reversible through activation. No DELETE API, geometry, coordinates, requester profile, identity inference or area-based routing exists.

## Authorization and HTTP

Implementation files: the new [migration](../../server/migrations/20261002000000-add-admin-participation-area-write.ts), [controller](../../server/src/admin/admin-participation-area.controller.ts), [domain validation](../../server/src/admin/admin-participation-area.domain.ts), [transactional service](../../server/src/admin/admin-participation-area.service.ts) and [React editor](../../react/src/admin/ParticipationAreaEditor.jsx) are the main additions. Existing Admin module/snapshot/page, permission types and explicit provisioning allowlist, database types, safe error filter/client, and collection-lock helper integrate them. Coverage lives in the new [database checks](../../server/test/database/admin-participation-area-checks.ts), [unit tests](../../server/test/unit/admin-participation-area.test.ts) and [React tests](../../react/test/ParticipationAreaEditor.test.jsx), plus the existing Admin suites. Architecture/context/roadmap, F051–F053 references, feature/ADR indexes and ADR-016 document the change. No dependency or environment file changed.

Personal development configuration is complete: migration applied, the single explicit permission provisioned and the normal Entra session used. Other installations require their own approved migration and administrator provisioning. Rollback intentionally refuses retained audits or grants; no development history was deleted to test rollback.

| Permissions     | Read Admin areas | Manage areas |
| --------------- | ---------------- | ------------ |
| Neither         | 403              | 403          |
| Admin read only | 200              | 403          |
| Area write only | 403              | 403          |
| Both            | 200              | Authorized   |

Intake write, analytics and operational permissions independently confer no area write. Area write confers no operational, Contact, Notes, Communication, attachment, tracking, requester history, geospatial, assignment or analytics access. Definition/migration/bundles grant nothing. F036 supports only explicit selection of the new permission. Every operation uses server-resolved active staff/Organization context; no browser Organization authority or global administrator flag.

| Method and route                              | Accepted input                                                         | Result                                      |
| --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------- |
| POST `/api/v1/admin/participation-areas`      | displayName only                                                       | 201, authoritative area and changed=true    |
| PATCH `/api/v1/admin/participation-areas/:id` | expectedRevision plus exactly one of displayName, active, displayOrder | 200, authoritative area and changed boolean |

Both require both permissions. Unknown body/query fields and invalid values return 400; unknown/foreign IDs share 404; stale revisions return 409; missing authentication/permission returns 401/403. Duplicate create/rename is 400 with the fixed message “A Participation Area with this name already exists.” Final-active validation uses another fixed allowlisted code/message. No arbitrary exception text is added to safe responses. All successful responses are no-store; existing error middleware remains in effect.

## Revision, ordering and transactions

Creation starts at revision 1, active, after the largest configured display order. Existing-area mutations compare a positive PostgreSQL integer expectedRevision before no-op detection. The existing database trigger increments only meaningful changes. Reads, identical writes and failures do not advance revisions or append successful audits. Two changing writes at the same revision yield one success and one 409. Different-area revisions remain independent.

The keyboard-operable numeric order editor is the explicitly permitted first-version alternative to Move Up/Down. Lower values appear first; ties are valid and use current name then stable ID. Inactive resources retain their order, with requester intake filtering them out. One order change is one conditional row update and audit in one transaction. There is no multi-row reorder, automatic normalization, ordinal uniqueness constraint or global list revision; no partial batch can commit because batches are not exposed. PostgreSQL integer limits are enforced and exhausted append order fails safely.

All F055 writes lock the trusted Organization before the area. This serializes create ordering and the final-active invariant with F053 collection changes and F051 admission, without incrementing an Organization/global revision. The shared collection provisioning helper now explicitly follows that same lock order. Enabled collection requires an active area for final-area deactivation/enable validation; disabled collection permits all areas inactive. Activation/create never enables collection. Production contention under very high write volume has not been load-tested.

Required immutable audit is resource-specific: Organization, internal staff actor, area ID, action, safe old/new name/active/order, prior/new revision, correlation UUID and timestamp. Actions are created, renamed, activated, deactivated and reordered. Required audit failure rolls back configuration/revision. No-op, 401/403/404/409, validation and rolled-back operations do not append successful change audits. UPDATE/DELETE/TRUNCATE are blocked; retained audits/grants prevent destructive migration rollback. No requester-level geography, Contact, provider identity, credential, suppressed counts or arbitrary JSON payload belongs in this audit.

## Automated evidence

| Check                       | Result                                |
| --------------------------- | ------------------------------------- |
| Backend unit                | 246 passed                            |
| API E2E                     | 40 passed                             |
| PostgreSQL integration      | 282 passed, zero skips                |
| Shared                      | 64 passed                             |
| React                       | 550 passed in 39 files                |
| TypeScript/test compilation | Passed                                |
| Backend lint                | Passed                                |
| Server formatting           | Passed                                |
| Backend production build    | Passed                                |
| Frontend production build   | Passed; existing large-chunk advisory |
| Frontend lint               | No configured script                  |

Total: 1,182 full-suite passes. The PostgreSQL suite includes real HTTP F055 requests using the existing test-only verifier and actual database authorization. This is automated evidence, separate from normal authenticated live UAT.

Coverage includes migration apply/down/reapply, collision refusal without existing-row mutation, zero default grants, direct SQL and HTTP create/rename uniqueness races, rejected-original state preservation, case/whitespace/inactive-name behavior, cross-Organization reuse and ID isolation, strict DTO/query rejection, no DELETE, same-revision races, independent-area order edits, no-op and GET stability, final-active behavior, collection-enable/deactivation race, final-two deactivation race, audit rollback/immutability, retained history, stable-ID renamed/reordered intake admission and rejected inactive stale selection. Existing F039–F054 suites pass, including anonymous/Contact/Requester separation, suppression, requester projection and F053 audit/concurrency behavior.

React covers read-only controls, add/rename/order validation and submission, duplicate guidance, dirty/cancel behavior, Cancel focus restoration, confirmation/dialog semantics, last-active UI/backend denial, activation, 401/403 removal of controls, distinct 409 and explicit Refresh, empty/invalid states, XSS text rendering, duplicate-submit prevention, unmount abort and stale-result suppression. Numeric order editing works by keyboard. Responsive visual checks remain live evidence, not a jsdom claim or WCAG certification.

The environment lacks npm on PATH, so checks used the package scripts' installed Node entrypoints and exact test working directories. Initial suite invocation accidentally passed personal-development identity configuration into isolated E2E/database tests; rerunning with only TEST_DATABASE_URL corrected that invocation and all checks passed. Initial lint findings and a Cancel-focus regression were fixed. No assertion was weakened to make tests pass; the prior revision diagnostic was preserved in a disclosure. Formatting was rerun after the final added database tests.

## Development migration and pre-grant state

Verified personal target: localhost:5432 / reqro_dev / reqro_dev_user / development. The `tsx` launcher failed at Windows user-info initialization before running a migration. The same established migration CLI compiled by the repository test build then successfully applied `20261002000000-add-admin-participation-area-write`. Development now has **32 applied migrations / zero pending**.

Post-migration integrity comparison found only one migration record, one permission definition and the empty F055 audit table. All original monitored table row hashes, canonical branding assets and private local-file hashes were unchanged; tracking comparison uses safe metadata only, never credential digests. Collection Enabled/revision 3, branding REQRO_DEFAULT/revision 3, three active areas/revision 1, existing grants, two F053 audits and SR-202609-000013 are preserved.

Signed-in `/admin/participation` showed three safe read-only areas and no mutation controls. A temporary local harness used the normal AuthRoot/MSAL/API client and a current same-name PATCH, with no copied tokens or fallback identity. It returned HTTP 403. After review the user explicitly confirmed “HTTP 403 confirmed”. The established F036 CLI dry-run and confirmed provisioning selected only `admin.participation_areas.write`, retaining the existing Public Works/Streets and Community Services/Parks scopes. No other grants changed.

## Live UAT and final integrity

Exactly one fictional area was created with a long display name and boundary spaces. Persistence trimmed the name. Normal authenticated UI actions produced this sequence on the same area identity:

| Revision | Successful action                                          |
| -------- | ---------------------------------------------------------- |
| 1        | Create active, appended at order 3                         |
| 2        | Rename to West Demo District                               |
| 3        | Change display order to −1                                 |
| 4        | Deactivate after confirmation                              |
| 5        | Reactivate existing area                                   |
| 6        | First of two editors renames to West Demo District Updated |
| 7        | Restore name West Demo District                            |
| 8        | Restore display order 3                                    |

Creating `west demo district` while that area was inactive returned the safe duplicate guidance, reserving the name. A second editor at revision 5 attempted another rename after revision 6 and displayed the 409 conflict; Save was disabled, and explicit Refresh loaded the authoritative name without replaying the edit. Neither rejection added an area, revision or audit. Eight successful actions have exactly eight immutable audits, all linked to the same retained area.

Keyboard Enter submitted changes, empty-name validation disabled Save, dialog entry focused Cancel, Escape closed it and restored the initiating button, and Cancel edit restored Add focus. Success/error feedback received focus. Light/dark screenshots and DOM inspection showed wrapping at the available browser sizes. The viewport override did not apply requested sizes reliably; those attempts are not claimed as five-width evidence. The user separately confirmed **PASS** for 1440/1280/1024/768/390 in both themes, covering list, long-name/edit form, buttons, confirmation and error wrapping without horizontal scrolling. This is development UAT, not WCAG certification.

The public requester projection omitted the inactive area, then offered the reactivated area first at order −1. The resident Pothole details form finally displayed North, Central, South, West Demo District in order after restoration to 3. No request was submitted. Configuration Status reported four active areas, collection enabled, default Reqro branding and threshold 5, with all checks OK. Final-active protection uses passing disposable tests; the original three development areas were never deactivated.

For the denied, successful and stale-conflict operations, the user confirmed sensitive log fields were **absent**: full mutation bodies, requester geography, request references/Requester IDs, Contact, provider subjects, bearer tokens, tracking credentials and exact analytics counts. No logs were pasted or captured by this task.

Final read-only row-hash comparison shows only the expected migration/permission/grant additions, one new Participation Area, eight new audits and the F036 role provenance update. Reconstructing that role without the one added permission exactly reproduces its baseline hash. Every other original row hash is unchanged, including all three original areas (active, revision 1, orders 0/1/2), historical request references including SR-202609-000013, operational records, assignments, requester/contact/communication/attachment records and existing audits. Collection remains Enabled/revision 3; default branding revision 3; two F053 audits; tracking one active/five revoked. Tracking comparison used safe metadata only, with no credential inspection or operation. Canonical branding assets and private local files have unchanged hashes. The actual configured suppression threshold remains 5. Development has 32 migrations/zero pending and one intentional area-write grant; existing read, Intake write, analytics and operational grants remain independent.

## Performance and threat review

The Admin snapshot retains five bounded/set-based data queries (Organization, branding, totals/health, Issue page, area page), plus transaction setup and established authentication/authorization. Area page size remains 25. Requester projection uses Organization lookup plus active areas sorted by order/name/ID. No request metrics or per-area query loop is introduced.

Create uses one transaction and four data statements: Organization lock, highest-order lookup, insert, audit. Changed rename/order/activation uses four: Organization lock, scoped area lock/read, conditional update, audit. Enabled deactivation adds one active-area existence query. No-op uses two reads/locks and no audit. Uniqueness is arbitrated by the database index without a separate existence leak. Existing Organization/ID and active/order indexes remain; one expression index is added for the approved stronger uniqueness. No N+1. Expected configuration is small; retained pagination handles larger catalogs. This is not a production load benchmark.

Server permissions/Organization predicates address read-only, Intake/analytics/operational writers, forged Organization and foreign-ID substitution. Strict one-field DTOs address mass assignment; bounded plain text and React escaping address HTML/XSS. Conditional revisions and explicit refresh address stale/concurrent edits; transactions and required audits address partial commits. Organization-first locks address collection/area races; authoritative F051 intake admission addresses stale resident drafts. Stable foreign keys/current labels and absence of DELETE preserve history. Domain separation prevents new identity/contact/geography inference/routing capabilities. Fixed error codes, existing log allowlists and user-confirmed live logging review limit disclosure. Production administrator over-provisioning, governance, audit retention, database access, support/recovery, collation policy and load validation remain operational prerequisites.

## Final review

Temporary authorization harness and ignored integrity scripts/baseline are removed before commit. No API log or browser screenshot capture was saved. The normal Admin page remains available for review.

Final independent review added an authoritative read recheck after a 401/403 area write: configuration clears immediately, and reappears only when Admin read still succeeds. This avoids retaining configuration when both permissions were revoked. The affected Admin/area-editor/Intake suites passed all 38 tests (including two new read-revocation cases); the frontend build passed again. No backend changes followed its full passing suites. Git whitespace and added-line/private-value scans passed. A broad scan identified an unchanged validation-only connection literal in the accepted disposable test harness; its DatabaseService is overridden, it is outside the added diff, and its password differs from the personal development connection. It is not a newly introduced credential.

Recommended next step: review this local F055 change. Push, deployment and subsequent features require separate authorization.

## Explicit pre-commit gate answers

All 80 answers match the required outcomes. Ordering answers refer to the approved single-resource numeric editor and its atomic conditional update.

| #   | Check                                                                                                | Answer |
| --- | ---------------------------------------------------------------------------------------------------- | ------ |
| 1   | Does admin.configuration.read alone allow Participation Area writes?                                 | NO     |
| 2   | Does admin.participation_areas.write have zero default grants?                                       | YES    |
| 3   | Does admin.intake_settings.write allow area writes?                                                  | NO     |
| 4   | Does analytics.service_participation.read allow area writes?                                         | NO     |
| 5   | Does service_request.read allow area writes?                                                         | NO     |
| 6   | Is trusted Organization server-resolved?                                                             | YES    |
| 7   | Can browser choose 7. Can browser choose trusted Organization?                                       | NO     |
| 8   | Can Organization A mutate Organization B Participation Areas?                                        | NO     |
| 9   | Is the mutation surface narrow and typed?                                                            | YES    |
| 10  | Is destructive Participation Area deletion implemented?                                              | NO     |
| 11  | Can unknown DTO fields mutate area configuration?                                                    | NO     |
| 12  | Is expectedRevision required for existing-area mutations?                                            | YES    |
| 13  | Can stale write overwrite current area configuration?                                                | NO     |
| 14  | Does stale write return 409?                                                                         | YES    |
| 15  | Does stale write increment revision?                                                                 | NO     |
| 16  | Does stale write create a successful mutation audit?                                                 | NO     |
| 17  | Does successful mutation increment revision according to the approved resource model?                | YES    |
| 18  | Do GET/Refresh operations increment revision?                                                        | NO     |
| 19  | Does same-value no-op avoid misleading change audit?                                                 | YES    |
| 20  | Are concurrent writes to the same revision protected?                                                | YES    |
| 21  | Can independent area resources be updated without unnecessary global conflicts?                      | YES    |
| 22  | Is reorder concurrency explicitly protected?                                                         | YES    |
| 23  | Is reorder atomic?                                                                                   | YES    |
| 24  | Can reorder failure leave partial ordering?                                                          | NO     |
| 25  | Does successful create generate an administrative audit?                                             | YES    |
| 26  | Does successful rename generate an administrative audit?                                             | YES    |
| 27  | Does successful activation/deactivation generate an administrative audit?                            | YES    |
| 28  | Does successful reorder generate an administrative audit?                                            | YES    |
| 29  | Can audit failure leave a committed configuration mutation?                                          | NO     |
| 30  | Does audit contain requester-level geography?                                                        | NO     |
| 31  | Can area name execute HTML/JavaScript?                                                               | NO     |
| 32  | Are duplicate-name semantics explicitly defined and enforced according to the approved model?        | YES    |
| 33  | Does deactivation delete the Participation Area?                                                     | NO     |
| 34  | Does deactivation rewrite historical requests?                                                       | NO     |
| 35  | Does deactivation remove historical analytics?                                                       | NO     |
| 36  | Does deactivation remove the area from new requester choices?                                        | YES    |
| 37  | Can a deactivated area be reactivated?                                                               | YES    |
| 38  | While collection is Enabled, can the final active Participation Area be deactivated?                 | NO     |
| 39  | While collection is Disabled, may all Participation Areas be inactive?                               | YES    |
| 40  | Does activating an area automatically enable collection?                                             | NO     |
| 41  | Does adding an area automatically enable collection?                                                 | NO     |
| 42  | Does Participation Area mutation change the collection revision?                                     | NO     |
| 43  | Does Participation Area mutation change the privacy threshold?                                       | NO     |
| 44  | Does Participation Area mutation grant/revoke analytics access?                                      | NO     |
| 45  | Does Participation Area management expose requester-level analytics?                                 | NO     |
| 46  | Does Participation Area management expose exact suppressed counts?                                   | NO     |
| 47  | Are only active areas available to new requester intake?                                             | YES    |
| 48  | Can a stale resident draft submit a newly inactive area successfully?                                | NO     |
| 49  | Does renaming an active area change its stable identity?                                             | NO     |
| 50  | Does reorder invalidate an otherwise valid selected area?                                            | NO     |
| 51  | Can anonymous requests continue to provide an active Participation Area without becoming identified? | YES    |
| 52  | Does Participation Area management create Contact?                                                   | NO     |
| 53  | Does Participation Area management create F050 Requester linkage?                                    | NO     |
| 54  | Does Participation Area management add geography to Requester History?                               | NO     |
| 55  | Does Participation Area management change Service Location?                                          | NO     |
| 56  | Does Participation Area management use device location?                                              | NO     |
| 57  | Does Participation Area management use photo GPS/EXIF?                                               | NO     |
| 58  | Does Participation Area management use IP-derived geography?                                         | NO     |
| 59  | Does Participation Area management persist requester coordinates?                                    | NO     |
| 60  | Does Participation Area management create GIS geometry?                                              | NO     |
| 61  | Does Participation Area management change default assignment?                                        | NO     |
| 62  | Does Participation Area management introduce area-based routing?                                     | NO     |
| 63  | Does Participation Area management change request priority?                                          | NO     |
| 64  | Does Participation Area management change request status?                                            | NO     |
| 65  | Does Participation Area management change watcher membership?                                        | NO     |
| 66  | Does Participation Area management expand F047 Live Search?                                          | NO     |
| 67  | Does Participation Area management affect Requester Tracking?                                        | NO     |
| 68  | Does Participation Area management affect attachments?                                               | NO     |
| 69  | Does Participation Area management affect Requester Communication?                                   | NO     |
| 70  | Does Participation Area management affect Requester Contact?                                         | NO     |
| 71  | Is the F054 Reqro branding foundation unchanged?                                                     | YES    |
| 72  | Are canonical Reqro assets unchanged?                                                                | YES    |
| 73  | Is branding revision unchanged unless independently modified?                                        | YES    |
| 74  | Is F053 Intake Settings write authorization unchanged?                                               | YES    |
| 75  | Is F053 expectedRevision / 409 behavior unchanged?                                                   | YES    |
| 76  | Are legitimate F053 audits preserved?                                                                | YES    |
| 77  | Are F051 suppression/privacy boundaries unchanged?                                                   | YES    |
| 78  | Is Requester Tracking operated during F055?                                                          | NO     |
| 79  | Are production/client/cloud resources changed?                                                       | NO     |
| 80  | Is deployment performed?                                                                             | NO     |

## Post-F055 presentation refinement

See [Participation Setup consolidation](F055-participation-setup-refinement.md). The canonical `/admin/participation` composes Service Participation and Participation Areas; `/admin/intake` redirects there. Backend resources, write permissions, revisions, APIs and audits remain separate. The approved numeric Change order workflow retains persisted values. Historical evidence above describes its original checkpoint; the user subsequently created Fictional North-East Area, producing the reconciled five-area/nine-audit baseline.

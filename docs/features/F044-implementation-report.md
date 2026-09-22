# F044 — Secure Requester Tracking Implementation Report

## Checkpoint and scope

Starting branch: `main`. Accepted starting HEAD and unchanged local `origin/main`: `19af51623d1770601272b5d97a3fd0c49e0868d4`.

Final commit: the local `feat(requests): add secure requester tracking` commit containing this report. Resolve its exact hash with `git log -1 --format=%H -- docs/features/F044-implementation-report.md`; the post-commit completion response supplies that hash and verified Git status. A commit cannot embed its own final hash without changing it.

F044 implements a separate PUBLIC-only requester tracking boundary and explicitly authorized staff management. The [specification/UAT record](F044-secure-requester-tracking-foundation.md) preserves chronological evidence; [ADR-009](../architecture/decisions/ADR-009-secure-requester-tracking.md) remains the accepted design. The final review made documentation-only corrections, preserved both validated UI fixes and performed no credential mutation, grant change or migration application. Nothing was pushed or deployed; no remote/cloud/client resource was changed. F045 was not started.

## Complete commit inventory

Every file below was reviewed against the accepted HEAD, including complete new files. Categories: A permanent implementation; B permanent test; C permanent documentation; D required migration; E development provisioning/tooling. The reviewed set contains 42 files: 19 A, 11 B, 10 C, one D and one E. There are no temporary F or unrelated/unexpected G files in the commit set.

| File                                                                      | Category | Purpose                                                                               |
| ------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `firebase.json`                                                           | A        | Tracking privacy headers; existing SPA rewrite preserved                              |
| `react/index.html`                                                        | A        | Early no-referrer policy                                                              |
| `react/src/app/router.jsx`                                                | A        | Separate lazy requester route, outside staff shell                                    |
| `react/src/main.jsx`                                                      | A        | Credential bootstrap before routing                                                   |
| `react/src/staff/requests/RequestManagement.jsx`                          | A        | PUBLIC-only tracking entry and identity/capability reset key                          |
| `react/src/staff/requests/RequesterTracking.jsx`                          | A        | Authorized management dialog, one-time link, explicit Copy and lifecycle confirmation |
| `react/src/staff/requests/requestRepository.js`                           | A        | Authenticated management calls and allowlisted response mapping                       |
| `react/src/staff/requests/staffRequests.css`                              | A        | Mobile Close-button fix                                                               |
| `react/src/tracking/RequesterTrackingPage.jsx`                            | A        | Minimal requester presentation and safe failure/retry states                          |
| `react/src/tracking/tracking.css`                                         | A        | Responsive requester styling                                                          |
| `react/src/tracking/trackingSession.js`                                   | A        | Private in-memory credential, fragment scrubbing, same-tab handling                   |
| `server/src/auth/auth.types.ts`                                           | A        | Register explicit management permission, without grants                               |
| `server/src/database/database.types.ts`                                   | A        | Typed independent credential table                                                    |
| `server/src/service-request/service-request.module.ts`                    | A        | Register services/controllers/privacy middleware                                      |
| `server/src/service-request/staff-request-policy.ts`                      | A        | PUBLIC management capability                                                          |
| `server/src/service-request/request-tracking.controller.ts`               | A        | Guarded management and separate requester endpoint; privacy middleware                |
| `server/src/service-request/request-tracking.domain.ts`                   | A        | CSPRNG, canonical input, digest and normalized status                                 |
| `server/src/service-request/request-tracking.repository.ts`               | A        | Scoped state, locked active lookup and explicit safe projection                       |
| `server/src/service-request/request-tracking.service.ts`                  | A        | Parent authorization and atomic lifecycle/audit                                       |
| `react/test/InternalNotes.test.jsx`                                       | B        | Preserve focus assertion while awaiting React effect                                  |
| `react/test/StaffRequestRepository.test.js`                               | B        | Capability and management projection/transport coverage                               |
| `react/test/StaffRequestWorkspace.test.jsx`                               | B        | Preserve Activity focus assertion while awaiting effect                               |
| `react/test/RequesterTracking.test.jsx`                                   | B        | Fragment/lifetime/privacy/management and same-tab regressions                         |
| `server/test/database/development-staff.integration.test.ts`              | B        | Explicit 21-key provisioning bundle behavior                                          |
| `server/test/database/request-audience.integration.test.ts`               | B        | Integrate tracking checks into isolated authorized API/database suite                 |
| `server/test/database/request-tracking-checks.ts`                         | B        | Migration, authorization, concurrency, rollback, privacy and parent preservation      |
| `server/test/e2e/request-tracking.e2e.test.ts`                            | B        | Real HTTP sanitation, throttling and privacy headers                                  |
| `server/test/unit/development-staff-input.test.ts`                        | B        | Explicit bundle expansion                                                             |
| `server/test/unit/staff-request-policy.test.ts`                           | B        | Read-only capability remains false                                                    |
| `server/test/unit/request-tracking.domain.test.ts`                        | B        | Credential shape/randomness/hash and status mapping                                   |
| `server/migrations/20260922000000-add-requester-tracking.ts`              | D        | Credential table, constraints/history, permission registration and audit types        |
| `server/src/database/development-staff-input.ts`                          | E        | Add one explicit key to local operator bundle                                         |
| `docs/ARCHITECTURE.md`                                                    | C        | Current F044 boundaries and migration checkpoint                                      |
| `docs/CITYVUE_CONTEXT.md`                                                 | C        | Current product checkpoint, preserving historical context                             |
| `docs/ROADMAP.md`                                                         | C        | Current completion plus unnumbered stakeholder requirements                           |
| `docs/architecture/decisions/README.md`                                   | C        | ADR/evidence navigation                                                               |
| `docs/architecture/decisions/ADR-009-secure-requester-tracking.md`        | C        | Accepted credential architecture and residual risks                                   |
| `docs/development/REQRO_CODEX_PROTOCOL.md`                                | C        | Sandboxed signing-key retrieval recovery lesson                                       |
| `docs/features/F036-safe-development-staff-authorization-provisioning.md` | C        | Validated explicit F044 provisioning addendum                                         |
| `docs/features/README.md`                                                 | C        | Current feature/evidence index                                                        |
| `docs/features/F044-secure-requester-tracking-foundation.md`              | C        | Specification, chronological UAT and final validation                                 |
| `docs/features/F044-implementation-report.md`                             | C        | This complete review/completion record                                                |

`react/f044-layout-uat.html` was a **temporary F044 browser/UAT fixture (F)**, not permanent tooling. It imported real components/CSS with synthetic read-only state/transport, was removed after validation, and was explicitly confirmed absent during final review. It is not committed. Temporary tabs were closed and viewport overrides reset. No UAT screenshots are included. Ignored build output and local environment/log files are excluded from Git; no F/G item is staged. Formatting-only churn around the new router route and HTML policy was inspected; existing routes and Firebase SPA rewrite remain intact. No dependency or lockfile change was introduced.

## Credential and authorization review

The server generates 32 random bytes with Node crypto and returns canonical unpadded base64url only after successful issuance/rotation. It stores SHA-256 hexadecimal digests, never recoverable raw links. High entropy makes fast hashing appropriate here; this is not password hashing. Possession authorizes the projection, not verified human identity.

Management requires normal Entra-authenticated PUBLIC parent read, trusted active staff/Organization and current Department/Division scope, plus `service_request.tracking.manage`. The permission cannot bypass the parent boundary; ordinary parent access does not imply it. INTERNAL requests fail both scoped API eligibility and the credential insert guard. Browser capabilities only control presentation. F036 registers/expands an explicit development bundle; migrations, startup and sign-in grant nothing automatically.

Parent-first locking serializes state changes and authorized reads. Expected management versions reject stale actions. Required metadata-only security audit and credential changes share a transaction. A partial unique index enforces at most one active credential per Organization/request. Rotation revokes the current credential before inserting its replacement in the same transaction; failures roll both back. Revoked rows remain immutable. Lookup hashes the dedicated header, resolves the authoritative Organization/request, locks and rechecks active credential, PUBLIC audience and active Organization before projection. Reference, UUID and query overrides cannot select a different authorized parent.

The requester projection contains only reference, versioned Issue name/safe icon, normalized status, submittedAt, original description and entered service location. On Hold maps to In Progress; unknown status maps to Unavailable. Notes, Activity, Contact, staff identity, UUID/revision, routing, assignment/watchers, capabilities, audit and F042 correspondence are excluded. Description/location can contain incidental sensitive text; no automatic redaction or production field-sensitivity policy is claimed.

## Raw-secret and transport review

Tracking links use the current frontend origin and `/track#<credential>`. Bootstrap removes the initial fragment before router construction; mounted same-tab replacement links are consumed/scrubbed. The credential is private module memory and travels only through `X-Requester-Tracking`, with requester fetch using no-store, omitted cookies, no-referrer and redirect rejection. Page departure clears the retained credential; StrictMode replay is handled without prematurely discarding it. Management retains the new link only in component memory and clears it on dialog close or request/access/auth context changes. State retrieval returns only status/version. Copy uses the clipboard only on explicit user action and reports failure safely. Clipboard/history/extensions can retain copies; JavaScript memory zeroization and recall of already disclosed information are not promised.

Tracking/management API responses, including denied/throttled responses, receive no-store, no-referrer and noindex headers before guards. The HTML referrer meta precedes scripts/assets. The requester page uses noindex metadata and local assets; Firebase adds tracking route privacy headers while retaining the existing SPA rewrite and no-store HTML behavior. No hosting resource was modified. Existing Pino allowlists log route templates, safe outcomes and correlation rather than headers, raw URLs, query/body or exception content. No new console logging was added. TLS, proxy header exclusions and distributed throttling remain production gates.

The final scan covered the complete committable file set and relevant generated server/frontend/test output and the two existing local F044 log files. It compared candidates against all four retained digests in memory: no live raw credential or digest appeared in commit content or scanned logs/artifacts. No literal live tracking URL, JWT or private key was found. Personal configuration exact-value checks found only expected public Entra tenant/API application identifiers in ignored frontend bundles; no matching personal/authentication values were found in committable files. Those bundles are not committed. Existing synthetic credential-bearing database test URLs were checked against accepted HEAD and were not introduced by F044. No screenshots containing tracking links are committed. This is scoped scan/test evidence, not an assertion about unavailable browser history, clipboard, third-party or uncaptured logs.

## Final read-only database and grant evidence

Target was verified as personal localhost `reqro_dev`. Final review used a read-only transaction. There are **22 applied migrations, zero pending, zero active credentials and four revoked credentials**. Migration `20260922000000-add-requester-tracking` was already applied during the earlier authorized phase; it was not reapplied. Meaningful history/grants prevent unsafe rollback. No final-review issue, rotate, revoke, reissue or grant operation occurred.

PUBLIC `SR-202609-000007` remains Open, revision 26, updatedAt `2026-09-22T01:47:20.478Z`. INTERNAL `DEV-202609-00000003` remains On Hold, revision 24, updatedAt `2026-09-20T09:56:47.999Z`. PUBLIC complete parent/child hashes match the retained post-manual-UAT read-only snapshot: one Internal Note, two Requester Communications, 27 operational Activity records, seven assignment-history records (one current individual assignment), one watcher and zero structured Contact records. Security audit is a separate stream: two issuances, two rotations and two revocations, with only approved action/policy/correlation metadata. The additional manual lifecycle actions were explained by the user; they are not product concurrency defects.

The final operator has exactly 21 explicit keys, equal to the reviewed FULL_UAT_OPERATOR manifest, without wildcard or geospatial permissions: `catalog.issue_action.manage`, `service_request.assign`, `service_request.close`, `service_request.communication.create`, `service_request.communication.read`, `service_request.contact.read`, `service_request.create`, `service_request.create_internal`, `service_request.hold`, `service_request.internal.read`, `service_request.internal.update`, `service_request.note.create`, `service_request.note.read`, `service_request.reference.manage`, `service_request.reopen`, `service_request.resume`, `service_request.route`, `service_request.start_work`, `service_request.tracking.manage`, `service_request.view`, `service_request.watchers.manage`. Scope remains Public Works / Streets and Community Services / Parks. The authenticated negative baseline preceded the earlier explicit single-key provisioning.

**Evidence limitation:** current row/state comparisons and recorded parent values support preservation, but there was no complete authoritative child-state snapshot immediately before the user's manual lifecycle. Do not recast post-operation equality as a complete before/after manual-UAT proof. Disposable database tests independently establish lifecycle atomicity and parent/child invariants.

## UAT and concurrent fixes

The user reported replacement-link success, old-link failure after rotation, no redisplay of the active raw link on reopening management, failure after final revocation and requester-safe-only content. These remain **user-reported manual results**, not agent-observed HTTP captures. Earlier observed A issuance/requester rendering, protected baseline and responsive/keyboard checks are preserved separately in the UAT record. All additional manual rotations/issuance were reconciled; final tracking stays inactive. No active credential is needed between features.

`staffRequests.css` prevents the dialog header's Close button shrinking and wrapping. Browser UAT first identified the mobile label defect; the focused `flex-shrink: 0`/`white-space: nowrap` fix belongs to F044's tracking dialog and preserves the shared dialog pattern. Actual component/CSS browser checks passed at 390 pixels light/dark and 320 pixels dark with a one-line label and no dialog overflow. DOM geometry and screenshots support the layout result; jsdom unit tests are not represented as layout measurements.

`trackingSession.js` consumes a fragment in `retain()` as well as on hashchange, covering a link arriving between bootstrap and lazy page mount. A browser UAT reload/same-tab sequence exposed the failure; the permanent RequesterTracking test reproduces this timing, and replacement-link/stale-denial and StrictMode/lifetime tests preserve related behavior. A non-mutating real-component browser fixture updated first/replacement/first synthetic projections in one tab and scrubbed fragments. Actual `/track` rejected non-issued synthetic input safely and scrubbed reload-arriving fragments after mount. This validates navigation without issuing a new development credential; synthetic success is not claimed as another live bearer check. Both fixes were preserved after overlapping edits were reconciled.

Earlier requester success views fit 1440, 1280, 1024, 768 and 390 pixels in light/dark themes; dark management dialog bounds fit the same widths. Keyboard Tab had visible focus, Escape closed and restored focus. Accessible headings, plain-text rendering, status/error announcements and the existing native dialog behavior remain. This is development evidence, not WCAG certification.

## Validation

The completed checkpoint has **877 passing automated tests**: backend unit 206, API E2E 39, PostgreSQL integration 174 with zero skips, shared 62 and React 396. Exact script-equivalent invocations and the corrected test-environment run are in the [UAT record](F044-secure-requester-tracking-foundation.md#non-mutating-ui-and-final-validation). Final review changes only documentation; the unchanged application/test sources retain that evidence without unnecessary lifecycle reruns.

The final commit gate passed TypeScript, backend lint and configured formatting, backend/frontend builds, documentation formatting/relative links, private-value checks and `git diff --check`. Frontend lint has no configured script and is not claimed. Existing frontend large-chunk/plugin-timing notices and Git line-ending notices are non-failing. No application/test source changed during final review; the 877-test checkpoint remains applicable.

The initial earlier database test attempt loaded development identity opt-in alongside test-owned Entra settings and failed configuration setup. Loading only the verified TEST_DATABASE_URL resolved the harness configuration; all 174 database tests then passed with zero skips. No product auth/configuration was weakened. The earlier live 401 incident was separately caused by restricted-sandbox signing-key retrieval: token-free probes distinguished sandbox EACCES from successful outside-sandbox connectivity. The developer launched the API outside the restriction. The [protocol lesson](../development/REQRO_CODEX_PROTOCOL.md) preserves this diagnosis without suggesting grants, token copying or auth bypass as repairs.

## Final architecture checklist

| Question                                                      | Answer and review basis                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Is reference requester authorization?                         | No; credential header lookup only                                                                                 |
| Is UUID requester authorization?                              | No; cannot select/authorize parent                                                                                |
| Is the credential cryptographically strong?                   | Yes; 32 CSPRNG bytes                                                                                              |
| Is raw credential persisted by Reqro?                         | No; digest-only database and transient application memory                                                         |
| Is digest exposed by the API/UI?                              | No; explicit response projections                                                                                 |
| Can INTERNAL requests receive credentials?                    | No; API scope and database guard                                                                                  |
| Does management permission bypass parent staff authorization? | No; both checks required                                                                                          |
| Does normal parent read grant management?                     | No; independent explicit permission                                                                               |
| Is tracking restricted to requester-safe fields?              | Yes; explicit SQL/DTO/UI allowlists                                                                               |
| Are Internal Notes excluded?                                  | Yes                                                                                                               |
| Is staff Activity excluded?                                   | Yes                                                                                                               |
| Is the staff Contact projection excluded?                     | Yes                                                                                                               |
| Are assignment/watchers/routing excluded?                     | Yes                                                                                                               |
| Are F042 Communications excluded?                             | Yes                                                                                                               |
| Does rotation invalidate the old credential?                  | Yes; disposable tests and qualified manual UAT                                                                    |
| Does revocation invalidate the active credential?             | Yes; disposable tests and qualified manual UAT                                                                    |
| Are final reqro_dev active credentials zero?                  | Yes; read-only database verification                                                                              |
| Are raw credentials absent from logs/audit/Git?               | Yes within reviewed code, audit, scan and captured test/log scope; external/unavailable artifacts are not claimed |
| Are no default tracking grants introduced?                    | Yes; registration only, explicit F036 provisioning                                                                |
| Was no external delivery/deployment introduced?               | Yes; no delivery adapter or remote changes                                                                        |

## Deferred work and stop point

The [Roadmap](../ROADMAP.md#deferred-stakeholder-requirements-unnumbered) now records all requested unnumbered stakeholder requirements: requester issue location experience; attachments/photos; anonymous-request policy; service location versus requester geography versus device location; EXIF/GPS privacy; requester identity/history; issue/requester geography and service participation analytics; privacy-preserving aggregate analytics; administration/configuration. No future feature IDs were assigned and none was implemented.

Automatic expiry, identity verification/accounts, multiple/delegated links, resident history/correspondence, delivery/notifications, attachment pipelines, production proxy/TLS/distributed-rate-limit validation, legal/retention policies and production readiness remain deferred. Existing free-text/location sensitivity and external clipboard/browser copies remain documented residual risks.

No configuration/manual action is required to retain this completed local state. Leave the four credentials revoked. After the gated local commit, verify clean working tree, main one ahead/zero behind the unchanged origin/main, and stop for review. Nothing pushed, nothing deployed, no remote/cloud/client resources changed, and F045 not started.

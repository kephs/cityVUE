# F046 — Implementation and validation record

Status: **implemented and validated locally; development foundation, not production ready**.
Authenticated manual UAT, approved security corrections and policy-based cleanup
are complete. This report accompanies the local F046 feature commit.

## Checkpoint and authorization

Starting branch: `main`. Starting HEAD and local `origin/main`:
`72081ec6121189c61bdc83acf2ef80d3dcfdf3dd`, clean, zero ahead/behind.
No remote synchronization was requested for F046. No fetch, push, deployment,
tag, release, history rewrite or F047 work is part of this implementation.

The user confirmed **1 active / 5 revoked** Requester Tracking credentials as
intentional manual F044 UAT. This supersedes the historical zero-active/four-
revoked checkpoint for F046 integrity comparisons. No personal tracking
credential was inspected or exercised during F046. Only grouped status counts
are used for development integrity checks.

Local commit message: `feat(attachments): add secure attachment foundation`.
The exact resulting hash is reported in the completion response and identifies
the commit containing this record. The accepted starting commit is not amended.
The completed local feature commit is one ahead/zero behind the unchanged local
origin/main checkpoint above; synchronization requires separate authorization.

## Implemented behavior and files

The [feature specification](F046-secure-attachments-photos-foundation.md)
records the complete limits, permission matrix, lifecycle/failure matrix,
threat model and production prerequisites. [ADR-010](../architecture/decisions/ADR-010-secure-attachment-architecture.md)
records the accepted development design and deferred production prerequisites.

| Area                         | Files and responsibility                                                                                                                                                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Private file infrastructure  | `server/src/attachments/attachment.domain.ts`, `attachment-storage.ts`, `attachment.service.ts`, `attachment.controller.ts`, `attachment-cleanup.ts`                                                                                                    |
| Persistence                  | `server/migrations/20260923000000-add-secure-attachments.ts`, `server/src/database/database.types.ts`                                                                                                                                                   |
| Atomic parent creation       | `create-service-request.service.ts`, `request-note.service.ts`, `request-communication.service.ts`, corresponding controllers/DTO/module under `server/src/service-request/`                                                                            |
| Configuration and dependency | `server/src/config/configuration.ts`, `environment.ts`, `server/.env.example`, `server/package.json`, `server/package-lock.json`                                                                                                                        |
| Shared UI and transport      | `react/src/attachments/Attachments.jsx`, `attachmentRepository.js`, `attachments.css`, `react/src/api/apiClient.js`                                                                                                                                     |
| PUBLIC intake                | `react/src/pages/report/IssueForm.jsx`, `ReportIssuePage.jsx`, `react/src/residentIntake/residentIntakeRepositories.js`, `react/src/serviceRequests/canonicalSubmission.js`                                                                             |
| Staff contexts               | `react/src/staff/requests/InternalNotes.jsx`, `RequestCommunication.jsx`, `InternalRequestWorkspace.jsx`, `requestRepository.js`                                                                                                                        |
| Focused verification         | `server/test/unit/attachment.domain.test.ts`, `attachment-storage.test.ts`, `attachment.service.test.ts`, `environment.test.ts`; `server/test/database/attachment-checks.ts`, `request-audience.integration.test.ts`; `react/test/Attachments.test.jsx` |
| Development frontend guard   | `react/vite.config.mjs`, `test/VitePrivateFiles.test.mjs`, root `package.json` test registration                                                                                                                                                        |
| Durable records              | This report, F046 specification/UAT checklist, ADR-010, architecture/context/roadmap and feature/ADR indexes; explicit F041/F042/F043/F045 extension notes                                                                                              |

Sharp `0.35.4` supplies maintained image decoding, orientation and metadata-free
encoding. The lockfile adds its required/optional platform tree without changing
existing locked dependency versions. No overlapping imaging package or broad
dependency upgrade was introduced.

## Database, contexts and permission reuse

The additive migration creates `attachment_batch`, `attachment` and
`attachment_audit`, indexes, composite foreign keys and lifecycle triggers.
There are no existing-data backfills or permission/grant writes. Disposable
tests exercise apply/down/reapply and refuse rollback with retained data.

Development migration was applied through the normal migration CLI after
disposable database validation and target verification: **23 applied / 0 pending**,
up from 22/0. The only ignored environment change enables
`ENABLE_DEVELOPMENT_ATTACHMENTS=true` for personal development. Production/client
profiles reject that opt-in. Normal developer API restart is required.

| Context/operation                       | Actual authorization                                                                                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request Evidence staff metadata/content | Current parent `service_request.view` for PUBLIC, or `service_request.internal.read` for INTERNAL, plus Organization and routing scope; evidence creation remains PUBLIC intake only |
| Internal Note read                      | Parent read plus `service_request.note.read`                                                                                                                                         |
| Internal Note create/stage/finalize     | Parent read plus `service_request.note.read` and `service_request.note.create`                                                                                                       |
| Communication read                      | PUBLIC parent read plus `service_request.communication.read`                                                                                                                         |
| Communication create/stage/finalize     | PUBLIC parent read plus communication.read and `service_request.communication.create`                                                                                                |
| Requester evidence stage                | Server-resolved development Organization, eligible published intake Issue/version and short-lived opaque staging capability; no client tenant selection                              |

**No new RBAC permission and no development grant changes.** Create without
domain read fails. Assignment, watching and operational Role/Team membership
confer no attachment authority. IDs and storage keys do not authorize reads.
Note and Communication batches additionally bind the authenticated creator.

Finalized batches identify exactly one typed parent. Composite relationships
and immutable triggers prevent cross-Organization, cross-request and cross-
context substitution. Finalized files cannot be replaced, renamed, moved,
deleted or appended through ordinary F046 operations. No post-submission
requester upload or staff add-evidence flow is introduced.

## Processing, storage and lifecycle

- JPEG, PNG and WebP only. Signature, extension and declared MIME must agree,
  followed by full decoding/re-encoding. PDF is deferred. SVG, HTML, executables,
  archives, Office, audio/video, arbitrary binary and animated images are denied.
- Five files per parent; 5 MiB per original/processed file; 15 MiB aggregate using
  the larger original/processed size. Maximum 16 million pixels, 8,192 per
  dimension, one frame and a ten-second processing timeout. Limits are enforced
  by API/service/database where appropriate, independently of the browser.
- Filenames are bounded sanitized display metadata. Client-generated opaque
  upload UUIDs support retries; independently server-generated UUID storage keys
  determine paths. SHA-256 of processed bytes detects missing/corrupt objects
  before finalization or disclosure; checksums never grant access.
- Sharp corrects all eight EXIF orientations before discarding EXIF/GPS, device,
  capture, XMP/IPTC/ICC metadata. Synthetic tests check actual fictional GPS IFD
  presence before processing and its absence afterward. Metadata never sets
  Service Location or Requester Geography. Visible private image content is not
  automatically redacted.
- Private local storage is ignored, outside static/frontend roots, partitioned
  by Organization and protected by opaque exclusive writes. No public object
  URL or production storage provider is configured.
- PENDING_SCAN/CLEAN/REJECTED states are modeled. Development scan acceptance is
  an explicit lifecycle stub, **not malware detection**. Pending/rejected content
  cannot be downloaded. Rejection rolls back metadata and retains no raw file;
  production scanning/quarantine remains a prerequisite.
- Parent creation and association/audit finalize in one PostgreSQL transaction.
  File storage is not a transactional database resource. Failed uploads compensate
  newly written objects; failed parent creation leaves a retryable clean stage.
  Existing exclusive objects are never deleted on a write collision.
- Upload retries reuse one identity; changed content conflicts. Parent retries
  bind both content and attachment batch. Concurrent finalization does not create
  duplicate parent records or allow context reuse.
- Stages and their claims expire after 30 minutes, including finalized retry claims.
  A valid PUBLIC retry reproduces the original creation receipt without exposing
  current workflow state. Pre-submission removal deletes stage metadata;
  orphan reconciliation deletes unreferenced bytes after a one-hour grace period.
  Required audit failures roll back changes. Cleanup never deletes finalized
  evidence. Local maintenance is explicit, guarded and dry-run by default;
  a production scheduler is not claimed.

## Anonymous intake abuse and delivery boundaries

PUBLIC batches require an active Organization, active Issue/category and
published eligible intake version. Capability authorization precedes multipart
parsing and is rechecked under a batch lock. Capabilities live only in memory,
travel in a header and are stored only as digests. They stop retrieving content
after finalization. No finalized requester download is added.

Existing API throttling is supplemented by PUBLIC batch admission at ten per
minute, staff admission at thirty per minute, twenty outstanding stages per
Organization and one hundred admissions per hour. Durable admission audit
prevents removal from resetting the hourly cap. Two multipart requests and two
processing operations are admitted per API process; disconnects do not free
processing capacity until the operation finishes. These are development controls,
not distributed abuse protection. Production needs monitored quotas, isolated
processing, distributed limits and scheduled cleanup.

The endpoint cannot host arbitrary file types or accept unlimited uploads
without an eligible intake context. No cookie-based attachment authentication,
API route for public/static attachment serving, direct object key retrieval or
durable public download link exists. A separate Vite development-server exposure
was found in final review and blocks acceptance until remediated.

## UI, accessibility and privacy

Intake has optional Photos & Files, explicit Take Photo/Choose Files, bounded
multiple selection, safe names/sizes, removal, Prepare/Retry and processed-image
preview. A capture-enabled file input delegates to the native browser/device;
no microphone, automatic camera access or continuous media capture is added.

Drafts retain File objects and capabilities only in React memory. Back/Next
preserves the intake draft. Each collaboration composer has independent files;
tab switches retain its draft, successful submission clears only that composer,
and navigation/auth changes abort stale work. Late responses cannot populate a
different context. Expired stages recover through deliberate retry/reselection.
No content is placed in localStorage, sessionStorage or IndexedDB.

Staff evidence has its own section. Note attachments stay under authorized
Notes; Communication attachments stay under authorized PUBLIC Communications.
Requester-intent guidance retains OUTBOUND/PORTAL/RECORDED semantics and explains
that delivery is not enabled. No outbound delivery is introduced.

Preview/download fetches reauthorize the parent/domain on every operation.
The current API buffers a bounded file for integrity verification and required
audit before returning it; it does not claim large-file streaming performance.
Responses use validated MIME/length, attachment disposition with a safe filename,
nosniff and private/no-store. Download CSP adds a restrictive sandbox; frontend
CSP is not weakened. Temporary object URLs are revoked on replacement, removal,
success and unmount. Prior authorized disclosures cannot be retroactively erased.

Safe logging excludes multipart/binary bodies, filenames, EXIF, claim values,
paths, keys and provider errors. Attachment audit stores only minimal
Organization/context/action/resource/staff/time metadata, with no filenames,
digests, capabilities, binary or provider secrets. It is separate from operational
Activity. F041/F042 attachment additions preserve parent status/revision/updatedAt,
Location, Contact, Assignment, Watchers, Activity, the other collaboration stream
and Requester Tracking.

F044 retains its exact six-field requester projection. No Request Evidence,
Note or Communication attachment content, count, filename, ID, storage key or
scan state is exposed. Tests use disposable synthetic tracking data only.

## Automated and browser evidence

| Check                                          | Latest result                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| Backend unit                                   | 227 passed, zero failed/skipped                                           |
| API E2E                                        | 40 passed                                                                 |
| PostgreSQL integration                         | 192 passed, zero skips                                                    |
| Shared                                         | 64 passed                                                                 |
| React                                          | 453 passed across 32 files; focused layout follow-up also passed 94 tests |
| TypeScript/test compilation                    | Passed                                                                    |
| Backend lint                                   | Passed                                                                    |
| Backend/frontend production builds             | Passed                                                                    |
| Backend formatting and changed-file formatting | Passed                                                                    |
| Changed Markdown links                         | No broken local links                                                     |
| Private data / artifacts                       | 518 tracked/new text files checked; no findings or new tracked binaries   |
| Git whitespace                                 | Passed                                                                    |

Commands follow the manifest scripts: backend test compilation and Node test
suites, root shared Node tests, Vitest with one worker, TypeScript, ESLint,
Prettier and Vite production build. The bundled Node executable invokes the
installed package entrypoints because npm is not on this shell's PATH. The
PostgreSQL suite uses the separately configured disposable reqro_test database.
Backend Node suites run from their prescribed compiled test directories, not
from the server root where local development environment files could interfere.
Frontend has no configured lint script. The existing frontend large-chunk
warning remains. The final concurrent run had one existing intake-flow test
reach its five-second timeout while other checks ran. The complete isolated
React rerun passed all 453 tests without changing assertions or timeout.

The operational cleanup dry run exposed Nest dependency metadata missing under
TSX. The CLI now constructs its maintenance dependencies explicitly, preserves
all target guards, and its real read-only dry run succeeds. Cleanup remains
manual and explicit. Post-UAT cleanup removed three expired staging batches and
two old unreferenced objects while preserving all finalized evidence.

Synthetic browser validation used the actual attachment components at 1440,
1280, 1024, 768 and 390 pixels in light and dark themes: no horizontal overflow
or out-of-viewport controls in the checked states. A processed image preview
loaded, long filenames wrapped, and keyboard navigation reached the file and
preview controls. Component tests cover labeled controls, status/error text,
disabled submission while files are unready, context separation, retries,
revocation handling and object-URL cleanup. This is accessibility-oriented
evidence, not WCAG certification or authenticated live UAT. Physical camera
behavior has not been observed.

Representative local processing measurements on generated solid-color
1,536 × 1,024 images were JPEG 29 ms, PNG 22 ms and WebP 136 ms. These measure
decode/orient/re-encode only, without network, database or concurrent load. Small
compressed synthetic fixtures are not production throughput evidence. HTTP
downloads remain bounded buffered responses; no production latency target is
claimed.

## Performance and query behavior

Uploads use a bounded in-memory multipart buffer, not streaming storage. A file
is capped at 5 MiB, with two parser admissions and two independent processing
slots per API process. Sharp also allocates decoded pixels and native working
buffers: a 16-million-pixel RGBA image alone is about 61 MiB, before copies,
codec/cache allocations and outputs. These controls are not an aggregate RSS
ceiling or evidence that total memory is only ten MiB. Concurrent download
responses buffer a verified file of at most 5 MiB each; they are not provider
streams. No production concurrency/load benchmark or memory guarantee is made.

Each nonempty authorized Note or Communication page adds one joined attachment
metadata query for all parent IDs in that page; it does not issue one query per
Note/Communication. Empty/disabled pages add none. Request Evidence adds one
metadata query after the normal parent authorization. Metadata projection omits
storage keys, capability digests and content checksums. Download adds parent
authorization, a scoped file query, a batch lookup and required audit.

Indexes cover Organization/batch file lookup, Organization/request/context,
staged expiry, unique finalized evidence/Note/Communication batches, primary
IDs and unique storage keys. Local cleanup locks at most 100 expired batches,
then enumerates provider files and checks each old object against the database.
That directory walk and admission-audit counting need production scale review;
no bounded cloud inventory, distributed scheduler or production-volume claim
is made. Scanning remains the explicit development acceptance stub.

## Development integrity and completed manual UAT

Before/after migration fingerprints of all pre-existing non-tracking tables
matched, except the expected migration-history addition. Existing Service
Requests, Location, Contact, Activity, Notes, Communications, Assignment,
Watchers, catalog and grants were unchanged. Tracking aggregate remained
**1 active / 5 revoked**. Immediately after migration all three attachment tables
had zero rows. This is pre-UAT evidence, not a claim about subsequent manual work.

[Manual UAT](F046-manual-uat.md) records the user's authenticated PASS results
for PUBLIC intake, staff evidence, Internal Notes, Requester Communication and
invalid-file recovery. Responsive, keyboard and light/dark interaction passed,
with one shared preview-alignment defect corrected afterward. No new parent or
collaboration record was created for the layout validation. Actual device
camera hardware was unavailable. Negative authorization/revocation evidence
is automated, not a claim of additional live grant changes.

The shared preview now precedes an adjacent filename/metadata/actions group.
Token-based flex wrapping keeps long names and controls within their row. Ten
browser cases (1440, 1280, 1024, 768 and 390 px, both themes) rendered 17 previews
each across all contexts and drafts with no overflow, overlap or detached
previews. Download/Remove keyboard activation and visible focus passed. The
layout change preserves existing request/upload/storage/security behavior.

During the manual session, read-only checks found one finalized CLEAN image in
each of the three contexts. All three stored checksums/lengths matched, EXIF/GPS
and other retained metadata were absent, and orientation was normalized to the
expected 300 × 480 pixels. Attachment audit used only the allowed columns and
contained no filenames, storage keys or checksums. The current PowerShell log
capture was correctly decoded as UTF-16LE and had no detected private values;
the closed capture review also passed. The user stopped capture and the log was deleted.

Original-row fingerprints still match across existing request, child-content
and audit records. Twenty-five other baseline tables are unchanged, including
all grants, memberships, Assignment and Watchers. The observed additions are
one request, Location, Contact, answer, Note and Communication; three `activity`
audit rows and one `request_operational_activity` creation event. The reference
sequence changed alongside the new request, as expected for reference allocation.
These read-only checks supplement the user-reported pass results. Final storage
cleanup is complete, with retained evidence verified below.

The intentionally retained record is **SR-202609-000008**: one Request Evidence
PNG, one Internal Note PNG and one Requester Communication PNG, each finalized
and CLEAN. Its request is open at revision 1, and updatedAt still equals
createdAt. Existing requests and their immutable streams remain preserved.
A separate post-UAT/cleanup fingerprint comparison preserved all 36 unrelated
non-tracking tables exactly. Only the three attachment tables changed through
authorized downloads and staging cleanup; tracking aggregate remained 1/5.
Three expired staging batches have been removed through normal maintenance.
Both unreferenced temporary objects were removed through normal cleanup after
their one-hour grace periods. Final inventory: **3 attachment rows, 3 finalized
CLEAN files, 0 staged files/batches, 0 rejected files and 0 orphan objects**.
There are three finalized batches and 35 minimal attachment-audit rows. Each
retained PNG still matches its stored checksum/length, has normalized orientation
and contains no EXIF/GPS/XMP/IPTC/ICC metadata. No retained finalized file was
deleted. Temporary fixture, proposal, HMR and API-log files are absent.

The user stopped the temporary log capture. The closed UTF-16LE log privacy
review passed without printing content, and the temporary API log and both
source fixtures were deleted. No binary UAT file will be committed.

The deliberate FULL_UAT_OPERATOR set remains exactly 21 permission keys, with
one active principal and no F046 grant mutation:

- catalog.issue_action.manage
- service_request.assign, service_request.close
- service_request.communication.create, service_request.communication.read
- service_request.contact.read, service_request.create, service_request.create_internal
- service_request.hold, service_request.internal.read, service_request.internal.update
- service_request.note.create, service_request.note.read
- service_request.reference.manage, service_request.reopen, service_request.resume
- service_request.route, service_request.start_work, service_request.tracking.manage
- service_request.view, service_request.watchers.manage

## Development-server storage boundary

Final review found that Vite's workspace filesystem allowance could serve a
private attachment through its asset loader when its path was known, despite
the storage being outside the frontend directory. This was a separate route
around the correctly authorized attachment API. The finding blocked the commit.
The user explicitly approved a narrow development-server correction.

`react/vite.config.mjs` retains every installed Vite default filesystem-denial
pattern and adds `**/.local-data/**` and `**/.local-uat/**`. It does not broaden
`server.fs.allow` or weaken any existing setting. The focused Node regression
tests both directories using generated sentinel files, verifies direct/raw/URL/
inline import requests return 403 without content, checks default protections
are retained, and checks frontend entry/module loading. Test output contains no
private file contents or private filesystem paths.

Both isolated and existing frontend HMR updated a synthetic module without a
page reload. The test browser initially blocked its local WebSocket through
Chrome's local-network permission; granting that permission only to the local
test origins resolved it, without changing application/Vite security. A fresh
frontend restart was necessary to load the newly added configuration. After
the user restarted it, direct/raw/inline requests beneath both directories
returned 403 without the synthetic marker. The user then confirmed authorized
Preview and Download passed again for all three existing SR-202609-000008
attachment contexts, using the normal staff sign-in.

No attachment API, parent authorization, permission, provider/storage semantics,
schema, scan lifecycle, EXIF behavior or Requester Tracking changed for this fix.

## Finalized retry boundary

A final in-memory check found that a finalized claim bypassed the 30-minute
expiry condition. PUBLIC submission retries also read the parent's current
workflow status instead of reproducing its original creation receipt. This
could make a saved upload claim an unintended long-lived status lookup. The
check used generated data only and performed no database operation or personal
Requester Tracking action. The user separately approved the narrow correction.

Expiry now applies to every claim, including finalized retries. A valid PUBLIC
retry selects only immutable receipt fields and returns the original creation
status, open, rather than querying current workflow state. Finalized files remain
available through authorized staff access independently of the expired staging
claim. Unit coverage checks expired staged/finalized denial and valid finalized
retry success; disposable PostgreSQL coverage changes the fictional parent
status, then asserts retry exactly matches the original receipt and does not
change that current status. No personal parent, grant, schema or tracking state
was changed to test or implement this correction.

## Security review and production classification

The specification's threat/failure matrices cover MIME/extension spoofing,
polyglots, active content, traversal, Unicode/header injection, decompression/CPU
abuse, authorization/Organization isolation, cross-context substitution,
EXIF/GPS, public storage, cache/log disclosure and orphan/retry failures.
Focused tests use harmless generated fixtures and injected failures only.

Static and automated review confirms: IDs/keys alone do not retrieve files;
filenames do not control paths; MIME/extensions are not
trusted alone; unsupported content and excessive resources fail safely;
domain and parent authorization remain independent; finalized associations are
immutable; F044 and geographic boundaries remain unchanged; cleanup is explicit;
and production limitations are stated truthfully. The review found and fixed
exclusive-write compensation, stale UI responses, expired-stage recovery and
HTTP-disconnect processing limits before commit.

Classification: **DEVELOPMENT FOUNDATION, NOT PRODUCTION READY**. No real malware
scanner, production storage, quarantine operations, scheduled cleanup, retention,
legal hold, redaction, distributed abuse system or production capacity claim is
made. Per-process caps and directory inventory need production operational work.
Production additionally requires approved provider credentials outside browser
code, hardened access/encryption, backups/restore, monitoring, load testing,
retention policy and separate deployment authorization.

No Requester Geography, photo-derived Service Location, requester attachment
history, inbound post-submission files, AI/OCR/content analysis, arbitrary file
support, new broad attachment permission, cloud/client resource change or
deployment was introduced. Live Search, Issue-Based Default Assignment,
Anonymous Request Policy, requester identity/history and future analytics remain
deferred. **F047 remains unstarted.**

## Accepted-checkpoint Request Evidence presentation follow-up

This separately authorized frontend follow-up starts at accepted F046
`5c2c310885836bebee440ad8a836351019b20c4f`, on main with a clean working tree,
one ahead/zero behind unchanged local origin/main
`72081ec6121189c61bdc83acf2ef80d3dcfdf3dd`. It does not amend that feature commit.
The preceding implementation/security/database results describe the accepted
feature checkpoint; this follow-up does not rerun or modify those domains.

Request Evidence now follows Description directly in a shared primary-column
layout group and precedes Collaboration. The classification/privacy notice is
above Description; Issue-first identity, status and supporting management/Activity
remain intact. Evidence uses the existing card and section-heading primitives,
as a separate section outside Description. Authorized zero is compact
**No attachments**, one is **1 attachment**, and plural is **N attachments**.
Unavailable evidence remains an error state, never a fabricated zero. Counts
come solely from the existing authorized projection.

The shared finalized list renders an ordered list with display-only ordinals.
An intrinsic-width ordinal column accommodates multi-digit labels, while the
actual five-file limit is unchanged. Image/filename/metadata/actions remain
adjacent and wrap safely. Note and Communication attachments stay inside their
own collaboration parents and receive no additional Request Evidence heading.

Explicit Preview retrieves bytes through the existing API, then opens the
existing native Image Preview dialog. The safe filename, viewport-bounded
proportional image, Close and Download are provided. On close, the same processed
image remains as the nearby thumbnail; thumbnail activation makes another
authorized retrieval before reopening. No automatic content prefetch, direct
filesystem/storage URL, public URL, new endpoint or authorization logic was added.
Unsupported types receive no fabricated image modal. Draft Preview/Remove remains
inline. A separate download URL preserves an open preview. Replaced/unmounted
previews and short-lived download URLs are revoked; errors discard preview bytes
and retain the existing parent access-failure handling.

A delayed synthetic download also confirmed Close restores origin focus before
completion and no late modal reopens. The dialog uses native modality and the
existing focus trap, Escape/Close and
backdrop convention (outside clicks do not dismiss it). An optional origin ref
lets asynchronous preview loading restore focus to the exact Preview/thumbnail
button. The origin remains focusable but aria-disabled during an in-flight read;
the existing operation lock prevents duplicate retrieval. This also permits
focus restoration if Close is used before a download completes.

Validation for this follow-up:

- Thirty isolated synthetic browser cases: 1440, 1280, 1024, 768 and 390 px;
  light/dark; zero/one/three evidence items. Description/Evidence/Collaboration
  order, compact zero, long filenames, ordinals, adjacent thumbnails, modal
  bounds/aspect ratio, download, Enter/Space, forward/reverse Tab containment,
  Escape/Close, focus restoration, visible focus and no horizontal overflow passed.
- Twenty additional browser cases exercised Note/Communication parent placement
  and shared Preview/thumbnail behavior across the same widths/themes. Ten
  presentation-only cases checked ordinals 10 and 100 without changing limits.
- The final full React run passed **472 tests in 32 files**, including **161**
  tests in the two affected attachment/workspace files and the existing dialog
  regressions. This includes closing during a pending download, stale retrieval
  abort/URL disposal, unsupported types, count/error separation, parent denial
  and shared collaboration regressions. Commands: the repository
  `test:react` script (also run with the two focused paths during development).
- `build:react` passed. The existing warning about chunks larger than 500 kB
  remains; no bundle/dependency restructuring was in scope. Prettier checks,
  `git diff --check`, five local documentation-link targets and lightweight
  private-data/artifact review passed. Frontend lint has no configured script.
  Backend/shared suites were not rerun for this frontend-only follow-up.
- The user confirmed all authenticated read-only checks passed on existing
  **SR-202609-000008**: page order, singular count/ordinal, enlarged Preview,
  Close/Escape and return focus, thumbnail reopen, Download and both existing
  collaboration attachment contexts. No new parent or attachment was needed.

Only five frontend source/style files, the two affected React test files and
this report/specification change. Attachment repository/API, backend, security,
storage, claims, scan lifecycle, content validation, EXIF/GPS, database schema
and grants remain unchanged. No direct database query, mutation or cleanup operation
was needed for this presentation follow-up. Last verified development baseline
remains 23 applied/zero pending migrations; three finalized CLEAN attachments;
zero staged/rejected/orphan files; tracking **1 active / 5 revoked**. These are
retained checkpoint facts, not a new database observation. Personal Requester Tracking
was not opened, inspected or exercised. Normal authorized attachment reads retain
the existing minimal audit behavior.

The separate local commit leaves main two ahead/zero behind the same local
origin/main. No fetch, push, history rewrite, tag/release, deployment or cloud/
client-resource change is authorized or performed. **F047 remains unstarted.**

# F046 — Secure Attachments & Photos Foundation

Status: implemented and locally validated, including authenticated manual UAT, approved security corrections and final cleanup. **Development foundation, not production ready.**

## Approved starting state

The user confirmed that additional manual F044 UAT intentionally changed the
development tracking state. This resolves the initial checkpoint discrepancy.

- HEAD / local `origin/main`: `72081ec6121189c61bdc83acf2ef80d3dcfdf3dd`.
- Branch `main`; clean working tree; zero ahead / zero behind.
- Personal `reqro_dev`: 22 applied migrations / zero pending.
- Requester Tracking: **1 active / 5 revoked — intentional manual F044 UAT state**.

F046 must preserve this tracking baseline. Integrity verification uses aggregate
state only. The active credential must not be inspected, displayed, decoded,
reconstructed, exercised, rotated, revoked or reissued. Tracking regression
tests use synthetic credentials in disposable test infrastructure only.

## Scope and implementation

Shared private attachment infrastructure supports three immutable contexts:
Request Evidence, Internal Note attachments, and Requester Communication
attachments. Each read reauthorizes its parent domain. Neither attachment IDs
nor storage keys authorize access. Assignment, watching and operational
membership confer no attachment authority.

The initial file policy is JPEG, PNG and WebP only, with actual decoding,
orientation normalization and metadata-free re-encoding. PDF, SVG, HTML,
archives, Office files, audio and video are unsupported. Limits are
5 MiB per file, five files and 15 MiB aggregate per parent operation, with
16 million pixels and 8,192 pixels per dimension. Original filenames are
display metadata only; generated storage keys determine private locations.

Short-lived staged batches bind to trusted Organization and Issue/version for
PUBLIC intake, or to current authenticated staff, request and collaboration
context. Parent creation and immutable attachment association share a PostgreSQL
transaction. Object storage uses explicit compensation and expiry cleanup;
it is not part of that transaction. No post-submission requester upload is added.

Development storage is private local storage outside frontend roots. Development
scan acceptance is a lifecycle stub, **not real malware detection**. Production
attachment use fails closed pending a separately configured private provider,
real scanner, operational cleanup, retention and deployment review.

F044 tracking gains no attachment content or metadata, including counts,
filenames, IDs, storage keys or scan states. Photo metadata never sets Service
Location or Requester Geography. No new broad RBAC permission is planned.

No push, deployment, cloud/client modification or F047 work is authorized.

## Context and permission matrix

| Context                 | Parent             | Staff read                                                                   | Creation                                                           | Requester visibility                                             |
| ----------------------- | ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Request Evidence        | Service Request    | Current persisted-audience request permission and Organization/routing scope | Bounded PUBLIC intake batch for a published eligible Issue/version | Own clean staging preview only; no finalized requester retrieval |
| Internal Note           | F041 Note          | Parent read + `service_request.note.read`                                    | Parent read + note.read + `service_request.note.create`            | None, even when the request is PUBLIC                            |
| Requester Communication | F042 Communication | PUBLIC parent read + `service_request.communication.read`                    | Same + `service_request.communication.create`                      | No finalized requester retrieval or tracking exposure            |

Parent PUBLIC read is `service_request.view`; INTERNAL read is
`service_request.internal.read`. Both require verified workforce identity and
current authorized scope. For Notes and Communications: no parent access denies
both operations; parent alone denies both; parent + read permits read only;
parent + create without read denies both; parent + read + create permits both.
No assignment, watcher, Role/Team membership, contact permission, known UUID or
known storage key changes that matrix. No new RBAC permission is introduced.

## File policy

| Property               | Implemented policy                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Types                  | JPEG (`.jpg`/`.jpeg`), PNG (`.png`), WebP (`.webp`)                                                                                                    |
| Validation             | Signature + extension + declared MIME must agree; Sharp fully decodes and re-encodes                                                                   |
| Per file               | 5,242,880 bytes for both original and processed bytes; empty files rejected                                                                            |
| Per parent/batch       | Five files; 15,728,640 total using the larger of each original/processed size                                                                          |
| Image resources        | 16,000,000 input pixels; 8,192 per dimension; one frame; 10-second processing timeout                                                                  |
| Multipart              | One file, no extra fields; bounded parser parts/header pairs; authorization before parsing                                                             |
| Processing concurrency | Two admitted multipart requests and two processing operations per API process; disconnects do not release processing slots; not distributed protection |
| Filename               | NFKC normalization; ASCII letters/numbers/dot/underscore/hyphen/space; unsafe/control characters replaced; at most 120 characters; display only        |
| Integrity              | SHA-256 of final processed bytes, private database metadata; verified before finalization and download                                                 |
| Disposition            | All supported types use `attachment`; authorized fetched blobs support image previews                                                                  |
| Response               | Validated Content-Type/Length, safe quoted ASCII filename, nosniff, private/no-store                                                                   |
| Unsupported            | PDF, SVG, HTML, scripts/executables, ZIP/archives, Office, arbitrary binary, video/audio, animated images                                              |

`application/octet-stream` is not an acceptance bypass. A renamed executable-like
harmless fixture, HTML-as-PDF, text-as-PNG, truncated image or mismatched MIME is
rejected. Re-encoding discards EXIF/GPS/XMP/IPTC/ICC and targeted capture/device
metadata after orientation correction. Metadata policy does not redact private
information visible inside an image. Checksum equality is not authorization or
malware detection. Same-name files have distinct UUIDs; no global deduplication.

## Database and lifecycle

Migration `20260923000000-add-secure-attachments` adds `attachment_batch`,
`attachment` and `attachment_audit`, supporting indexes and immutable lifecycle
triggers. Existing records are not backfilled. Composite foreign keys enforce
Organization/parent/context integrity. A finalized batch contains exactly one
typed parent; its files cannot move to another request or collaboration domain.
The migration has no permission/grant writes and refuses rollback with retained
attachment or audit records.

1. Selection retains File objects in memory without uploading. Client count,
   apparent type and size checks are UX only. Invalid selections block submission.
2. Explicit **Prepare files** creates a short-lived batch. PUBLIC intake resolves
   Organization on the server and binds the eligible Issue/version. Staff creation
   requires current parent access and read/create permissions. Raw capability is
   returned once and stays in memory, never a URL or persistent browser storage.
3. Each upload uses an opaque UUID retry key. Guard admission happens before
   multipart parsing; the service reauthorizes while locking the batch. A
   transactional PENDING_SCAN row is created after decoding; the development
   scanner accepts the processed image, private storage writes exclusively,
   then CLEAN state and minimal audit commit. Failed/rejected content is not
   retained as a normal attachment. PENDING_SCAN is not downloadable.
4. Ready means server processing and storage/metadata commit completed. Parent
   submission locks/rechecks the batch, verifies stored bytes, creates the
   parent and immutable association, and records required audit in one database
   transaction. PostgreSQL does not transactionally own object storage.
5. Upload retries with the same UUID and identical processed file return the same
   attachment. Changed input conflicts. Parent retry keys also bind the batch;
   PUBLIC evidence retries bind a private submission fingerprint. Reusing a
   finalized batch for a different parent or context fails. The same 30-minute
   capability expiry applies to finalized retries. A valid PUBLIC retry returns
   the original creation receipt, including original open status, and never
   exposes current workflow status through the upload capability.
6. Finalized metadata/content is available only through an independently
   authorized parent route. A requester staging capability no longer retrieves
   finalized evidence. Protected download audit must commit before disclosure.

| Failure                                | Parent created?          | Final attachment?            | Recovery                                                                                          |
| -------------------------------------- | ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------- |
| Content validation or scan rejection   | No                       | No                           | Transaction rolls back; raw file discarded                                                        |
| Private object write                   | No                       | No                           | Provider removes its own partial write; an existing exclusive key is untouched                    |
| Metadata/required staging audit commit | No                       | No                           | Compensating deletion of newly written object; orphan reconciliation covers cleanup failure/crash |
| Parent or association insert           | No                       | No                           | Whole parent transaction rolls back; CLEAN stage remains retryable until expiry                   |
| Missing/corrupt object at finalization | No                       | No                           | Parent transaction fails; user removes/reselects file or stage expires                            |
| Required parent/finalization audit     | No                       | No                           | Parent and association roll back together                                                         |
| Required download audit                | Existing parent retained | Existing attachment retained | No content response                                                                               |

The matrix applies to all three contexts. F041/F042 body-only submission keeps
its existing semantics; child attachments do not increment request revision or
operational updatedAt, add operational Activity, or modify Contact, Location,
Assignment, Watchers, the other collaboration stream, or tracking.

## Storage, cleanup and abuse controls

Development objects live in ignored `server/.local-data/attachments`, outside
public roots. Vite also explicitly denies every `.local-data` and `.local-uat`
path while preserving its built-in sensitive-file denial rules. Being outside
the frontend directory alone is insufficient because Vite allows workspace
module resolution. Restart the development frontend after adding this config.
Authorized file access remains through the application API. Organization UUID partitions and server-generated UUID keys form
the path; no original filename participates. Reads reject unexpected identities
and symbolic links; writes are exclusive and never silently replace content.
The provider contract offers write/read/stream/remove. Current HTTP download
buffers one bounded file to verify its checksum and commit audit before response;
it does not claim streaming performance for large media.

Stages and all staging claims, including finalized retry claims, expire after
30 minutes. Authorized staff access to finalized files is independent of that
claim lifetime. At most 20 outstanding batches per Organization
and 100 admissions per hour are allowed; deleting a batch does not erase its
hourly admission audit. Existing API throttling applies, with tighter PUBLIC
batch admission (10/minute) and staff admission (30/minute). Origin checks reject
unapproved browser origins; no cookie authentication is used for attachments.
A staging capability is required even before parent creation. Public storage,
unauthenticated finalized downloads and arbitrary file hosting are not enabled.

Removing/abandoning a file deletes only unfinalized metadata. Object deletion
is deferred to reconciliation so a failed metadata transaction cannot leave a
live row missing its object. Cleanup locks expired batches, deletes stage rows,
retains minimal audit and reconciles unreferenced objects older than one hour.
The grace period protects in-flight transactions. Finalized objects are never
part of ordinary cleanup. Rejected raw files are never written; scanner failure
does not produce a CLEAN object.

Run the existing environment-loading procedure from `server`, then
`npm run attachments:cleanup` for a dry run or
`npm run attachments:cleanup -- --apply` for explicit local maintenance. The
command checks development profile and local `reqro_dev`/`reqro_test`; it handles
at most 100 expired batches per invocation. No production scheduler exists.
Orphan inventory currently enumerates the local directory; production needs a
bounded provider-specific inventory and scheduled monitoring. Never manually
delete deliberately retained immutable evidence to make counts appear clean.

## UI, drafts and accessibility

PUBLIC intake adds **Photos & Files**, **Take Photo**, **Choose Files**, selected
names/sizes/states, Remove, Prepare/Retry and server-processed Preview. Capture
uses `input type=file` with `capture=environment`; only an explicit click opens
the browser's capture/selection flow. No getUserMedia, microphone or continuous
camera request exists. Normal selection remains available. Physical camera
availability is browser/device dependent and is not inferred from desktop tests.

Each collaboration composer has its own draft and attachment lifecycle. Switching
F043 tabs preserves separate files; success clears only that composer. Note
files never become Communication selections. Communication helper text explains
requester intent and that delivery remains disabled. Attachments render directly
under their authorized parent. Staff **Request Evidence** is a separate compact
section immediately after Description and before Collaboration, using the shared
card/heading primitives. It is outside Description and never combines
collaboration files. The existing authorized projection supplies **No attachments**,
**1 attachment** or **N attachments**; loading and failure remain distinct from
an authorized empty result. Ordered rows use presentation-only ordinals with
intrinsic width, without changing the five-file limit.

Finalized JPEG/PNG/WebP Preview opens the existing **Image Preview** dialog only
after the normal authorized content retrieval succeeds. Closing retains the
left-adjacent processed thumbnail; activating it reauthorizes through the same
API and reopens the dialog. The dialog preserves aspect ratio, bounds the image
to the viewport, shows the safe filename and offers existing authorized Download.
Native modality, labeled buttons, visible focus, Tab containment, Escape/Close
and restoration to the originating control follow the existing dialog convention;
clicking the backdrop does not close it. Preview origins stay focusable while a
read is pending, with aria-disabled and a duplicate-operation guard, so closing
during Download can restore focus.

Note/Communication lists reuse counts, numbering and the finalized image dialog
inside their own authorized parents. Prepared intake/composer drafts retain
their existing inline Preview and Remove behavior. No unsupported type receives
an image preview, and the unchanged repository/server still reject unsupported
or non-CLEAN content. No new endpoint, count query or persistent storage exists.

File states distinguish selected, uploading, processing/scanning, ready, rejected
and failed; no invented progress percentage. Rejected files require removal;
transient failures support deliberate retry with the same upload identity.
Request/navigation/auth changes abort stale work and discard drafts. Best-effort
abandonment is supplemented by authoritative expiry cleanup. Full refresh loses
local File selections; no localStorage/sessionStorage/IndexedDB persistence is
introduced. Local preview URLs contain already processed authorized bytes and
are revoked on replacement, removal, success and unmount. Closing a finalized
image dialog retains its URL only for the visible inline thumbnail; attachment/
parent changes discard it. Downloads use separate short-lived object URLs so
they do not invalidate an open preview; unmount also revokes outstanding download
URLs. Failed previews retain
safe metadata and the download control; permission-denied fetches clear preview
bytes and notify parent access handling. Prior authorized disclosure cannot be
retroactively erased from another browser or saved file.

Controls are labeled native buttons/inputs, with visible guidance, text states,
alerts/status announcements, filename-specific Remove/Preview/Download names,
alternative text and existing theme tokens. Drag/drop is not required or added.
This validation is not a WCAG certification. No frontend CSP is weakened;
download responses add a restrictive sandbox policy.

## Privacy, audit and threat review

`attachment_audit` has an explicit allowlist: generated audit ID, Organization,
context, action (`opened`, `staged`, `removed`, `finalized`, `downloaded`,
`expired`), batch/attachment/request IDs where appropriate, trusted staff ID
where applicable, and server timestamp. It contains no filename, binary, EXIF,
capability, digest/checksum, path, signed URL or storage secret. Existing
request logging includes route templates/status/correlation and excludes
headers, multipart bodies and file objects. Audit is not operational Activity.

| Threat                                  | Mitigation and residual boundary                                                                                                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spoofing, active content, polyglots     | Strict image allowlist, signature/MIME/extension agreement, full decode/re-encode, safe disposition/nosniff; no claim of exhaustive polyglot or malware detection                                                                 |
| Traversal/header injection/filename PII | Opaque storage paths, bounded ASCII display name, React text escaping, names excluded from audit/logs                                                                                                                             |
| Oversize/decompression/CPU abuse        | Parser bytes, aggregate/count/pixel/dimension/frame limits, timeout, two admitted uploads, batch/rate caps; production still needs isolation/distributed abuse controls                                                           |
| Unauthorized download/enumeration       | Current parent/domain/Organization authorization on each route; invalid/inaccessible resources fail safely without names or content                                                                                               |
| Context confusion/cross-tenant reuse    | Immutable typed batch parents, composite foreign keys, staff/Issue binding and transactional finalization                                                                                                                         |
| EXIF/GPS privacy                        | Orient then strip; synthetic tests; no location/geography/analytics integration                                                                                                                                                   |
| Orphans/retries/failure                 | Exclusive keys, idempotent upload identity, locked finalization, compensation, expiration and reconciliation                                                                                                                      |
| Public exposure/cache/logs              | No static provider/public URLs, private/no-store, minimal audit and logging allowlists                                                                                                                                            |
| Storage compromise                      | Checksums detect corruption at finalization/download; production requires hardened private access, encryption, backups and incident response; a checksum is not protection against an administrator controlling both DB and files |

## Deferred production and product work

Classification: **DEVELOPMENT FOUNDATION**, not production ready. Production
storage, real malware scanner/quarantine, cleanup scheduler, retention/legal
hold/redaction, Organization quotas, operational alerts, load testing and
deployment hardening remain prerequisites. No cloud provider, client resource,
production credential or deployment is configured.

Requester-safe attachment history/tracking, inbound/post-submission files,
additional formats, video/audio/archives/Office, OCR/AI/moderation, search,
analytics/versioning, galleries/CDN, identity/anonymous policy, Live Search and
Issue-Based Default Assignment remain deferred. No F047 is assigned or started.

The [validation record](F046-implementation-report.md) distinguishes automated
evidence, authenticated manual UAT, completed cleanup and production limitations. See [ADR-010](../architecture/decisions/ADR-010-secure-attachment-architecture.md).

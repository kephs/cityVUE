# ADR-010 — Secure attachment architecture

Status: accepted for the locally validated F046 development foundation. Production storage, scanning and operations remain separately governed prerequisites.

## Context

Request evidence, staff-only Notes and requester-directed recorded correspondence
need common file infrastructure without sharing visibility. PostgreSQL and a
private file provider do not share an atomic transaction. PUBLIC classification
does not publish collaboration, and F044 has an intentionally narrow projection.

## Decision

Use immutable typed batch relationships for `REQUEST_EVIDENCE`, `INTERNAL_NOTE`
and `REQUESTER_COMMUNICATION`. Composite foreign keys bind Organization, request
and Note/Communication. Finalized context, parent, object identity and contents
cannot be edited, removed, replaced or renamed by ordinary F046 operations.
Attachment IDs are opaque upload-attempt UUIDs used for retry identity; server
UUIDs determine physical storage keys. Neither authorizes access.

Uploads require a 30-minute capability held only in browser memory and supplied
in a header, plus normal Entra staff/create authorization for collaboration.
The database retains only its SHA-256 digest. The expiry applies even after
finalization; a valid PUBLIC retry reproduces only the original creation receipt,
not current workflow state. This separately approved final-review correction
prevents upload claims from becoming an alternative long-lived status lookup. Requester batches bind a trusted
configured Organization and an eligible published Issue/version. Staff batches
bind the authenticated author, request and domain. Limit each batch to five
files and 15 MiB, each original/processed file to 5 MiB. Bound active staging,
hourly admission and process concurrency; production distributed abuse controls
remain required. No post-creation requester upload is provided.

Accept JPEG, PNG and WebP only. Verify signature, extension and declared media
type, decode with Sharp, reject animation/excessive dimensions, normalize EXIF
orientation, and re-encode without metadata. A checksum covers the processed
bytes. GPS, device/capture data and EXIF never become Service Location,
Requester Geography or analytics. PDFs and additional types are deferred.

Define `PENDING_SCAN`, `CLEAN` and `REJECTED`. The development scanner deliberately
accepts validated images to exercise the lifecycle; **it is not malware
detection**. Production/client profiles reject the development attachment opt-in.
No production storage provider or scanner is configured.

Private local storage implements a provider contract beneath an ignored server
data directory, outside frontend/static roots, partitioned by Organization.
Final security review showed that a frontend directory boundary alone does not
prevent Vite's workspace asset loader from reading private files. With explicit
user approval, the frontend development configuration denies `**/.local-data/**`
and `**/.local-uat/**` while retaining every default Vite denial rule and the
existing filesystem allowance. A regression test checks direct/asset requests
and normal frontend loading. This is a development-server boundary, not a change
to attachment authorization or storage semantics. A running frontend must
restart to load the new configuration.

Exclusive writes prohibit overwriting an existing key. No public object URL is
returned. Finalization verifies object integrity and commits the parent,
association and required audit together. Failed transactions retain a retryable
stage or compensate a newly written object; expiry and orphan reconciliation
cover crashes. Explicit local maintenance is implemented; production scheduling
is deferred.

Every finalized read independently authorizes the parent and the relevant
domain permission. Metadata accompanies authorized Notes/Communications, and
evidence has its own staff route. Downloads require a successful minimal audit
before returning verified bytes, validated MIME, attachment disposition,
`nosniff` and `private, no-store`. Images can be previewed through a temporary
browser object URL created from this authorized response. No persistent browser
storage is used; URLs are revoked on replacement/removal/unmount.

## Consequences and security boundary

Notes require parent access plus `service_request.note.read`; creation also
requires `service_request.note.create`. Communication uses the corresponding
read/create permissions and retains PUBLIC-only eligibility. Create without
read remains denied in both domains. Evidence reads require independent parent
request read. There are no new RBAC keys or automatic grants, and operational
assignment/watching/membership never substitutes for authorization.

F044 exposes no attachment content, counts, names, IDs, keys or states. F042
remains OUTBOUND / PORTAL / RECORDED, without email/SMS/external delivery.
Attachment audit is separate from operational Activity and excludes names,
bytes, content hashes, capability digests, paths and EXIF. Child creation leaves
parent revision, updatedAt and unrelated information streams unchanged.

This is a development foundation. Production requires private encrypted storage,
real scanning and quarantine, resource isolation, distributed rate limits,
cleanup monitoring, retention/redaction governance, backups/recovery and
separately authorized deployment. Content validation is not a malware or complete
polyglot detector; files may still visually contain private information.

## Evidence

[F046 specification](../../features/F046-secure-attachments-photos-foundation.md),
[development protocol](../../development/REQRO_CODEX_PROTOCOL.md),
[F041 authorization](ADR-007-internal-notes.md),
[F042 correspondence](ADR-008-requester-communication.md),
[F044 tracking](ADR-009-secure-requester-tracking.md).

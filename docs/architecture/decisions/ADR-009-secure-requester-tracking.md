# ADR-009 — Secure requester tracking

**Status: Accepted** — F044 implementation decision; release validation and live UAT remain separate gates in the [feature record](../../features/F044-secure-requester-tracking-foundation.md).

## Context

Request UUIDs and human references identify records; neither authorizes requester access. The workforce Entra/RBAC boundary cannot serve anonymous requester tracking. F042 correspondence remains separate and is not exposed by this foundation.

## Decision

Use a separate, cryptographically random 32-byte (256-bit), unpadded base64url bearer credential. Store only its SHA-256 hexadecimal digest in `request_tracking_credential`. This fast deterministic digest is suitable because the input is uniformly random with high entropy; it is not password hashing. Database disclosure alone cannot reconstruct usable links by practical exhaustive guessing, but still exposes any other data in the database and does not protect a compromised application/server.

Management requires normal PUBLIC parent read, current Organization/scope, trusted staff identity and `service_request.tracking.manage`. No default grants, no automatic issuance on migration/intake and no INTERNAL credentials. Management GET returns safe status and an opaque concurrency version, never a digest or recoverable link. The UI keeps state discovery inside an explicitly opened F043 dialog.

One active credential per request is enforced by a partial unique index. Revoked rows remain; digest, request, Organization, author and creation timestamp are immutable. Only active-to-revoked state transition is allowed. Parent-first locking serializes management and authorized reads. Expected management versions reject stale/double-click operations. Issue/rotation/revocation and mandatory metadata-only security audit share a transaction. Audit failure rolls everything back. No parent operational data or revision changes.

Use `/track#<credential>`, consume and scrub the fragment before React Router construction, and send the secret only in `X-Requester-Tracking` to GET `/api/v1/requester-tracking`. This header is distinct from workforce Authorization. No caller-supplied Organization, UUID, audience or reference can select the authorized parent. Indexed digest lookup supplies the trusted pair; active credential, active Organization and persisted PUBLIC audience are rechecked with consistent locking before projection.

An explicit query/projection returns reference, versioned Issue name/icon, normalized status, submittedAt, entered service location and original description. Open remains Open; In Progress and On Hold become In Progress; Closed and Cancelled retain their safe labels. Unknown status becomes Unavailable. No operational narrative, contact, staff identity, UUID, revision, scope, Notes, Activity, assignment, watchers, capabilities or correspondence is included. Plain text is escaped; icons use the existing finite UI vocabulary. Field-level location/description sensitivity may need future client policy.

## Privacy and residual risks

Tracking/management API responses including denial and throttling use no-store, no-referrer and noindex. The frontend establishes no-referrer before scripts/assets and uses bundled assets. The tracking document has noindex metadata and a separate requester shell. The static hosting configuration already applies no-store to HTML. No new CSP relaxation is introduced. Existing global in-process API throttling applies; distributed limits/proxy configuration remain production requirements.

Raw values live only in issuance responses and temporary browser/server memory. Staff dialog close, request/access changes and requester-page departure clear application references. Refresh of a scrubbed page requires the original link again. This limits retention rather than promising JavaScript memory zeroization. No credential goes to application storage, title, analytics, audit or structured logs. Reverse proxies must not log the custom credential header. TLS is required outside approved localhost development.

Possession authorizes access; it does **not** verify a specific human's identity. Screenshots, clipboard history, extensions, browser synchronization and forwarding can disclose a usable link. Browser URL replacement cannot revoke copies already made. Narrow projection, rotation and revocation limit consequences. Already disclosed information cannot be recalled. No automatic expiry is invented; a future reviewed policy can add it. Stronger accounts/OTP/CIAM, delegated/multiple requester access, delivery, tracking history and correspondence display are deferred.

## Operational consequences

Network-loss after successful issuance may lose the only raw copy. There is no secret recovery or automatic replay; reopen state and deliberately rotate after confirmation. New management requires a reviewed current version. Safe rollback is allowed before meaningful tracking state/audit/grants and refused afterward. Live development UAT ends revoked so no usable secret needs retaining for the next feature.

## Evidence

[Domain](../../../server/src/service-request/request-tracking.domain.ts), [service](../../../server/src/service-request/request-tracking.service.ts), [migration](../../../server/migrations/20260922000000-add-requester-tracking.ts), [integration tests](../../../server/test/database/request-tracking-checks.ts), [HTTP privacy tests](../../../server/test/e2e/request-tracking.e2e.test.ts), [UI tests](../../../react/test/RequesterTracking.test.jsx). Executed test/UAT outcomes and their evidence limitations are recorded in the [completion report](../../features/F044-implementation-report.md) and linked chronological UAT record.

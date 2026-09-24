# ADR-015 — Product and Organization branding are separate configuration domains

Status: implementation decision for review within explicitly authorized F054; canonical asset use and no trademark notation explicitly approved by the user. Production uploads, branding CRUD and white-label removal are not approved.

## Context and decision

Reqro is the client-neutral product; an Organization can optionally present its own display identity. Branding never resolves trusted Organization or confers permissions. `/admin` remains authoritative and requires the existing authentication/Admin authorization. `/admin-preview` is a visual reference, not a data or authorization source.

Package the exact user-approved Reqro assets under `react/public/branding/reqro/`, preserving their bytes and aspect ratio. Use the supplied light/dark variants and compact mark; do not redraw. Use Reqro without trademark symbols, the tagline People • Requests • Progress, and the message Built for Today. Ready for a Stronger Tomorrow. A route-scoped browser title/favicon avoids incidental redesign of other shells.

Store optional Organization display name, tagline and a closed-registry logo key in an independent Organization branding resource. Null fields are the explicit default. Configured mode requires a display name; logo and tagline remain optional. Preserve resource revision when clearing, increment exactly once for a real change and leave reads/no-ops/unrelated resources unchanged. F054 adds no normal branding mutation API, write permission or upload UI.

The protected Admin snapshot includes only mode, display name, tagline, safe registry key and revision. Unauthorized/loading/failed configuration uses product fallback; identity/client changes clear the previous projection. Never persist Organization branding in local/session storage. Names are bounded plain text rendered through React escaping, not HTML or CSS.

## Asset visibility and security

Trusted packaged product images and the generic fictional `example-organization` fixture are public static assets, with no Organization identifiers, private data or configuration embedded in the URL/bytes. The fixture is intentionally distributable development/demo content, not a real client logo or competing Reqro mark. Only its fixed registry key can be configured. A renderer maps that exact key to a fixed packaged path; no user input becomes a URL or file path. Unknown, absolute, external, encoded traversal, data URLs and untrusted SVG are rejected/not rendered. No remote server fetch, new file-serving endpoint, CSP relaxation or private attachment-storage reuse exists. Static PNG serving uses existing hosting headers. There is no ingestion path; arbitrary byte MIME/size/EXIF validation belongs to a future approved upload architecture. Packaged assets are inspected; the generated fictional raster fixture has no EXIF/GPS metadata.

On custom asset load failure, preserve safe Organization text and show the approved Reqro mark. If even the product image fails, retain visible Reqro text. Absence of custom branding is healthy. Branding health is read-only and does not repair/reset anything.

## Development and future writes

The separate development CLI validates the explicit development profile, fictional-data opt-in, existing personal Organization identity and localhost reqro_dev target. It exposes status, set/clear dry-run and confirm, requires expected revision and provides safe summary output without configuration bodies. Same-value requests are no-ops; stale expected revisions fail. It does not fabricate an authenticated Admin actor or insert into F053 collection audits. Existing provisioning conventions do not provide a general branding audit store; no production administrative audit completeness is claimed.

Future production management must approve storage/serving and governance before adding bytes. Reuse F053's narrow write permission, expectedRevision, validation, asset processing, atomic metadata/revision/audit, safe response and 409 recovery. Define retention/replacement, CSP, access, scanning/metadata, audit and recovery policies separately. No arbitrary external image loading, tenant switching or white-label policy is introduced.

## Consequences

One indexed branding lookup is added inside the existing repeatable-read Admin transaction. Logo serving uses packaged browser assets with no API N+1 or database writes. Fresh configuration reads observe changes; no long-lived client config cache. Independent branding changes preserve Intake Settings, Issue and Area revisions. Production scale/load and WCAG certification remain unclaimed.

Related: [ADR-014](ADR-014-administrative-configuration-authorization.md), [ADR-010](ADR-010-secure-attachment-architecture.md), [F054 specification](../../features/F054-admin-portal-branding-foundation.md).

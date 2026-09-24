# F054 — Reqro Admin Portal Experience & Organization Branding Foundation

Implemented and validated from synchronized main `94a1bd54c9b7e7ca45df62e65f7a78d3746cd901`. User supplied and explicitly approved canonical PNG/ICO assets in `react/public/branding/reqro/`; reuse bytes unchanged. The later user decision supersedes the original specification's trademark notation: **Reqro**, no trademark symbols. Approved tagline: **People • Requests • Progress**. Approved message: **Built for Today. Ready for a Stronger Tomorrow.**

Authoritative `/admin` retains F052/F053 authentication, trusted Organization, Admin read and independent intake-write permission. `/admin-preview` supplies visual reference only. No demo metrics or unimplemented navigation become authoritative. Other staff/resident shells are outside scope.

## Branding boundary

Independent Organization branding resource: display name (required for Organization mode, max 100), optional tagline (max 140), nullable fixed-registry logo key, revision and timestamps. Default has all presentation fields null and reads as REQRO_DEFAULT. Database trigger increments only meaningful branding changes; clearing retains revision/history. Reads never write. Existing Organizations default to Reqro; branding does not establish tenant context.

Protected Admin configuration includes a minimal safe branding projection and health; no public tenant configuration endpoint. Fixed packaged product assets are publicly served static files. A clearly fictional, generic development Organization mark may be packaged as a public test/demo fixture containing no tenant data. Its registry key is the only configured logo reference; unknown IDs, external URLs and paths are rejected. No ingestion, uploaded SVG, file lookup, remote fetch, CSP expansion or F046 storage reuse. Missing/unavailable logos render the approved Reqro mark; partial invalid branding falls back to product identity. Organization name/tagline are plain text, never HTML/CSS. Production Organization-logo upload/storage and branding CRUD are deferred.

Development CLI follows explicit profile/target/fictional-data opt-in, status, dry-run/confirm, set/clear and expected branding revision. No-op is unchanged; stale provision fails. This is provisioning, not a normal Admin write API. Future production writes require narrow permission, expectedRevision, validation, atomic revision/audit and 409 per F053.

Final personal branding state must be REQRO_DEFAULT. Preserve collection Enabled/revision 3, both F053 audits, grants, 13 requests and tracking 1 active/5 revoked. Temporary integrity/UAT artifacts must be physically removed before commit. Run protocol suites, responsive/themed/keyboard and authenticated branding UAT, privacy confirmation and final integrity checks. No push, deployment or F055.

Completed evidence and production limitations: [F054 implementation report](F054-implementation-report.md). Final development branding is REQRO_DEFAULT at revision 3. No push, deployment or F055.

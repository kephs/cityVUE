# ADR-014 — Administrative configuration is a separate authorization domain

Status: Accepted design for the explicitly authorized F052 read-only scope, including the user's 2026-09-23 resource-revision approval. Implementation validation is recorded separately.

## Context and decision

Organization administrators need safe configuration visibility without receiving operational or requester data access. F052 adds explicit `admin.configuration.read`, with no default grants or broad-bundle membership, using existing Entra and active database staff/Organization resolution. No global Admin flag, tenant switch or write permission is introduced. The protected GET snapshot and real `/admin` shell remain distinct from `/admin-preview` demonstration data.

Configuration is read from authoritative catalog, F048/F049 and F051 resources using a read-only repeatable-read transaction, bounded pages and safe projections. Configuration counts are not request metrics. Health is deterministic, read-only and Organization-scoped. Deployment-owned privacy policy is labeled separately; it is not an Organization-admin resource.

Reuse existing resource revisions. Add independent collection and Participation Area revisions initialized to 1, with database enforcement so existing CLI changes cannot leave them stale. No global revision is added. Reads and unrelated/no-op changes do not advance a resource. Future resource writes must check expected revision, validate, mutate/increment and audit atomically; stale writes return 409. F052 has no write API and does not claim that future HTTP behavior already exists.

## Audit and privacy

Reuse existing resource-specific immutable audits and define a minimal typed future mutation contract. Do not fabricate mutations or append audit noise for harmless configuration reads. Future write implementations require an immutable audit store appropriate to their resource, including trusted actor/Organization/correlation, changed fields and revisions, with sensitive payloads excluded. Normal operational logging remains allowlisted. Admin read grants no access to requests, Contact, Notes, Communication, attachments, requester identity/history, tracking, geospatial or participation analytics; none of those permissions grants Admin read.

## Consequences and limitations

Future APIs must carry the revision of the affected resource, not a single snapshot number. A combined Admin response is one coherent database read, but deployment policy is a process-level source and multiple paginated requests are independent snapshots. Safe assignment eligibility can change through separate operational configuration; writers must revalidate eligibility in addition to checking assignment configuration revision. No-op writes remain idempotent. Production governance, audit retention, write authorization, area/Issue/privacy administration and change management remain deferred.

See [F052 specification](../../features/F052-organization-administration-foundation.md), [Organization isolation](ADR-001-organization-isolation.md), [operational authorization](ADR-006-public-internal-staff-authorization.md), [assignment](ADR-004-assignment-watchers.md), and [F051 participation](ADR-013-operational-participation-geography.md).

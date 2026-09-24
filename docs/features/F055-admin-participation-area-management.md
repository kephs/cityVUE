# F055 — Admin Participation Area Management

Status: implemented and validated locally from clean synchronized `main` at `3378141b458c3408b677fd4558a0396b7a41fb2b`. Automated checks, authenticated UAT, user-confirmed responsive/logging checks and final integrity comparison passed. See the [implementation report](F055-implementation-report.md). No push, deployment or F056.

## Approved scope and decisions

The existing `/admin/participation` manages Organization-defined, self-reported participation geography. It is neither residence nor Service Location, GIS geometry, identity, routing or assignment. Stable area IDs and historical request references remain unchanged. Historical analytics uses the current configured label (F051); there is no historical label snapshot.

Both `admin.configuration.read` and new `admin.participation_areas.write` are required. The new permission has zero default grants, is excluded from provisioning bundles and grants no operational, Contact, tracking, requester-history or analytics access. Trusted Organization comes exclusively from authenticated staff context.

User-approved name rule (2026-09-24): trim leading/trailing whitespace, preserve display capitalization, and enforce case-insensitive uniqueness within each Organization across active and inactive areas. Inactive names remain reserved: reactivate the original resource. Other Organizations may use the same name. Existing rows are not rewritten, merged or deleted. A database expression index enforces the comparison; duplicate writes return a safe validation message. Maximum name length remains 120 characters; names are plain text.

Existing per-area revisions start at 1 and advance through the F052 trigger only for meaningful name, active or order changes. Existing-area writes require expectedRevision; stale values return 409 before no-op detection. Identical writes neither increment revision nor append audit. No global configuration revision.

Ordering uses the explicitly permitted numeric display-order editor. Lower values appear first; equal values retain the existing display-name/ID tie-breakers. Active and inactive areas share this order; requester projection filters inactive rows. One order edit changes only one resource atomically and checks that resource's revision. No contiguous numbering, unique-rank constraint, implicit renumbering or multi-row reorder is introduced. Independent resources do not stale each other.

Create defaults active, appending after the highest configured order. Creating/reactivating does not enable collection. Deactivation retains the area and all history; it requires UI confirmation and is rejected when it would remove the final active area while collection is enabled. Collection and area writes serialize through the existing Organization lock, without changing collection revision. Request creation retains F051 authoritative active-area admission.

## Mutation and audit contract

`POST /api/v1/admin/participation-areas` accepts only displayName (201). `PATCH /api/v1/admin/participation-areas/:id` accepts expectedRevision plus exactly one of displayName, active or displayOrder (200). Strict DTO/query validation; positive bounded integer revisions; bounded integer display order. Missing/foreign area IDs have the same 404. No DELETE endpoint, Organization selector, arbitrary configuration patch, geometry, code or bulk import/export.

Each successful change inserts an immutable resource-specific audit in the same transaction: trusted Organization/staff actor, area ID, action, old/new safe name/state/order, prior/new revision, correlation UUID and timestamp. No requester data or arbitrary JSON. Required audit failure rolls back configuration. Failed authorization, validation, stale revisions and no-ops produce no successful mutation audit. Normal logs retain the established allowlist, excluding request bodies.

## Validation and preserved baseline

Required: migration apply/rollback/reapply and collision refusal without data changes; create/rename uniqueness races; permission matrix and isolation; strict DTOs; revision/no-op/concurrency; last-active/collection race; audit rollback/immutability; historical references and intake regression; React editor/confirmation/conflict/denial/empty/XSS/keyboard checks; all protocol suites and builds. Live validation uses fictional data, at most one new area, the normal Entra session and five viewport widths in both themes. No new requester submission or tracking operation is needed. This validation is not a WCAG certification.

Baseline: 31 applied migrations, zero pending; three active areas at revisions 1 and orders 0/1/2; collection Enabled/revision 3; REQRO_DEFAULT/revision 3; one each Admin read, Intake write and analytics grant; two F053 audits; 13 requests including SR-202609-000013; tracking 1 active/5 revoked. No trimmed/case-insensitive area-name collisions.

Production administrator provisioning/governance, retention, change management and recovery remain separate prerequisites. GIS, destructive deletion, area-based routing, privacy policy editing, permission-management UI, production branding and future features remain deferred.

## Post-F055 presentation refinement

See [Participation Setup consolidation](F055-participation-setup-refinement.md). The canonical `/admin/participation` composes Service Participation and Participation Areas; `/admin/intake` redirects there. Backend resources, write permissions, revisions, APIs and audits remain separate. The approved numeric Change order workflow retains persisted values. Historical evidence above describes its original checkpoint; the user subsequently created Fictional North-East Area, producing the reconciled five-area/nine-audit baseline.

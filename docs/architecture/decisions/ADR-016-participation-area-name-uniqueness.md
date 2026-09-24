# ADR-016 — Participation Area names share an Organization-wide active/inactive namespace

Status: Accepted by the user on 2026-09-24 for F055. Implementation validation is recorded separately in the [feature specification](../../features/F055-admin-participation-area-management.md).

## Decision

Trim leading/trailing whitespace before validation and persistence. Preserve the administrator's display capitalization. Compare names case-insensitively within the trusted Organization, across both active and inactive Participation Areas. An inactive name remains reserved; use reactivation to reuse that resource. Different Organizations may independently use the same name.

The pre-F055 schema enforces only exact `unique(organization_id,display_name)`. The verified development data has no collisions under trimmed, case-insensitive comparison. F055 adds a unique expression index using PostgreSQL lowercasing and the ECMAScript trim whitespace set. There is no accent folding, transliteration, internal-whitespace collapsing or Unicode compatibility normalization. Database collation/lowercase behavior remains the configured PostgreSQL behavior. The API trims that same boundary whitespace and returns a fixed safe duplicate message. The index arbitrates concurrent creates/renames, including direct database writers, rather than relying on a prior lookup or UI check.

Migration does not rewrite, merge, replace or delete areas. A deployment with existing collisions fails migration transactionally and requires separate reconciliation approval. Area identity, revisions, active state and historical references do not change on duplicate rejection. The earlier exact unique constraint remains for compatibility with established provisioning conflict targets.

## History and ordering

The [F051 decision](ADR-013-operational-participation-geography.md) remains authoritative: request-level references retain the stable area identity, analytics uses its current configured label, and deactivation retires future selection without deleting history. No label snapshot, residence inference, geometry, identity linkage or routing effect is introduced.

The [F052 resource-revision decision](ADR-014-administrative-configuration-authorization.md) also remains intact. F055's explicit numeric order editor changes a single area with its expected revision. Existing tied numeric values are valid and sort by name then ID. No global revision, unique ordinal, automatic multi-row normalization or reorder batch is introduced. Transactions serialize collection/area invariants with an Organization lock but only meaningful changes to the individual resource increment its revision.

## Consequences

Administrators cannot create a confusing case variant or reuse a retired name for a new identity. Renaming may intentionally change only display capitalization and advances that resource's revision/audit. Duplicate attempts disclose only conflict within the authenticated Organization. A resource-specific immutable audit commits atomically with each actual create, rename, state or order change; no destructive deletion API exists. Production name governance, administrator provisioning, retention and recovery remain separate work.

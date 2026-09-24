# ADR-017 — Atomic Issue configuration with independent resources

Status: Accepted design, explicitly approved by the user for F056 on 2026-09-24. Implementation/UAT status is tracked separately in the [F056 report](../../features/F056-implementation-report.md).

## Context

A single Issue editor spans stable catalog configuration, immutable catalog content, requester identity policy and default assignment. These resources already have different revision and audit responsibilities. Historical requests refer to an immutable catalog version. Copying an entire existing Issue would also copy configuration outside the approved creation scope.

## Decision

Retain ADR-014's independent resource revisions. Add a core revision for current version, active state and numeric display order. Action, requester-policy and default-assignment revisions remain separate. A complete Save carries all four expected revisions, locks the trusted Organization-scoped stable Issue and applies changed resources through their domains in one transaction. Required audits commit in that same transaction. Policy-only and assignment-only saves do not advance core/action revisions. No-op and failed commands do not append successful change audits.

Publish immutable replacement versions for name/description edits; clone form identities while preserving question/option keys and configuration. Existing requests continue using their stored version. Creation explicitly selects a valid same-Organization intake template and copies only Category, mandatory intake settings and forms. New stable/version/form identities are generated. Policy and assignment come from explicit selections. Optional aliases, keywords and routing metadata are not inherited for a new Issue. The new stable Issue remains inactive even though its structurally complete catalog version is published internally. It becomes available for new intake only after explicit activation.

Order within existing Category grouping is nonnegative display order, name, stable ID. Existing orders default to zero. Ties are valid; numeric Change order changes one resource. No adjacent swap contract is introduced.

A PostgreSQL unique expression index on the current-name cache enforces Organization-scoped trimmed, case-insensitive names, including inactive names. A trigger derives the cache from the current immutable version; service-key uniqueness remains. Historical versions are outside this namespace. Inactive names remain reserved for reactivation. The migration fails atomically on pre-existing collisions rather than rewriting data.

## Security, privacy and consequences

Both Admin read and explicit Issue write are required. Permission registration grants nothing. Browser Organization, actor, revision advancement and assignment authority are rejected. Eligibility is revalidated; UUID possession grants no authority. Existing requests are never reassigned, reclassified or rewritten. Request creation rechecks stable Issue active state under its transactional lock, closing the pre-validation deactivation race.

Immutable audits store trusted actor, Organization, Issue, action, changed field names, independent resulting revisions, correlation and time; no full payload, Contact or provider subject. F048/F049 retain their own domain audits. Retained audit/configuration/grant state blocks destructive rollback. Historical label presentation remains tied to the request's immutable version.

This is a narrow local administration contract, not a workflow designer, form designer, production governance system or generalized configuration mutator. Production scale/contention and accessibility certification remain separate work.

Related: [ADR-014](ADR-014-administrative-configuration-authorization.md), [F056 specification](../../features/F056-admin-issue-configuration-management.md), [F048](../../features/F048-issue-based-default-assignment.md).

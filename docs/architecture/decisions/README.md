# Reqro architecture decisions

[ADR-018 — Immutable Dynamic Questions and protected submitted answers](ADR-018-dynamic-questions-protected-answers.md): approved F056.2A publication, history and independently audited disclosure, including the legacy compatibility migration.

[ADR-015 — Product and Organization branding](ADR-015-product-organization-branding.md): F054 implementation decision for review; trusted packaged assets, independent resource and protected projection, deferred production uploads/writes.

[ADR-014 — Administrative configuration authorization](ADR-014-administrative-configuration-authorization.md): F052 separate administrative domain, read-only snapshot, resource revisions and deployment-policy separation.

[ADR-013 — Explicit participation geography and scoped aggregates](ADR-013-operational-participation-geography.md) records the explicitly approved F051 design: service-participation area rather than residence, request-only voluntary collection, independent identity/location, dedicated permission plus existing PUBLIC scope, and server suppression without totals or percentages. Automated and live development validation passed; see the [report](../../features/F051-implementation-report.md).

[ADR-012 — Trusted requester identity and authorized history](ADR-012-trusted-requester-identity-history.md) records the F050 implementation decision, proposed for final review: Contact is not identity authority, synthetic development provenance is explicit, and history cannot expand request access.

[ADR-011 — Explicit requester identity](ADR-011-explicit-requester-identity.md) records F049's approved two-policy model, immutable historical identity, anonymous Contact prohibition and dated F039/F042 amendments. Application-level anonymity does not establish infrastructure untraceability or production readiness.

[ADR-010 — Secure attachment architecture](ADR-010-secure-attachment-architecture.md) records the accepted F046 development storage, parent-domain, Vite filesystem and expiring retry boundaries; production prerequisites remain deferred.

[ADR-009 — Secure requester tracking](ADR-009-secure-requester-tracking.md) records F044's bearer credential, management authorization, minimized projection and secret-handling decisions. The [F044 completion report](../../features/F044-implementation-report.md) records local validation and qualified manual UAT separately from this accepted design. It does not authorize deployment.

Read only decisions relevant to the task after the [protocol](../../development/REQRO_CODEX_PROTOCOL.md), [Architecture](../../ARCHITECTURE.md) and [Roadmap](../../ROADMAP.md). ADRs 001–007 consolidate accepted behavior through F041; ADR 008 records the F042 correspondence decision. These records do not grant permissions or approve deployment.

| ADR                                                                                   | Read when working on                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [001 — Organization isolation](ADR-001-organization-isolation.md)                     | Tenant context, queries, identities, schema relationships                       |
| [002 — Request audience](ADR-002-service-request-audience.md)                         | Intake classification, channels, requester versus submitter                     |
| [003 — Operational Activity](ADR-003-operational-activity-history.md)                 | Workflow, narratives, immutable history, audit separation                       |
| [004 — Assignment and watchers](ADR-004-assignment-watchers.md)                       | Ownership, operational membership, routing, work views                          |
| [005 — Requester contact](ADR-005-requester-contact-privacy.md)                       | Protected name/email, audit and disclosure boundaries                           |
| [006 — PUBLIC/INTERNAL authorization](ADR-006-public-internal-staff-authorization.md) | Unified workspace, permissions, SQL union, resident privacy                     |
| [007 — Internal Notes](ADR-007-internal-notes.md)                                     | Staff collaboration, read/create, append-only child state                       |
| [008 — Requester communication](ADR-008-requester-communication.md)                   | Correspondence, PUBLIC eligibility, resident access and truthful delivery state |

The earlier `docs/decisions/` series remains at its original paths: [staff AI gateway](../../decisions/ADR-001-provider-neutral-staff-ai-gateway.md), [AI governance metadata](../../decisions/ADR-002-ai-governance-metadata.md), and [client-neutral isolated development](../../decisions/ADR-003-client-neutral-platform-isolated-development.md). The two directories are distinct series; cite descriptive titles and full relative paths, not a bare ambiguous ADR number. No earlier ADR is renumbered or silently superseded by these summaries.

New decisions in this series use the next unused number and include title, status, context, decision, consequences, security/privacy implications and related evidence. Use Accepted only after approval; undecided work stays in the roadmap or an explicitly proposed record. Supersede an accepted ADR with linked history, or record a dated explicit amendment and rationale. Do not silently rewrite an accepted decision to conceal a change. Feature reports retain their historical implementation/UAT details.

- [ADR-016 — Participation Area name uniqueness](ADR-016-participation-area-name-uniqueness.md): approved Organization-scoped trimmed/case-insensitive namespace across active and inactive areas.

- [ADR-017 — Atomic Issue configuration](ADR-017-atomic-issue-configuration.md): approved independent revisions, immutable history, template creation, ordering and name integrity.

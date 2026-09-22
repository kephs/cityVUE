# Reqro architecture decisions

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

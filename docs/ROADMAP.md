# Reqro — Roadmap

This roadmap describes accepted progress and possible direction, not implementation or deployment authorization. Follow the [development protocol](development/REQRO_CODEX_PROTOCOL.md) for execution, [Architecture](ARCHITECTURE.md) for current behavior and [ADRs](architecture/decisions/README.md) for durable decisions. Historical CityVUE identifiers remain unchanged.

## Accepted progress

The accepted application checkpoint is **F041 complete**: separate append-only Internal Notes for authorized PUBLIC and INTERNAL requests, validated locally with explicit development provisioning and authenticated UAT. See the [F041 report](features/F041-implementation-report.md). **F042 is not selected and has not started.**

The [feature index](features/README.md) links specifications and evidence for the completed operational sequence:

| Feature | Completed capability                                          |
| ------- | ------------------------------------------------------------- |
| F029    | Service Request audience and assisted-intake foundation       |
| F030    | INTERNAL Service Request access policy                        |
| F031    | INTERNAL lifecycle and routing                                |
| F032    | Issue action / external redirect configuration                |
| F033    | Configurable Organization-scoped references                   |
| F034    | Staff INTERNAL request workspace                              |
| F035    | Append-only operational Activity                              |
| F036    | Safe explicit development staff provisioning                  |
| F037    | Assignment, ownership and watchers                            |
| F038    | Shared UI design system and experience refresh                |
| F039    | Independent protected structured requester contact            |
| F040    | Unified PUBLIC/INTERNAL staff workspace and PUBLIC operations |
| F041    | Staff-only append-only Internal Notes                         |

Earlier foundations include React migration, canonical PostgreSQL catalog/intake, API eligibility, optional Entra/database RBAC, resident alerts, AI/provider governance and synthetic/protected geospatial boundaries. Individual reports distinguish local implementation, previews and deferred production work. The earlier global reference plan was superseded by F033; authentication, lifecycle, ownership and Notes are no longer pending foundations.

## Current governance milestone

Consolidate the permanent protocol, accepted ADRs, architecture/context and navigation. Perform a static pre-push history/configuration review and commit documentation locally. This changes no application behavior, migrations or grants.

The next **separately approved task** may be pre-push final verification and GitHub synchronization if the governance review finds the repository suitable. Neither synchronization nor deployment is authorized here. The [governance review](development/GOVERNANCE_REVIEW.md) records local evidence and conditions.

## Product review before F042

No candidate below has priority or a feature number assigned. Review value, privacy, operational impact and dependencies before selecting one:

- Resident communication and separately authorized resident-safe request history.
- Notifications with approved recipients, preferences/consent, queues and failure handling.
- Note correction/redaction/versioning that preserves accountability and retention requirements.
- Attachments with secure upload, storage, scanning, access and lifecycle design.
- Administrative configuration and production Role/Team administration.
- Priority/SLA/escalation foundations based on approved policies.

Notes editing, deletion, search, mentions, exports, analytics and AI use are also deferred; they must not appear as incidental F041 extensions. Contact editing/search and resident profiles need independent privacy review.

## Longer-term platform direction

**Catalog and intake:** extend narrow implemented configuration toward reviewed authoring/publication/preview administration, richer conditional intake, accessible discovery and routing policy. Preserve version/Answer history and distinguish platform intake from external redirect. Historical [domain requirements](features/F002-core-product-capabilities-domain-requirements.md) and [catalog direction](features/F003-dynamic-service-catalog-intelligent-intake.md) are broad requirements, not evidence every capability exists.

**Location and GIS:** select approved authoritative providers/layers, address resolution and service-area/asset eligibility, including boundary, outage, indeterminate-result and geographic privacy cases. Preserve API authority and vendor neutrality. Staff override, geographic routing, PostGIS and live integrations need explicit scope; synthetic map presentation does not implement them.

**Staff operations and reporting:** build new dashboard metrics from server-authorized scope with clear direct/team/unassigned definitions. Do not reinterpret browser-local statistics as operational reporting. Extend workflow configuration only through approved transition, revision and history rules.

**Enterprise integrations:** discover actual vendor APIs and capabilities before a controlled pilot. Keep an API-owned router, canonical domain, Organization-scoped mappings/external references and vendor adapters. Validate retries, deduplication, status/source-of-truth rules and recovery. Demonstrate portability with a second approved/mock adapter without requiring a vendor purchase. No vendor connector is currently claimed complete.

**Production readiness:** client identity activation, deployment architecture, security/privacy/records/accessibility review, performance/load evidence, backup/restore, monitoring, operational ownership and support remain separate gates. [F008](features/F008-production-backend-persistence-security-architecture.md) and [F016](features/F016-production-hosting-deployment-readiness-plan.md) preserve hosting direction. Prefer isolated client environments initially; shared SaaS needs a separate tenancy/operating-model decision.

**Naming and rollout:** a technical CityVUE-to-Reqro rename requires its own plan. The historical [F007 static Hosting cutover](features/F007-react-stage-10-production-cutover.md) does not establish deployment of later backend/staff features. Git push and cloud deployment require separate authorization.

## Decision and feature records

Move a candidate through design, explicit approval, implementation and validation before marking it complete. Use [feature records](features/README.md) for requirements/evidence and the [ADR convention](architecture/decisions/README.md) for durable choices. Do not silently rewrite accepted decisions or turn roadmap entries into permission to use client resources.

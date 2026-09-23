# Reqro — Product and Repository Context

[F045 — Requester Issue Location Experience](features/F045-requester-issue-location-experience.md) is implemented and locally validated from synchronized F044 `54bb498ba37edcd28c646c84a4a1274370939697`. Its [completion report](features/F045-implementation-report.md) records provider-neutral development search, MapLibre selection, explicit device geolocation, manual alternatives and the existing server-owned Service Location/eligibility boundary. No migration or grant change: 22 migrations, zero pending; tracking remains zero active/four revoked. No F045 push or deployment; F046 is not started.

Reqro is the current product name for this client-neutral resident-engagement and staff-work platform. **CityVUE** is its historical project name and remains in the repository directory, package/configuration identifiers, existing runtime branding and earlier documents. This governance consolidation does not rename those assets. **Ask Rockville** was a previously considered public-facing name, not the current platform name or an instruction to rebrand.

Start with the [Reqro Codex Protocol](development/REQRO_CODEX_PROTOCOL.md), then [Architecture](ARCHITECTURE.md), [Roadmap](ROADMAP.md), relevant [ADRs](architecture/decisions/README.md) and [feature records](features/README.md). This document explains origins and implementation context; it does not supersede executable behavior or grant permission to use external resources.

## Origins and enduring purpose

The early CityVUE prototype explored a consistent resident experience while Rockville-related service intake, CitizenVUE, Survey123 and VUEWorks integration were being considered. Those historical motivations are not claims about a client's current systems or approved integration scope. Rockville is a prospective deployment, not a required dependency or an authorization source for independent development.

The enduring objective is to let residents find services and report problems without needing to understand internal Departments or enterprise vendors, while authorized staff handle requests securely. Catalog configuration, canonical requests and adapters should support changing destinations. VUEWorks, Cityworks, Cartegraph, MGO and VistaShare remain possible destinations; no live EAM/CRM integration is established by this checkpoint.

Independent development uses local, synthetic, public test or explicitly approved personally controlled resources. Client tenants, private networks, non-public data and production systems require separate authorization. Organization is the canonical ownership boundary. The [client-neutrality ADR](decisions/ADR-003-client-neutral-platform-isolated-development.md) retains the development/client profile decision and its constraints.

## How the repository reached this checkpoint

| Period                           | Implemented progression and remaining boundary                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original prototype and F001–F007 | Parcel/browser-local Issue workflows migrated to React/Vite. F007 records the historical static frontend Hosting cutover; Parcel remains rollback capability. Browser data is origin-specific, not canonical PostgreSQL state.                                            |
| F008–F014                        | Backend architecture direction followed by local NestJS/Kysely/PostgreSQL foundation, Organization/catalog/versioned questions, canonical creation/Answer snapshots and API repository/read boundaries. Earlier global reference allocation was later superseded by F033. |
| F015–F019                        | Server-authoritative eligibility foundation, hosting-readiness planning, controlled operational foundations, optional Entra + database RBAC and resident alerts/notices. Production hosting and client activation were not automatically performed.                       |
| F020–F028                        | Staff AI and metadata-governance foundations, stakeholder previews, client-neutral profiles, synthetic MapLibre/geospatial presentation and protected Organization-aware reads. Preview/demo/provider scaffolding is distinct from live production integrations.          |
| F029–F033                        | Explicit request audience/channel, INTERNAL reads/lifecycle, Issue intake-versus-redirect configuration and Organization-scoped configurable references.                                                                                                                  |
| F034–F038                        | Staff workspace, operational Activity, development provisioning, assignment/watchers and shared visual design.                                                                                                                                                            |
| F039–F041                        | Independent structured-contact protection, unified PUBLIC/INTERNAL staff operations and append-only Internal Notes on either audience.                                                                                                                                    |

Historical feature specifications retain original scope, validation and deferred items. “Not implemented” in an earlier report may have been addressed later; consult the current architecture and later records rather than rewriting history. The [feature index](features/README.md) links the accepted F029–F041 progression.

## Accepted F041 checkpoint

F041 completed local implementation, automated validation and incremental authenticated manual UAT for PUBLIC/INTERNAL Notes. Its [implementation report](features/F041-implementation-report.md) records safe fixture state, test counts, permissions and limitations. The accepted commit is `6d394713a81b304800badf5a5413189b31d2395a`; personal development had 20 migrations with zero pending, 18 deliberately retained permission keys and two fictional Notes. These are checkpoint facts, not hard-coded production requirements.

Governance and separately authorized GitHub synchronization completed at `371ec3bd753b6054cdc5403ad0e88898ef0ea161`. [F042](features/F042-requester-communication-foundation.md) implements independently authorized PUBLIC correspondence, recorded without external delivery, from that synchronized checkpoint. Its [report](features/F042-implementation-report.md) records passing final automated validation, live UAT limitations and the approved retention of two fictional communications after a keyboard automation incident. All 20 intended permissions were restored and parent state remained unchanged. F042 was subsequently accepted and synchronized to GitHub at `8018acf8f2caf9699faa682241a026f09b101e90`. [F043](features/F043-service-request-workspace-ux-consolidation.md) now consolidates the existing workspace into Request Management dialogs, independent Collaboration tabs and bounded recent/full Activity views. Implementation, automated validation and authenticated UAT passed; F043 was accepted and synchronized at the starting checkpoint above. The intentional user-performed UAT assignment is recorded in the feature report. No F043 migration or grant change is required; no deployment occurred.

## Current product boundaries

Residents can use implemented catalog/intake paths and receive the existing safe creation receipt. F044 adds narrow bearer-authorized PUBLIC request tracking; possession does not establish human identity, and neither reference nor UUID is authorization. Production resident identity, richer history and external communication delivery remain separate design work. F042 prepares a minimized correspondence projection but introduces no resident retrieval endpoint; F044 deliberately excludes it. Legacy local Issue editing/deletion and dashboard metrics remain prototype compatibility behavior; they do not define canonical request or staff access policy.

Authenticated staff have a unified workspace with independent PUBLIC/INTERNAL read policies, controlled lifecycle/routing, assignment, watchers, Activity and protected Contact/Notes. My Requests, My Team and Watching filter independently authorized requests. Operational membership is not RBAC. Contact and Notes permissions are separate from parent read/update and from each other.

The catalog includes versioned questions, structured Answers, location policy and narrow action/reference configuration. Broad production administration, production Role/Team administration and geographic routing are not implied by stakeholder previews or development tooling.

Descriptions, operational narratives and Notes may contain incidental PII. Structured-contact protection does not provide automated redaction or a legal confidentiality classification. Notes are staff-only collaboration, not requester communication, Activity or an automatic AI input.

## Continuing without chat history

Recover the expected Git/database checkpoint safely, read the protocol and architecture, select relevant decisions/features, then inspect tests and code. An unexpected checkpoint or material documentation/implementation conflict requires investigation before changes. Historical chat is supplementary context, not the only record of a decision.

Future prompts describe the new outcome, feature-specific boundaries, validation/UAT and explicit commit/push/deploy/stop instructions. Permanent rules live in the protocol; direction lives in the roadmap. Naming migration, GitHub synchronization and deployment remain separately scoped tasks.

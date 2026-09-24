# Reqro — Roadmap

[F054 — Admin Portal and branding foundation](features/F054-admin-portal-branding-foundation.md) is implemented and validated from synchronized F053 `94a1bd54c9b7e7ca45df62e65f7a78d3746cd901`. It uses supplied canonical Reqro assets without trademark notation, protects the existing `/admin` authority, and adds independent optional Organization branding through safe development provisioning. Production uploads/branding CRUD remain deferred. No push, deployment or F055. Earlier checkpoints below retain their historical scope.

[F053 — Admin Intake Settings Management](features/F053-admin-intake-settings-management.md) is implemented and validated from synchronized F052 `c67c38d0823c4b1e781653c9069b487c7b6abecb`. Only Service Participation collection is writable, requiring independent Admin read and intake-write permissions, resource revision comparison, active-area validation and transactional immutable audit. Authenticated UAT retained Enabled at revision 3 and two immutable change audits; see the [F053 report](features/F053-implementation-report.md). Earlier checkpoint statements below retain their historical scope. No push, deployment or F054 is authorized.

[F052 — Organization Administration & Configuration Foundation](features/F052-organization-administration-foundation.md) is implemented and validated from synchronized `4deeb9d3ad99fa9c4d67563cd0dfb9baa1050b9e`. It adds a separate zero-default-grant Admin read permission, protected read-only configuration views, health diagnostics and independently versioned configuration resources. Deployment privacy policy stays separate. See [ADR-014](architecture/decisions/ADR-014-administrative-configuration-authorization.md). Existing entries below retain their historical authorization/checkpoint scope. No F052 push, deployment or F053 is authorized.

The separately authorized [F051 Organization collection follow-up](features/F051-collection-setting-report.md) adds an explicit disabled-by-default Organization boolean. The safe intake configuration distinguishes disabled/ready/incomplete; the server rejects supplied geography when collection is unavailable. Historical data and authorized analytics survive toggles. Production Admin Portal, area management and administrative mutation authorization remain deferred. No push, deployment or F052 is authorized.

[F051 — Requester Geography & Service Participation](features/F051-requester-geography-service-participation.md) is explicitly authorized from synchronized F050 `a093cfa3ec635250b2f44128652a075dd5a4ab81`. It implements optional self-reported service-participation area and independently scoped, suppressed PUBLIC request aggregates. Automated validation, development migration and authenticated UAT passed; see the [report](features/F051-implementation-report.md). Production area administration/privacy governance, maps, exports, population/demographic analysis and scoring are deferred. No push, deployment or F052 is authorized. Earlier paragraphs retain their historical checkpoint authorizations.

[F050 — Trusted Requester Identity & Authorized History](features/F050-trusted-requester-identity-history.md) is implemented as a development foundation with passed automated and authenticated UAT gates; see the [report](features/F050-implementation-report.md). Trusted identity is independent of Contact; contextual history includes only independently accessible requests. Production resident authentication, requester portal, manual identity correction, directory/search, Geography, analytics and behavioral scoring remain deferred. F049 was synchronized before this explicitly authorized feature; earlier entries retain their historical scope. No F050 push/deployment or F051 work is authorized.

[F049 — Anonymous Request Policy](features/F049-anonymous-request-policy.md) is implemented and locally validated with IDENTIFIED_REQUIRED / ANONYMOUS_ALLOWED only. Explicit historical request identity, Contact protection, assisted/INTERNAL staff attribution, independent tracking and assignment are preserved. See [validation evidence](features/F049-implementation-report.md) and [ADR-011](architecture/decisions/ADR-011-explicit-requester-identity.md). Production policy administration, infrastructure/privacy governance, identity/history and advanced abuse controls remain future work. No F049 push/deployment or F050 work is authorized.

[F048 — Issue-Based Default Assignment](features/F048-issue-based-default-assignment.md) is implemented from synchronized F047 `bf084dc`; see its [implementation record](features/F048-implementation-report.md) for passed validation and user-confirmed live logging privacy. One optional Issue owner is applied only at creation; ownership remains separate from authorization and routing. Production configuration UI/API, geographic/content/requester rules, balancing, fallback, escalation and notifications remain deferred. F048 was subsequently synchronized; F049 is recorded above.

[F047 — Service Request Live Search](features/F047-service-request-live-search.md) is implemented, validated and synchronized; its [implementation record](features/F047-implementation-report.md) retains historical evidence.

[F046 — Secure Attachments & Photos Foundation](features/F046-secure-attachments-photos-foundation.md) is implemented and locally validated from synchronized `72081ec6121189c61bdc83acf2ef80d3dcfdf3dd`. Personal development now has **23 applied migrations / 0 pending**, three retained finalized fictional attachments on SR-202609-000008, and the unchanged **1 active / 5 revoked tracking baseline**. The [validation record](features/F046-implementation-report.md) records authenticated UAT, shared preview layout, approved Vite/retry security corrections and completed staging cleanup. This is a development foundation; production storage/scanning remain deferred. No push, deployment or F047 work was performed.

[F045 — Requester Issue Location Experience](features/F045-requester-issue-location-experience.md) is implemented and locally validated from synchronized F044 `54bb498ba37edcd28c646c84a4a1274370939697`. Its [completion report](features/F045-implementation-report.md) records provider-neutral development search, MapLibre selection, explicit device geolocation, manual alternatives and the existing server-owned Service Location/eligibility boundary. The F045 report retains its historical 22-migration and zero-active/four-revoked UAT checkpoint. F045 and subsequent accepted staff workspace polish were synchronized before F046. The approved current F046 starting state is recorded above; historical counts are not the current tracking baseline.

This roadmap describes accepted progress and possible direction, not implementation or deployment authorization. Follow the [development protocol](development/REQRO_CODEX_PROTOCOL.md) for execution, [Architecture](ARCHITECTURE.md) for current behavior and [ADRs](architecture/decisions/README.md) for durable decisions. Historical CityVUE identifiers remain unchanged.

## Accepted progress

The preceding accepted application checkpoint is **F041 complete**: separate append-only Internal Notes for authorized PUBLIC and INTERNAL requests. See the [F041 report](features/F041-implementation-report.md). **F042 — Requester Communication & Correspondence Foundation is accepted and synchronized at `8018acf8f2caf9699faa682241a026f09b101e90`.** See its [feature record](features/F042-requester-communication-foundation.md) and [implementation report](features/F042-implementation-report.md), including the approved two-record UAT automation exception and disclosed live coverage limits.

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
| F042    | Recorded PUBLIC Requester Communication, without delivery     |
| F043    | Consolidated staff request workspace and bounded Activity     |

F044 adds locally validated secure requester tracking; its report distinguishes automated checks, observed browser evidence and user-reported manual lifecycle results.

Earlier foundations include React migration, canonical PostgreSQL catalog/intake, API eligibility, optional Entra/database RBAC, resident alerts, AI/provider governance and synthetic/protected geospatial boundaries. Individual reports distinguish local implementation, previews and deferred production work. The earlier global reference plan was superseded by F033; authentication, lifecycle, ownership and Notes are no longer pending foundations.

## Governance and synchronization checkpoint

Governance consolidation and the separately authorized GitHub synchronization are complete at `371ec3bd753b6054cdc5403ad0e88898ef0ea161`. F042 begins from that synchronized checkpoint.

F042 was separately reviewed and its GitHub synchronization completed. [F043 — Service Request Workspace UX Consolidation](features/F043-service-request-workspace-ux-consolidation.md) was subsequently accepted and synchronized at the starting checkpoint above. F044's current authorization ends at the reviewed local commit and completion report, without push or deployment. The [governance review](development/GOVERNANCE_REVIEW.md) records the earlier synchronization evidence and conditions.

## Product review after F044

The following candidates are deferred and unnumbered. No candidate below has priority or a future feature ID assigned. Review value, privacy, operational impact and dependencies before selecting one:

- Requester identity/history and externally delivered correspondence beyond F044's narrow tracking projection and the F042 recorded PORTAL foundation.
- Notifications with approved recipients, preferences/consent, queues and failure handling.
- Note correction/redaction/versioning that preserves accountability and retention requirements.
- Production attachment storage, malware scanning, retention and operations beyond the F046 development foundation.
- Administrative configuration and production Role/Team administration.
- Priority/SLA/escalation foundations based on approved policies.

Notes editing, deletion, search, mentions, exports, analytics and AI use are also deferred; they must not appear as incidental F041 extensions. Contact editing/search and resident profiles need independent privacy review.

## Deferred stakeholder requirements (unnumbered)

These requirements are recorded during F044 completion for future design and prioritization only. They assign no feature IDs, approve no implementation, and establish no City policy or production configuration.

| Requirement                                                              | Future design scope and decisions                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requester Issue Location Experience                                      | F045 implements development location search, map selection/correction, explicit device input, manual alternatives and existing eligibility enforcement. Production address/geocoder/tile/boundary providers remain deferred.                                                                                                                                                                                                                |
| Service Request Attachments & Photos                                     | F046 implements optional intake evidence, mobile photo selection, protected image processing and three distinct attachment contexts in development. Service-configured policies, production malware scanning/storage/retention and delivery/adapter capabilities remain deferred. F044 tracking exposes no attachments.                                                                                                                     |
| Anonymous Request Policy                                                 | F049 implements two Issue creation policies and explicit immutable anonymous/identified state; see the feature/report above. Production administration, approved privacy wording, infrastructure logging/abuse governance, verified identity, requester history and account linking remain separate future decisions. Missing Contact and tracking possession do not verify a person or residency.                                          |
| Service Location vs Requester Geography vs Device Location               | Keep the issue/service location, voluntarily supplied requester geography and permission-based device position separate in domain, UX, storage and authorization. Do not infer home address, residence, eligibility or service participation from device GPS or IP. Device location should be a deliberate input aid, with correction and non-device alternatives.                                                                          |
| EXIF/GPS privacy                                                         | Define removal/minimization of photo metadata, especially embedded coordinates, timestamps and device identifiers, before upload/storage/redistribution. Decide whether originals are ever necessary, who may access them, and how consent, retention and deletion apply. No metadata ingestion or stripping pipeline is implemented by F044.                                                                                               |
| Requester Identity & History                                             | Design citizen identity independently from workforce Entra: anonymous versus authenticated experiences, identity verification/recovery, request association, safe history and correspondence access, consent and link/account lifecycle. Do not use request reference/UUID or unverified contact as authorization.                                                                                                                          |
| Issue Geography vs Requester Geography / Service Participation Analytics | Distinguish where issues occur from where participating requesters choose to report living, and from device positions. Define purpose, provenance, optionality, quality and missing-data handling before analysis; do not equate request volume with unique residents, residence or representative participation.                                                                                                                           |
| Privacy-preserving aggregate analytics                                   | Review aggregation/geographic precision, small-group suppression, reidentification risk, access/export controls, retention and permitted purposes before reporting. Thresholds and legal requirements remain undecided. Exclude raw tracking credentials, Notes, Contact and sensitive free text from analytics by default.                                                                                                                 |
| Administration/configuration requirements                                | Plan authorized Organization/service-level configuration for location requirements, anonymous/contact/identity policy, attachment/photo limits, metadata privacy, requester history, analytics and provider capabilities. Define independent permissions, server validation, audit/versioning, safe defaults, preview and rollback behavior. Development provisioning and stakeholder previews are not a production administration console. |

External delivery, notifications and vendor integrations remain separately reviewed work. These deferred requirements do not select or start F047.

## Staff capabilities

### Service Request Live Search

Selected as [F047](features/F047-service-request-live-search.md), implemented and locally validated. Debounced server-side search narrows independently authorized requests by Reference, Issue name and displayed Service Location. Existing audience/view/filter/sort/page behavior composes with it; exact Reference filtering remains separate. Protected domains, UUIDs and tracking are excluded. Validation and live logging gates passed; no production deployment is implied.

### Issue-Based Default Assignment

Selected and implemented as [F048](features/F048-issue-based-default-assignment.md): one optional STAFF, operational ROLE or GROUP/Team owner per Organization-scoped Issue. Creation applies a currently eligible target atomically with System Activity/audit; unavailable targets create Unassigned with safe evidence. Existing owners, manual override, finalized retries, routing, watchers and authorization remain independent. Guarded personal-development provisioning is implemented; production administration UI/API and its authorization policy are deferred. Location and other advanced criteria, fallback, balancing, escalation, notifications and general rules remain unimplemented. See the [validation record](features/F048-implementation-report.md) for passed completion gates; F049 is recorded above; no F050 work is authorized.

## Longer-term platform direction

**Catalog and intake:** extend narrow implemented configuration toward reviewed authoring/publication/preview administration, richer conditional intake, accessible discovery and routing policy. Preserve version/Answer history and distinguish platform intake from external redirect. Historical [domain requirements](features/F002-core-product-capabilities-domain-requirements.md) and [catalog direction](features/F003-dynamic-service-catalog-intelligent-intake.md) are broad requirements, not evidence every capability exists.

**Location and GIS:** select approved authoritative providers/layers, address resolution and service-area/asset eligibility, including boundary, outage, indeterminate-result and geographic privacy cases. Preserve API authority and vendor neutrality. Staff override, geographic routing, PostGIS and live integrations need explicit scope; synthetic map presentation does not implement them.

**Staff operations and reporting:** build new dashboard metrics from server-authorized scope with clear direct/team/unassigned definitions. Do not reinterpret browser-local statistics as operational reporting. Extend workflow configuration only through approved transition, revision and history rules.

**Enterprise integrations:** discover actual vendor APIs and capabilities before a controlled pilot. Keep an API-owned router, canonical domain, Organization-scoped mappings/external references and vendor adapters. Validate retries, deduplication, status/source-of-truth rules and recovery. Demonstrate portability with a second approved/mock adapter without requiring a vendor purchase. No vendor connector is currently claimed complete.

**Production readiness:** client identity activation, deployment architecture, security/privacy/records/accessibility review, performance/load evidence, backup/restore, monitoring, operational ownership and support remain separate gates. [F008](features/F008-production-backend-persistence-security-architecture.md) and [F016](features/F016-production-hosting-deployment-readiness-plan.md) preserve hosting direction. Prefer isolated client environments initially; shared SaaS needs a separate tenancy/operating-model decision.

**Naming and rollout:** a technical CityVUE-to-Reqro rename requires its own plan. The historical [F007 static Hosting cutover](features/F007-react-stage-10-production-cutover.md) does not establish deployment of later backend/staff features. Git push and cloud deployment require separate authorization.

## Decision and feature records

Move a candidate through design, explicit approval, implementation and validation before marking it complete. Use [feature records](features/README.md) for requirements/evidence and the [ADR convention](architecture/decisions/README.md) for durable choices. Do not silently rewrite accepted decisions or turn roadmap entries into permission to use client resources.

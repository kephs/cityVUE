# ADR-013 — Operational and participation geography are separate domains

Status: approved F051 design, implemented and validated. Development foundation only; no production governance or deployment approval.

## Meaning and collection

Service Location answers where a problem exists. F051 answers which approved coarse area a requester explicitly associates with this service interaction. It does not establish residence. Device location can propose Service Location after deliberate consent; photo GPS is stripped under F046. Neither is participation geography. Contact, IP, prior requests and trusted identity never supply participation geography.

The approved optional question is “Which area do you associate with this service request? (Optional)”. Prefer not to say explicitly records DECLINED. No selection, unavailable collection, omitted API input and pre-feature records are NOT_COLLECTED; absence is never silently treated as refusal. Clients may submit PROVIDED plus an active Organization area or DECLINED without area, but cannot assert the historical/not-collected state explicitly. INTERNAL intake rejects participation input. A declined or provided anonymous request stays Contact-free and Requester-link-free.

Participation Areas have opaque UUIDs, Organization, bounded label, active flag, order and timestamps. No geometry, requester coordinates or free-text requester geography is stored. Labels can change; historical references use current labels, and deactivation affects future selections only. Referenced areas cannot be deleted. Request geography is immutable. It is not added to the F050 Requester entity or copied between linked requests. Selection admission locks the area for share during creation; deactivation and creation serialize. Existing F046 finalized retries precede current area validation and preserve the original relation. Geography participates in the retry digest only when supplied, preserving older digest behavior.

## Authorization and disclosure

The explicitly approved new permission is `analytics.service_participation.read`. Migration registers it without grants; ordinary read, geospatial permission and existing broad development bundles do not imply it. Analytics also requires `service_request.view`, trusted active Organization and existing effective Department/Division scope. The SQL scope is applied before grouping, not after aggregation. INTERNAL requests never contribute. Permissions and scope are resolved on every request; no durable analytics cache exists.

The endpoint returns aggregate request counts by configured area, DECLINED and NOT_COLLECTED. One person submitting twice contributes two requests. It returns no request IDs/references, Requester IDs, identity mode, Contact, Service Location, coordinates, narratives, attachments, communications or tracking. There is no drill-down, export, map, cross-tab, demographic enrichment, denominator, population rate, score or classification. Individual geography also remains absent from ordinary detail/list, Contact, F050 history, F047 search and F044 tracking. It has no eligibility, workflow, routing, assignment or ownership effect.

The safe server setting `PARTICIPATION_SUPPRESSION_THRESHOLD` defaults to 5 and admits integers 5–1000. Ordinary analytics users cannot modify it. Positive counts below threshold become `{suppressed:true,count:null}` before response construction. Zero remains zero; threshold and larger values are exact. All configured areas (including inactive historical areas) appear deterministically, so an area's presence does not reveal the existence of inaccessible requests. DECLINED and NOT_COLLECTED receive the same suppression. No grand total, percentage or alternative exact field is returned. For synthetic counts 7 and 3 at threshold 5, only 7 and suppressed/null are disclosed, with no total 10 to reveal the smaller cell.

Dates are strict UTC YYYY-MM-DD with an inclusive end date; SQL uses a half-open timestamp interval. Periods span 28–366 days and cannot end after today's UTC date. The preview initially requests the last 365 days including today. There are no other filters or daily series. Minimum duration, limited dimensions and omission of totals reduce differencing opportunities but do not eliminate inference from repeated windows, changing data/scope or outside information (including independently accessible request totals). This is deterministic small-cell suppression, not differential privacy or a guarantee against statistical disclosure. Production needs its own privacy review and access governance.

An authorized response requires a committed append-only `service_participation_audit` row with Organization, staff actor, action, period, threshold, correlation UUID and timestamp only. No raw counts, individual geography or request identifiers are audited. Audit failure denies disclosure. No-store applies to success and denied analytics responses. Normal logging retains existing route/status/correlation metadata, never input/response bodies or aggregate cells.

## Operations, performance and limitations

Public area options inherit the existing server-configured intake Organization; the browser cannot choose Organization. Assisted area options use authenticated staff Organization and intake permission. Production tenant-resolution remains the existing deployment boundary, not a new browser selector. A guarded personal-development CLI provisions only three fictional areas after explicit dry-run/confirm; it changes no requests/grants. Production area administration, label approval and retention/correction governance are deferred. The initial CLI creates/reuses configuration only; no runtime area mutation API is exposed.

Analytics executes a SQL aggregate over the scoped period, one Organization area-catalog query and one required audit insert inside a repeatable-read transaction, plus existing authentication/authorization queries. No request download or N+1 operation. The Organization/date/area partial PUBLIC index supports the period restriction; active-area ordering has its own catalog index. Small fixture planners may choose sequential scans. Cost grows with authorized requests and configured areas; no production-scale claim is made.

## Threat review

| Threat                                            | Control / remaining boundary                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| Location, GPS, EXIF, Contact or IP inference      | Explicit independent field; no inference code or provider call                 |
| Anonymous identity recovery or persistent profile | No Contact/Requester link from area; request-only immutable state              |
| Cross-Organization or inactive substitution       | Trusted Organization, composite FK, active selection check and share lock      |
| Contradictory or forged state                     | Strict DTO/service validation plus database check constraints                  |
| Historical rewrite                                | NOT_COLLECTED default only, immutable geography, safe rollback refusal         |
| Detail/history/search/assignment leakage          | Existing explicit projections and focused regression tests                     |
| Analytics privilege expansion                     | Dedicated permission plus existing PUBLIC SQL scope; no default grants         |
| Small or secondary bucket disclosure              | Suppression before response; no totals or percentages                          |
| Repeated-window/scope differencing                | Bounded minimum period, no extra filters, audit; residual inference documented |
| Logging/audit leakage                             | Existing log allowlist; typed metadata-only append-only audit                  |
| Production misinterpretation                      | No residence, population, unique-person, representativeness or equity claim    |

This extends [ADR-012](ADR-012-trusted-requester-identity-history.md), preserving [ADR-011](ADR-011-explicit-requester-identity.md), [ADR-006](ADR-006-public-internal-staff-authorization.md), [ADR-005](ADR-005-requester-contact-privacy.md), [ADR-009](ADR-009-secure-requester-tracking.md) and [ADR-010](ADR-010-secure-attachment-architecture.md). See [F051](../../features/F051-requester-geography-service-participation.md).

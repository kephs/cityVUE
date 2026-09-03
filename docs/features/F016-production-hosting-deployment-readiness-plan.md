# F016 — Production Hosting and Deployment Readiness Plan

**Status:** Planning only; City approval required

**Scope:** Target architecture, prerequisites, and sequencing only

No infrastructure has been approved or provisioned through this record, and no application, database, Firebase, Azure, DNS, identity, integration, or CI/CD deployment has been performed. Resource names, subscriptions, environments, domains, certificates, identifiers, credentials, service tiers, network topology, availability objectives, and operational owners remain subject to City review.

## Preferred first-municipality target

The recommended initial production architecture uses managed Azure services:

| Responsibility | Preferred target |
| --- | --- |
| React frontend | Azure Static Web Apps |
| NestJS API and future workers | Azure Container Apps |
| Container images | Azure Container Registry |
| Canonical database | Azure Database for PostgreSQL Flexible Server |
| Server secrets | Azure Key Vault, accessed through approved managed identity where practical |
| Staff identity | Microsoft Entra ID |
| Future attachments | Private Azure Blob Storage with relational metadata |
| Monitoring | Application Insights and Azure Monitor using structured, correlated telemetry |
| DNS and TLS | City-approved domain, DNS, and certificate process |

This is a preferred target, not evidence of City approval, procurement, provisioning, security acceptance, or production readiness. The existing public production MVP remains React/Vite on Firebase Hosting with browser-local legacy persistence. The NestJS/PostgreSQL platform remains local-development-only.

## Environment separation

Development, Test/QA, and Production are separate operational and security boundaries. Each environment should have separate databases, configuration, secrets, storage, telemetry, and integration credentials. Production data must not become routine development or test data. Any exceptional use of production-derived data requires an approved, privacy-preserving process with minimization or anonymization, access controls, retention, and audit appropriate to its classification.

The preferred first-municipality model remains one isolated environment set per municipality. Exact subscription/resource-group boundaries and whether Test and Production use separate subscriptions require City approval.

## Production-readiness prerequisites

- [ ] City architecture, cybersecurity, privacy, and production approval
- [ ] Approved Azure subscription and resource-group structure
- [ ] Named application, infrastructure, database, security, support, incident, and data owners
- [ ] Network topology, firewall, ingress/egress, private connectivity, DNS, and administrative-access design
- [ ] Separate Entra SPA/API registrations, approved redirect URIs/scopes, Conditional Access, MFA, lifecycle, and break-glass requirements
- [ ] Key Vault design, managed identities, secret/certificate ownership, rotation, and recovery
- [ ] Isolated PostgreSQL Test and Production environments, TLS/network controls, migration access, capacity, maintenance, and monitoring
- [ ] Azure Container Registry with image provenance, vulnerability scanning, retention, and access controls
- [ ] Container Apps Test and Production environments, revision/health/scaling configuration, and managed identities
- [ ] Azure Static Web Apps Test and Production hosting, API/CORS configuration, and rollback capability
- [ ] Application Insights/Azure Monitor telemetry, redaction, retention, dashboards, alerting, and operational response
- [ ] Backup policy, restore testing, recovery objectives, disaster-recovery design, and documented exercises
- [ ] Approved CI/CD identity, protected environments, review gates, artifact promotion, migration gates, audit trail, and rollback
- [ ] City-approved custom DNS/TLS ownership, validation, renewal, and emergency-change process
- [ ] Authoritative GIS sources, ownership, service areas/layers, refresh cadence, boundary semantics, privacy, and availability behavior
- [ ] EAM and other integration endpoints, capabilities, mappings, credentials, network paths, failure handling, and support ownership
- [ ] Data classification, residency, retention, legal hold, records, export, archival, deletion, and production-data handling decisions
- [ ] Threat modeling, dependency/container review, penetration/security testing, accessibility testing, performance/load testing, and production UAT
- [ ] Launch, rollback, incident response, business continuity, disaster recovery, support, and maintenance runbooks

## Recommended provisioning and promotion order

These are planned gates; none is complete merely because it appears here.

1. Architecture and security approval
2. Azure subscription and resource-group approval
3. Networking design
4. Entra registrations
5. Key Vault
6. PostgreSQL Test
7. Container Registry
8. Container Apps Test
9. Static Web App Test
10. CI/CD pipeline
11. Deploy the API to Test
12. Deploy the React API-mode frontend to Test
13. Establish GIS and integration Test connectivity
14. Complete security review and UAT
15. Provision Production PostgreSQL
16. Provision Production API infrastructure
17. Provision Production frontend infrastructure
18. Configure Production DNS
19. Run controlled Production migrations
20. Conduct a controlled Production launch

Every promotion must define evidence, approvers, rollback criteria, and ownership. Production migrations require backups or an approved recovery point, reviewed forward/backward compatibility, least-privilege execution, observability, and a tested recovery procedure.

## Security boundary

Public resident submission may remain unauthenticated, subject to endpoint-specific rate limiting, abuse/bot controls, API-authoritative geographic eligibility, input validation, privacy controls, and security monitoring. This does not authorize public record reads or staff actions.

Canonical `/issues`, `/dashboard`, `/admin`, staff details, assignment, workflow, and other staff functions require Microsoft Entra authentication plus server-enforced CityVUE RBAC and Organization scope before production exposure. UI guards alone are insufficient. Separate SPA/API registrations, authorization code with PKCE, no SPA secret, least privilege, and approved Conditional Access remain the F008 direction.

## Portability and alternative hosting

Azure is the preferred first managed-services target because managed database, secret, identity, telemetry, container, and hosting capabilities reduce initial operational risk. CityVUE's core remains portable: React, NestJS, TypeScript, PostgreSQL, Docker, and REST/OpenAPI. Canonical domain and application code must not depend on Azure-specific schemas or identifiers; managed identity, Key Vault, Blob Storage, telemetry, and hosting integrations stay at infrastructure adapters and configuration boundaries.

A VPS or other standards-compliant container host remains technically possible for future customers or customer-managed environments. It is not the recommended initial City production architecture. Each deployment must independently define patching, hardening, network controls, secrets, database operations, backups, observability, availability, incident response, and support ownership; the exact hosting model is deployment-specific.

## Explicit non-goals

This plan does not provision resources, configure Firebase or Azure, create Entra registrations, establish DNS, generate secrets, add PostGIS, choose a production GIS provider, connect an EAM, implement CI/CD, expose canonical staff routes, or deploy code. Each requires a separately authorized implementation and review phase.

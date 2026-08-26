# CityVUE — Project Context

## Project Identity

**CityVUE** is the canonical name of the application during development.

CityVUE is currently an internal development/prototype project intended to explore and build a modern, City-controlled citizen-engagement platform. **Ask Rockville** was previously considered as a possible future public-facing name, but it is not the current application name and should not be treated as approved branding.

- **Development name:** CityVUE
- **Current status:** Internal development/prototype
- **Future public-facing name:** TBD
- **Previously considered name:** Ask Rockville

Do not rename the application, repository, deployment resources, package identifiers, or documentation to Ask Rockville unless explicitly instructed.

## Project Vision

CityVUE should provide residents with a simple way to find City services, report issues, submit service requests, provide location/supporting information, track requests where supported, and receive useful status information without needing to know which internal enterprise application processes the request.

CityVUE should be treated as a potential **City-owned digital front door and citizen-engagement layer**, not merely as a custom front end for one Enterprise Asset Management (EAM) product.

## Current Status

A working MVP has been developed and deployed. Known capabilities include:

- Report an Issue workflow
- Search, filtering, and sorting
- Editing and deleting records
- Dashboard statistics
- Category visualization
- Toast notifications
- Delete confirmation
- Dark mode
- Citizen-facing home/hero experience

Firebase Hosting has been used for MVP deployment. The repository is authoritative for exact framework versions, dependencies, routing, state management, persistence, and implementation details.

## Strategic Goal: Vendor Neutrality

CityVUE must not be designed as “the VUEWorks front end.”

The long-term architecture should allow integration with different EAM, work-management, permitting, case-management, or other enterprise systems, including:

- VUEWorks
- Trimble Cityworks
- OpenGov Cartegraph
- MyGovernmentOnline (MGO)
- VistaShare Outcome Tracker
- Other current or future City systems

The City should be able to replace an enterprise system without requiring a complete rewrite of the CityVUE citizen experience.

> **No enterprise vendor's data model should become the CityVUE domain model.**

Core vendor-neutral concepts should include items such as `ServiceRequest`, `Service`, `Category`, `Location`, `Department`, `WorkItem`, `Attachment`, and `RequestStatus`. Vendor adapters translate these concepts to and from external-system APIs/data models.

## Business Goals

CityVUE should:

1. Make it easy for residents to report problems and request City services.
2. Provide a consistent citizen-facing experience.
3. Support request tracking where available.
4. Hide unnecessary internal organizational and vendor complexity.
5. Support multiple departments and service categories.
6. Integrate with multiple enterprise systems.
7. Minimize vendor lock-in.
8. Support secure staff access and administration.
9. Remain maintainable as City systems and vendors change.

## Relationship to the Current VUEWorks Program

The City is currently implementing VUEWorks for EAM/CRM-related capabilities. CityVUE is being developed while citizen service requests, CitizenVUE, Survey123, and enterprise integrations are active considerations.

VUEWorks provides useful requirements and a potential first EAM integration, but CityVUE's architecture should remain independent of VUEWorks.

CityVUE may eventually submit selected requests to VUEWorks, retrieve/synchronize status, route other services to different systems, and continue providing the same citizen interface during a future EAM migration.

Exact integration scope remains subject to City decisions, technical discovery, security review, and vendor API capability.

## Multi-System Routing Vision

```text
Citizen
   |
   v
CityVUE
   |
   v
Service Catalog / Routing Rules
   |
   +--> Service A -----------> VUEWorks
   +--> Service B -----------> Cityworks
   +--> Service C -----------> Cartegraph
   +--> Permitting ----------> MGO
   +--> Other Service -------> Other System
```

These routes are illustrative only. Residents should not need to know the destination system.

## Intended Users

### Residents

Residents should eventually be able to find services, report issues, enter/select locations, answer service-specific questions, submit supporting information, receive confirmation, track status where supported, receive updates, and find answers without unnecessary submissions.

### City Staff

Authorized staff may eventually authenticate using Microsoft Entra ID, review/search requests, view details, perform permitted administrative actions, troubleshoot integrations, and access reporting or operational dashboards.

Privileged authorization must not depend solely on client-side controls.

## Planned / Candidate Capabilities

These are not implemented unless confirmed in the repository:

- Microsoft Entra ID SSO
- Role-based staff access
- Address autocomplete/validation
- Dependent service/category lists
- Dynamic follow-up questions
- Configurable service catalog/forms
- Chatbot/conversational service discovery
- Live search
- Citizen request tracking and notifications
- VUEWorks integration
- Cityworks integration capability
- Cartegraph integration capability
- MGO integration
- VistaShare integration
- Additional APIs
- Central CityVUE API/integration layer

## Architectural Principles

- **Citizen experience first:** use citizen-friendly terminology.
- **Vendor neutrality:** keep vendor assumptions out of core workflows.
- **Loose coupling:** avoid direct browser dependency on enterprise APIs.
- **Canonical CityVUE model:** translate between CityVUE and vendor models.
- **Adapter-based integrations:** isolate vendor-specific behavior.
- **API/middleware preference:** use a City-controlled integration boundary where practical.
- **Security by design:** authentication, authorization, secrets, logging, privacy, and data protection are first-class requirements.
- **Configurability:** increasingly drive services, questions, routing, and mappings from configuration/data.
- **Incremental delivery:** validate through manageable phases and pilots.

## Security Expectations

- Never commit credentials, secrets, tokens, private certificates, or production connection strings.
- Keep `.env` and equivalent secret-bearing files out of Git.
- Provide `.env.example` with placeholders only.
- Never expose privileged enterprise credentials in browser code.
- Client-side route protection is not sufficient authorization.
- Protected APIs must independently authenticate and authorize users.
- Apply least privilege.
- Validate untrusted input.
- Avoid unnecessary storage/logging of personal information.
- Do not use production personal information in development/test unless explicitly authorized and protected.

## Development Approach

For substantial features:

1. Define the business problem.
2. Document requirements and acceptance criteria.
3. Review architecture/security implications.
4. Create/update a feature specification under `docs/features/`.
5. Implement on a focused branch when practical.
6. Run available tests/build/lint/type checks.
7. Review the diff.
8. Update architecture/decision documentation.
9. Commit a logical unit of work.

## Source of Truth

When information conflicts, use this order:

1. Current approved City requirements and decisions
2. Current repository behavior/code
3. Approved feature specifications
4. Architecture Decision Records
5. `ARCHITECTURE.md`
6. `CITYVUE_CONTEXT.md`
7. `ROADMAP.md`

Identify conflicts rather than silently guessing.

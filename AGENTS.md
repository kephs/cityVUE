# AGENTS.md — Reqro Development Instructions (CityVUE Repository)

## Project Identity

The current client-neutral product name is **Reqro**. **CityVUE** remains the historical repository name and existing technical/runtime identifier; a repository-wide rename has not occurred.

**Ask Rockville** is only a previously considered candidate public-facing name. Do not introduce Ask Rockville branding or perform a mass rename of the `cityVUE` directory, repository, package identifiers, Firebase configuration, deployment resources, source files, or documentation unless explicitly instructed.

## Read Before Significant Work

Before non-trivial changes, read:

- [Reqro Codex Protocol](docs/development/REQRO_CODEX_PROTOCOL.md) — permanent execution rules and fresh-session recovery
- `docs/CITYVUE_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- Relevant `docs/features/`
- Relevant [architecture decisions](docs/architecture/decisions/README.md), including retained historical `docs/decisions/` records

## Understand Before Editing

Before significant implementation:

1. Inspect the repository.
2. Determine the actual framework, package manager, routing, state management, persistence, tests, build, lint, and deployment conventions.
3. Reuse established patterns where reasonable.
4. State important assumptions.
5. Do not replace working architecture simply because another pattern is preferred.

The repository is authoritative for exact implementation details.

## Project Intent

Reqro is a **vendor-neutral citizen-engagement platform**, not a front end exclusively for VUEWorks.

Reqro is developed as a client-neutral software platform. Client-specific capabilities are supplied through configurable provider/adapter boundaries and deployment configuration. Independent development does not require client production infrastructure, credentials, internal networks, or non-public data. Treat Rockville as a prospective deployment, and use only local, synthetic, public test, or personally controlled resources until separately authorized.

Potential enterprise destinations include VUEWorks, Trimble Cityworks, OpenGov Cartegraph, MGO, VistaShare, and future City systems.

## Core Vendor-Neutrality Rule

> **No enterprise vendor's data model should become Reqro's core domain model.**

Use neutral concepts such as:

- ServiceRequest
- Service
- Category
- Location
- Department
- WorkItem
- Attachment
- RequestStatus

Keep vendor-specific names, schemas, endpoints, and transformations inside integration adapters.

## Coding Principles

- Prefer small, focused, reusable components/modules.
- Follow existing project conventions.
- Separate presentation, business logic, data access, and integration concerns where practical.
- Avoid unnecessary dependencies and broad rewrites.
- Preserve existing functionality unless intentionally changing it.
- Prefer configuration/data-driven behavior for growing service rules.
- Maintain accessibility and responsive behavior.
- Use clear, maintainable names and code.

## Enterprise Integration Rules

Preferred conceptual architecture:

```text
Reqro
   |
Reqro API
   |
Integration Router
   |
   +-- VueWorksAdapter
   +-- CityworksAdapter
   +-- CartegraphAdapter
   +-- MgoAdapter
   +-- FutureAdapter
```

When implementing integrations:

- Never put privileged credentials in browser code.
- Avoid exposing internal/vendor APIs directly for convenience.
- Isolate vendor-specific transformations.
- Keep Reqro's canonical model independent from vendor schemas.
- Normalize external statuses only according to approved mappings.
- Provide predictable error handling and observability.
- Do not invent undocumented vendor API behavior.

Where supported, adapters may expose consistent operations such as `createRequest`, `getRequest`, `getRequestStatus`, `updateRequest`, and `addAttachment`. Do not force an adapter to support functionality its destination system does not provide; represent capabilities explicitly.

## Authentication and Authorization

Microsoft Entra ID is the implemented optional enterprise workforce identity adapter. Independent development uses no client tenant by default; a future authorized client deployment may use its approved identity resources. Citizen identity remains separate; local implementation does not establish production readiness.

- Follow an approved authentication specification.
- UI route guards are not sufficient authorization.
- Protected APIs must independently validate identity and permissions.
- Never invent tenant IDs, client IDs, secrets, scopes, roles, groups, or redirect URIs.
- Citizen identity remains TBD; do not automatically design it around workforce Entra accounts.

## Security Governance

- Follow [the CityVUE security framework](docs/security/SECURITY_FRAMEWORK.md); distinguish implemented controls, architectural requirements, and planned work.
- Preserve server-side authentication, authorization, and validation boundaries; React is never a security boundary.
- Never expose secrets in client code (including Vite environment values) or commits.
- Do not weaken authentication, authorization, validation, CORS, TLS, rate limiting, logging sanitation, or error sanitation without explicit justification and review.
- Identify security-sensitive changes during implementation and add/update tests when security behavior changes.

## Secrets

Never commit passwords, client secrets, API keys, tokens, private certificates/keys, production database credentials, or credential-bearing connection strings.

Use environment variables or an approved secret-management mechanism. Keep secret-bearing local files out of Git.

## Dependencies

Before adding a dependency, check existing capabilities, prefer maintained packages, explain why it is needed, avoid overlapping libraries, and do not perform broad upgrades unless required/requested.

## UI

- Preserve existing **CityVUE** runtime branding until a separately approved naming migration; use **Reqro** for current product/governance discussion.
- Do not introduce Ask Rockville branding unless requested.
- Use citizen-friendly language.
- Hide internal vendor complexity.
- Maintain semantic markup, keyboard accessibility, and responsive behavior.

## Testing and Validation

Inspect repository scripts and run applicable checks such as tests, lint, type checks, and production build. Do not invent commands.

If checks cannot run or fail for a pre-existing reason, report it clearly. Add/update tests for important behavior when an established testing approach exists.

## Scope Control

Do not silently redesign unrelated pages; rename the app/repository/deployment resources; change hosting, routing, state management, framework, authentication architecture, or production integrations; or remove features.

Explain broader changes first unless explicitly authorized.

## Documentation

Update documentation when changes affect architecture, setup, environment variables, integrations, authentication, deployment, user-visible behavior, or durable technical decisions.

Use `docs/features/F00X-feature-name.md` for significant feature specifications and the [ADR convention](docs/architecture/decisions/README.md) for durable decisions. Retain historical ADR paths; do not silently rewrite accepted decisions.

## Git Workflow

When practical, use focused branches and logical commits, avoid unrelated cleanup, and review `git diff`. Do not push, merge, force-push, rebase shared branches, or deploy unless explicitly requested.

## Completion Report

Report:

1. What was implemented
2. Files added/changed
3. Important design decisions
4. Tests/checks and results
5. Known limitations
6. Configuration/manual steps
7. Recommended next step

## Unclear Requirements

Never fabricate City policy, approved architecture, vendor capabilities, API endpoints, credentials, or security requirements.

For small reversible details, use the safest existing pattern and state the assumption. For decisions affecting security, enterprise integrations, production architecture, data ownership, or major workflows, request a decision or present options first.

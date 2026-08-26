# AGENTS.md — CityVUE Development Instructions

## Project Identity

The canonical development name is **CityVUE**. CityVUE is currently an internal development/prototype project.

**Ask Rockville** is only a previously considered candidate public-facing name. Do not introduce Ask Rockville branding or perform a mass rename of the `cityVUE` directory, repository, package identifiers, Firebase configuration, deployment resources, source files, or documentation unless explicitly instructed.

## Read Before Significant Work

Before non-trivial changes, read:

- `docs/CITYVUE_CONTEXT.md`
- `docs/ARCHITECTURE.md`
- `docs/ROADMAP.md`
- Relevant `docs/features/`
- Relevant `docs/decisions/`

## Understand Before Editing

Before significant implementation:

1. Inspect the repository.
2. Determine the actual framework, package manager, routing, state management, persistence, tests, build, lint, and deployment conventions.
3. Reuse established patterns where reasonable.
4. State important assumptions.
5. Do not replace working architecture simply because another pattern is preferred.

The repository is authoritative for exact implementation details.

## Project Intent

CityVUE is intended to become a **vendor-neutral citizen-engagement platform**, not a front end exclusively for VUEWorks.

Potential enterprise destinations include VUEWorks, Trimble Cityworks, OpenGov Cartegraph, MGO, VistaShare, and future City systems.

## Core Vendor-Neutrality Rule

> **No enterprise vendor's data model should become CityVUE's core domain model.**

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
CityVUE
   |
CityVUE API
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
- Keep CityVUE's canonical model independent from vendor schemas.
- Normalize external statuses only according to approved mappings.
- Provide predictable error handling and observability.
- Do not invent undocumented vendor API behavior.

Where supported, adapters may expose consistent operations such as `createRequest`, `getRequest`, `getRequestStatus`, `updateRequest`, and `addAttachment`. Do not force an adapter to support functionality its destination system does not provide; represent capabilities explicitly.

## Authentication and Authorization

Microsoft Entra ID is a planned/candidate technology for City staff authentication.

- Follow an approved authentication specification.
- UI route guards are not sufficient authorization.
- Protected APIs must independently validate identity and permissions.
- Never invent tenant IDs, client IDs, secrets, scopes, roles, groups, or redirect URIs.
- Citizen identity remains TBD; do not automatically design it around workforce Entra accounts.

## Secrets

Never commit passwords, client secrets, API keys, tokens, private certificates/keys, production database credentials, or credential-bearing connection strings.

Use environment variables or an approved secret-management mechanism. Keep secret-bearing local files out of Git.

## Dependencies

Before adding a dependency, check existing capabilities, prefer maintained packages, explain why it is needed, avoid overlapping libraries, and do not perform broad upgrades unless required/requested.

## UI

- Use **CityVUE** as the current application name.
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

Use `docs/features/F00X-feature-name.md` for significant feature specifications and `docs/decisions/ADR-00X-decision-name.md` for durable architecture decisions.

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

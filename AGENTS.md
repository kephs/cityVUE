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

Use focused branches and logical commits under the [Multi-Agent Engineering Protocol](#multi-agent-engineering-protocol), avoid unrelated cleanup, and review `git diff`. Do not push, merge, force-push, rebase shared branches, or deploy unless explicitly requested. Staging and committing also require explicit authorization under the action gates below.

## Multi-Agent Engineering Protocol

This protocol supplements the existing project-specific security, architecture, validation and development requirements; it does not replace or weaken them.

### Source of truth

- Git `main` is the authoritative integration branch.
- Every task must identify and verify its baseline before editing: repository, branch, exact HEAD, working tree/index and ahead/behind state against the applicable tracking reference. A local tracking reference is last-known state, not proof of current remote state.
- Never assume another agent's conversational state represents repository state.
- Agent handoffs occur through verified Git state and documented feature records.

### Isolated engineering agents

- Codex, Claude Code, Gemini/Antigravity, GitHub Copilot and any other coding agent must use its own branch/worktree for independent feature work.
- Agents must not edit another agent's worktree.
- Parallel agents must have non-overlapping authorized scope unless an explicit coordination plan says otherwise.
- If another active agent has overlapping changes, STOP and report the conflict.

### Accepted UI Baseline

Any screen, component or layout that has passed manual UAT is an **Accepted UI Baseline**. The **Service Request List** and **Service Request Workspace** at checkpoint `6732837d86dd5a03a3e7604d869bd156fd010fa5` are Accepted UI Baselines.

- Accepted UI is immutable unless the current feature explicitly authorizes changing a named area.
- Do not opportunistically redesign, reorganize, rename, restyle, reformat or “improve” accepted UI.
- Preserve accepted responsive behavior, light/dark behavior, typography, iconography, terminology, navigation and accessibility behavior unless explicitly in scope.
- If a feature appears to require changing another accepted UI area, STOP and request approval.
- A bug may be diagnosed without authorization to redesign the surrounding surface.

### Scope discipline

- Make the smallest coherent change that satisfies the approved requirement and preserve behavior outside authorized scope.
- Do not perform unrelated cleanup or refactoring during feature work.
- Diagnose adjacent defects and report them separately instead of silently expanding scope.
- For presentation-only tasks, do not modify backend, API, security or database behavior unless investigation proves it necessary; STOP for approval before implementing such changes.

### Security and authorization gates

Explicit approval is required before implementing:

- New or changed authorization semantics.
- New permission keys or grants.
- Identity or authentication architecture changes.
- Schema migrations.
- Destructive database operations.
- New dependencies with security or architecture impact.
- Cloud, infrastructure or provisioning changes.
- Production or live configuration changes.

Preserve fail-closed behavior. Never add a development or authentication bypass merely to make UAT or testing easier.

### Database and live-environment safety

- Do not point automated integration tests at a development or production database merely because a dedicated test database is unavailable.
- Never invent or copy database credentials or `.env` secrets merely to satisfy validation.
- Prefer synthetic, disposable test data.
- Do not mutate live requests or databases merely for automated or visual UAT unless explicitly authorized.
- Report skipped or unavailable suites as skipped/not executed, never passed.

### Validation integrity

- Report exact test counts and invocation outcomes; distinguish clean full-suite runs from focused reruns.
- Preserve failures, timeouts, retries, flakes and skipped tests honestly.
- A successful isolated rerun is supplemental evidence; it does not rewrite a failed full-suite invocation.
- Do not double-count focused or responsive reruns in repository-wide distinct totals.
- Do not weaken assertions, increase timeouts, disable tests or change expected behavior solely to obtain a pass without explicit approval.
- Do not claim WCAG certification from accessibility-oriented checks.

### Git/action gates

Default state after implementation and validation: **STOP BEFORE STAGING.**

Staging, committing, pushing, deployment, database migration and provisioning/cloud mutation each require explicit authorization. Approval for one action does not authorize the others. Never force-push unless explicitly directed under a reviewed recovery procedure.

### Commit and synchronization discipline

- Preserve coherent feature boundaries.
- Do not amend an accepted or pre-existing commit unless explicitly authorized.
- Before synchronization, verify parent, file allocation, clean index/tree and ahead/behind state.
- Prefer fast-forward integration when the accepted feature branch is a direct descendant of `main`.
- Verify local HEAD and `origin/main` after push.
- Temporary worktree and UAT artifacts must not enter feature commits.

### Manual UAT

- When manual UAT is required, automated validation does not substitute for it.
- STOP after producing the requested UAT evidence.
- Do not stage or commit while awaiting manual acceptance unless explicitly instructed.
- After UAT passes, freeze the accepted state before integration; acceptance does not independently authorize staging, committing or integration.

### Stop conditions

STOP and report rather than improvise when:

- A migration appears necessary but was not authorized.
- Security or authorization semantics are ambiguous.
- Implementation requires altering a frozen UI outside scope.
- Another agent has overlapping active work.
- Requested validation would require unsafe/live credentials or mutations.
- Repository state differs materially from the supplied baseline.
- Completing the task would require weakening an established protection.

### Agent-neutral rule

These rules apply equally to Codex, Claude Code, Gemini/Antigravity, GitHub Copilot and future engineering agents. No agent receives authority merely because it can technically perform an operation.

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

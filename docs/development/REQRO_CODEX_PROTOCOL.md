# Reqro Codex Development Protocol

This protocol contains permanent engineering execution rules for Reqro. Feature specifications describe what is new, what changes, and what must remain unchanged for that feature. A new session should be able to work from the repository without a historical chat transcript.

Read this protocol, [Architecture](../ARCHITECTURE.md), [Roadmap](../ROADMAP.md), only the relevant [ADRs](../architecture/decisions/README.md), and relevant [feature specifications](../features/README.md), then inspect their code and tests. [Project context](../CITYVUE_CONTEXT.md) explains the repository's history. Apply the [security framework](../security/SECURITY_FRAMEWORK.md), distinguishing implemented controls from future requirements. Preserve working architecture; do not substitute a preferred framework or pattern without a justified, authorized change.

## Document authority and recovery

| Source                             | Responsibility                                                    |
| ---------------------------------- | ----------------------------------------------------------------- |
| This protocol                      | Permanent development execution rules                             |
| Architecture                       | Current high-level system map and implementation boundaries       |
| ADRs                               | Durable decisions, rationale and consequences                     |
| Roadmap                            | Completed and potential product direction, not execution approval |
| Feature specifications and reports | Feature-specific requirements and historical evidence             |
| CITYVUE_CONTEXT                    | Product, repository and implementation history                    |
| Code, tests and database           | Authoritative executable behavior and actual persisted state      |

An explicit task defines scope, starting checkpoint and authorizations; do not infer approval from a roadmap entry. If a requirement or document conflicts with tested implementation, stop the conflicting work, investigate and report the discrepancy. Do not silently change code to satisfy stale documentation during a documentation task. A historical report's migration count, grant set or deferred capability describes that checkpoint, not today's universal rule.

For a fresh-session recovery: verify repository, branch, HEAD and working tree; read the documents above; read the latest accepted feature report; inspect relevant tests and implementation; verify any required local database state without exposing private values; continue from the accepted checkpoint. Preserve user changes and distinguish completed evidence from outstanding work. Update durable records as work progresses so another session can recover without guessing.

Accepted ADRs must not be silently rewritten when a decision changes. A future approved change creates a superseding ADR, marks the earlier decision as superseded with a link, or records an explicit dated amendment and rationale. Small factual corrections should identify their reason. Preserve historical paths and links; use full descriptive links where different ADR series reuse numbers.

## Checkpoint, Git and deployment safety

Before changing anything, verify the task's expected branch and exact starting HEAD, run `git status`, inspect the ahead/behind relationship to the existing remote-tracking reference, and review existing changes. Stop on unexpected state. Do not reset, rebase, amend accepted feature history, or repair the checkout without explicit authorization. A local `origin/main` is the last known tracking state; reading it does not establish the remote's current state. Do not fetch or contact a remote when the task permits static inspection only.

Keep the change focused. Do not mix unrelated cleanup, dependency upgrades, branding migration or future features into the task. Before committing, remove temporary UAT artifacts, review the entire staged file set and relevant diff, run whitespace and private-value checks, and confirm required validation passed. Stage only intended files. Verify the resulting commit, clean working tree, ahead/behind count and unchanged tracking reference where required. Report any remaining work honestly instead of declaring a partial feature complete.

**Push policy:** the feature/task prompt explicitly determines push authorization. If it says DO NOT PUSH, do not push. A later explicit authorization after review permits only the approved commits and branch. Inspect workflows, hooks, package scripts, release automation and deployment effects before a first/new push when automation could act externally. Unexpected secrets in local history require a stop and a safe file/commit/type report, never automatic history rewriting.

**Deployment is separate:** commit or push approval never authorizes deployment. Never deploy or modify Firebase, Azure, Entra, client accounts or other cloud resources without explicit task authorization. A push that would trigger deployment needs that separate approval or a separately approved plan to avoid it; do not silently disable workflows. Local builds are not deployments. Production/client changes and their data, identity and operational approvals remain separate from personal development UAT.

## Client neutrality and naming

Reqro is a client-neutral resident-engagement and staff-work platform. Organization is the tenant boundary. Development must not require City/client accounts, private networks, credentials or non-public data. Use local, synthetic, public test or explicitly approved personally controlled resources. Personal Entra use requires the established opt-in and deliberate configuration; an opt-in does not independently prove resource ownership.

Keep vendor models, endpoints and credentials inside approved adapter/configuration boundaries. Never make VUEWorks, Cityworks, Cartegraph, MGO or another vendor's schema the core domain model. Do not invent vendor capabilities, City policy or live integrations. Avoid hard-coded municipality assumptions; client brand configuration must remain separate from platform semantics.

Use Reqro for current product discussion. CityVUE remains in historical records, the repository directory, package names, configuration keys and existing runtime branding. A repository-wide rename has not occurred. Do not rename those identifiers or deployment resources as incidental cleanup. See [context](../CITYVUE_CONTEXT.md) and the retained [client-neutrality decision](../decisions/ADR-003-client-neutral-platform-isolated-development.md).

## Authorization invariants

The server is authoritative. Authentication establishes identity, not access. Protected operations require validated workforce identity, trusted active staff/Organization context, explicit applicable permissions and current server/database scope. Browser-supplied Organization, audience, author, identity, membership or permission claims cannot establish authority. Staff intake may request an allowed classification, but subsequent access uses the **persisted** audience.

PUBLIC and INTERNAL staff access are distinct even in one workspace. All is the SQL-authorized union, not an Organization-wide download filtered in React. Scope, counts and pagination must exclude unauthorized rows before projection. A UUID, human reference, creator relationship, assignment or watcher relationship confers no request access. Operational Role/Team membership is separate from RBAC. Capability booleans guide UI presentation only; every endpoint reauthorizes. Existing explicit legacy routes retain their audience and permission contracts.

Requester contact and Internal Notes each require parent access plus their independent permissions. Notes creation additionally requires Notes read. Neither request update nor contact permission grants Notes, and Notes do not grant contact. Permission registration, migrations, sign-in, startup and provisioning-bundle edits must not silently grant access. A proposed exception requires separate approval and explicit tests. Consult [Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md), [audience authorization](../architecture/decisions/ADR-006-public-internal-staff-authorization.md), [contact](../architecture/decisions/ADR-005-requester-contact-privacy.md) and [Notes](../architecture/decisions/ADR-007-internal-notes.md).

## Privacy and information boundaries

Project only necessary fields. Structured requester contact stays out of ordinary request list/detail payloads. Service location is distinct operational information and can itself be sensitive; do not reinterpret it as requester contact. Staff submitter, requester, assignee and watcher are different concepts. Descriptions, answers, operational narratives and Notes can contain incidental PII; access controls do not imply automatic classification or redaction.

Keep protected bodies and unnecessary identity values out of URLs, document titles, normal logs, analytics and persistent browser storage. Notes and contact use protected dedicated responses with no-store behavior and in-memory UI state. Clear protected state/drafts when request or authentication context changes; ignore stale responses. Permission loss must clear denied content on the next authoritative operation. Do not claim instantaneous erasure of content already disclosed to an authorized browser. The existing MSAL token cache is a separate identity concern; do not repurpose it as content storage.

Resident-facing projections must not inherit staff fields. PUBLIC classification does not publish contact, assignment, watchers, Notes, staff actor or operational narratives. Do not describe an authenticated legacy staff API as an anonymous resident API. Test actual output rather than inventing a resident surface to demonstrate privacy. No token, authentication header, contact response, Note body or HAR export is needed in routine UAT reports.

Internal Notes are staff-only plain text, separate from operational Activity, requester contact and future resident communication. They are not automatically sent to AI, embeddings, analytics or notifications. New uses of protected content require explicit design. Do not invent legal classifications, retention periods or confidentiality guarantees.

## Persistence, concurrency and history

PostgreSQL is authoritative for canonical requests and staff state. Legacy browser storage is a prototype boundary, not canonical persistence. Enforce Organization integrity in queries and applicable composite foreign keys. Use parameterized queries, bounded projections and deterministic pagination with stable tie-breakers. Avoid N+1 reads and unbounded history loads; review indexes against actual query needs rather than adding speculative indexes.

Use transactions for multi-write invariants, with database constraints as defense in depth. Request workflow/routing/ownership commands use established revision checks and locking. A stale mutation fails safely; refresh authoritative state and require deliberate review instead of silently replaying a consequential command. Test concurrency and rollback, including required audit/history failure. Independent append-only child streams such as Notes must not create unnecessary parent revision conflicts: F041 leaves parent status, revision, updatedAt, ownership, contact and Activity unchanged.

Human references are persisted immutable identifiers distinct from UUID primary keys. F033 uses Organization-scoped configuration and atomic counters within creation, not runtime `MAX()+1`. Reads must not reconstruct historical references using today's policy or parse a fixed reference shape. Reference knowledge never authorizes access. See [F033](../features/F033-configurable-service-request-reference-numbers.md).

Version migrations using repository conventions. Test forward application, constraints, no-default-grant behavior and existing-data preservation in disposable schemas first. Test rollback/reapply where safe; meaningful retained data must not be silently destroyed. Never corrupt personal development data to inject failures. `reqro_dev` is distinct from `reqro_test`. Before an authorized development migration, verify actual host, port, database, role and profile without printing credentials; use the established CLI and report applied/pending status. Never assume a historical migration count is still current.

Operational Activity is append-only, staff-understandable creation/workflow/routing/assignment/watcher history with approved narrative and historical snapshots. Security audit records minimal trusted actor/action/resource/time/correlation metadata. Sensitive payloads do not belong in security audit. Contact views and F041 Notes do not become operational Activity, and audit is not resident-visible. Required audit failure prevents disclosure or rolls back the associated mutation. Keep [Activity](../architecture/decisions/ADR-003-operational-activity-history.md) and [ownership](../architecture/decisions/ADR-004-assignment-watchers.md) rules intact.

## UI and accessibility

Reuse F038 tokens and shared primitives, existing React routing, repository boundaries and Bootstrap/theme conventions. Issue is the primary visual identity; reference is secondary and opaque. Show service location only when meaningful and authorized. Keep brand colors separate from semantic status/Activity colors. PUBLIC/INTERNAL is classification, not severity. Icons supplement labels and color is never the only signal. Resident and staff surfaces share a design language, not necessarily a layout. Permanent rules should not freeze page-specific pixel arrangements.

Check semantic headings, labels, help/error associations, keyboard navigation, visible focus, dialog entry/cancel/restoration, announcements and reading order. Check responsive wrapping and control reachability, light/dark contrast and non-color meaning. Use the feature's specified viewport matrix; record actual observations and distinguish automated component checks from browser UAT. Do not claim WCAG certification from development checks. Preserve authoritative success responses and safe, understandable error states.

## Validation and authenticated UAT

Inspect current package scripts; do not invent commands. The standard behavior-changing feature baseline is relevant unit coverage plus backend unit, API E2E, PostgreSQL integration, shared and React suites, TypeScript, configured lint, formatting, backend/frontend production builds, `git diff --check` and secret/private-configuration review. Exercise affected prior-feature regressions. Add tests for new security boundaries, forged input, Organization/scope denial, projection privacy and failure atomicity. Zero unexplained PostgreSQL skips are acceptable; a missing test database is not a passed integration suite. Never weaken old assertions simply to pass new work.

Established commands live in [root](../../package.json) and [server](../../server/package.json) manifests. Load approved local configuration into the process without displaying it. The backend test suites compile TypeScript; PostgreSQL integration uses the separately configured disposable test database. Frontend lint currently has no script: report that fact instead of pretending it ran. Record exact commands/results, relevant warnings and limitations. Broaden/repeat checks only when required by the task or justified by changes/failures.

For documentation-only work, use available documentation validation, check changed Markdown links/formatting, run whitespace and secret checks, and verify no application/runtime files changed. Absence of a dedicated documentation-test command is not a failure. Do not rerun expensive application suites merely for prose changes.

Live staff UAT uses normal personal Entra authentication, explicit [F036 development provisioning](../features/F036-safe-development-staff-authorization-provisioning.md), personal `reqro_dev` and fictional data. No fallback principal, token copying or auth bypass may substitute for it. A preview or mocked verifier is automated/test evidence, not authenticated live evidence. When browser control cannot meet its safety requirements, coordinate manual UAT; never work around the restriction.

Before a new grant, prove the ungranted baseline when required. Dry-run and review each explicit grant/revocation; bundles are provisioning shorthand, not runtime authority. Test relevant negative, read-only, positive and revocation states incrementally, restoring the deliberate final set. Record safe fictional references, counts and parent-state comparisons without reproducing protected content. Preserve existing fixtures and create no unnecessary permanent data. Remove temporary harnesses/logs before commit unless explicitly retained; use ignored local scratch locations rather than tracked source for private artifacts.

Restart troubleshooting lesson: if Vite/API restarts occur, public endpoints work, and authenticated staff requests do not reach the API, re-establish the normal Entra session by signing out and signing back in before assuming backend/database failure. Check safe request status and session behavior; never request tokens or disable validation. This is a conditional recovery step, not a claim that every restart failure has that cause or that DB grant changes require re-login.

## Feature execution and completion

1. Verify the accepted checkpoint and authorized scope.
2. Read protocol, architecture, roadmap and relevant ADRs/features.
3. Inspect actual implementation, schema, scripts and regression tests.
4. Write/update the feature specification; resolve consequential design conflicts.
5. Implement the smallest safe vertical slice without unrelated changes.
6. Run automated validation and fix findings.
7. Apply a required development migration only after disposable validation and target verification.
8. Explicitly provision development permissions if required; observe pre-grant baselines first.
9. Complete authenticated UAT and record actual final fictional/grant state.
10. Review security, privacy, concurrency and affected regressions.
11. Update documentation and remove temporary artifacts; complete any required final checks.
12. Review staged scope/private values and commit only after the task's gates pass.
13. Report the commit, status, validation, limitations and stop point; stop for review unless further action is explicitly authorized. Push and deployment remain independently controlled.

Documentation and test evidence should increasingly carry established invariants. Future prompts **should not restate all prior feature requirements**. Reference the protocol, architecture, relevant ADRs/features and regression tests, and describe only new or exceptional requirements. Do not automatically choose or begin the next numbered feature.

## Future feature prompt template

```text
REQRO FEATURE IMPLEMENTATION
Starting checkpoint: <branch, exact HEAD, expected working tree/ahead state>
Feature: F0XX — <name>
Follow:
- docs/development/REQRO_CODEX_PROTOCOL.md
- docs/ARCHITECTURE.md
- docs/ROADMAP.md
- <relevant ADR paths and prior feature specifications>
Objective: <new outcome>
Feature-specific requirements: <what is new, what changes, exceptions>
Feature-specific security/privacy: <new boundaries and what must not change>
Required tests: <new tests and relevant regression coverage>
UAT: <approved resources, fixtures, incremental grant sequence, final state>
Documentation: <feature record and decisions to add/update>
Commit: <message and completion gates>
Push: <authorized branch/commits, or NOT AUTHORIZED>
Deploy: <separate explicit authorization, or NOT AUTHORIZED>
Stop point: <reviewable outcome; no automatic next feature>
```

# CityVUE Security Framework

**Status: Architectural requirement — official repository security standard.** This document establishes development and review governance; it does not certify compliance, grant City production approval, or authorize deployment.

CityVUE follows a NIST Cybersecurity Framework 2.0-aligned Zero Trust security architecture, applying NIST SP 800-207 principles and OWASP application and API security guidance, with Microsoft Entra ID serving as the enterprise identity provider for authenticated City staff.

This statement defines the approved architectural direction. Entra is the intended workforce identity provider. Local authentication work was observed during review, but is outside this committed baseline; live delegated-token UAT and production activation remain pending.

## Purpose and scope

Apply this standard to React and future clients, the CityVUE API, PostgreSQL, integrations, configuration, build artifacts, and operations. Preserve the vendor-neutral architecture in [ARCHITECTURE](../ARCHITECTURE.md) and [F008](../features/F008-production-backend-persistence-security-architecture.md).

Status labels throughout this document mean:

- **Implemented:** verified in committed repository code for this baseline; does not mean deployed, independently assessed, or production-ready.
- **Architectural requirement:** required target behavior for implementation and review; not a claim of completion.
- **Planned/future:** implementation, operational decisions, or validation still outstanding.

Unless explicitly labeled otherwise, requirements below are **Architectural requirements**. Current City-approved decisions remain authoritative. Conflicts require an explicit decision; roadmap entries and this framework do not invent City policies, identities, permissions, retention periods, or vendor capabilities.

## Current evidence and limitations

**Implemented — committed baseline reviewed September 8, 2026.** The table below describes controls present in the committed baseline. Separately, local uncommitted workforce authentication and RBAC work was observed; it is not part of this security-governance commit and is not evidence of production readiness.

| Control                                                         | Repository evidence                                                                                                                                                                                                                                                      | Qualification                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Helmet headers, explicit CORS allowlist, global DTO validation  | [bootstrap.ts](../../server/src/bootstrap.ts), [environment.ts](../../server/src/config/environment.ts)                                                                                                                                                                  | Wildcard origins rejected; unknown DTO properties rejected. CORS is not authorization.                                                                                                                                                                                                   |
| Configurable global rate limiting and Joi startup validation    | [app.module.ts](../../server/src/app.module.ts), environment.ts above                                                                                                                                                                                                    | Baseline throttling is in memory; distributed and endpoint-specific abuse controls remain future work.                                                                                                                                                                                   |
| Safe unexpected-error responses                                 | [exception filter](../../server/src/common/errors/http-exception.filter.ts)                                                                                                                                                                                              | Unexpected errors return generic status/error/request ID; selected location errors have allowlisted codes/messages. This is not proof that every possible exception string is sanitized.                                                                                                 |
| Allowlisted Pino logs and correlation IDs | [logger](../../server/src/common/logging/pino-logger.service.ts), [request middleware](../../server/src/common/logging/request-logging.middleware.ts)                                                                                                                    | Fresh server-owned UUIDs replace all inbound IDs. Shared allowlists cover messages, contexts, HTTP metadata, error classifications, and child bindings; see limitations below.                                                                                                       |
| Database transport safeguard and API persistence boundary       | [environment.ts](../../server/src/config/environment.ts), [database service](../../server/src/database/database.service.ts)                                                                                                                                              | API and migrations share a policy requiring production verify-full, rejecting URL TLS/host overrides and unverified require mode. Effective pg configuration is tested. Production certificate/hostname handshake validation remains pending.                                                                                                      |
| Non-root production container definition                        | [Dockerfile](../../server/Dockerfile)                                                                                                                                                                                                                                    | Runtime uses `USER node` and production dependencies; deployment hardening remains separate.                                                                                                                                                                                             |
| Legacy stored-XSS and storage-failure hardening                 | [issue rendering](../../assets/pages/issues.js), [dashboard rendering](../../assets/pages/dashboard.js), [IssueService](../../assets/services/IssueService.js)                                                                                                           | Text-based rendering and guarded storage access reduce specific MVP risks; browser-local records have no staff authorization boundary.                                                                                                                                                   |

**Planned/future:** Production API/Entra activation, enterprise adapters, managed secret retrieval, centralized telemetry/alerting, and a complete security audit subsystem are not established by this evidence. Existing request Activity is business history, not a complete security audit service. The production MVP remains React/Firebase Hosting with legacy browser-local persistence according to current project documentation; deployed infrastructure was not inspected here.

Older Phase A statements in [server README](../../server/README.md), context, architecture, and roadmap still say authentication/domain work has not begun. Treat those as historical phase descriptions where superseded by separately reviewed and committed implementations. This framework records that discrepancy without broadly rewriting those documents.

## Security principles

- Apply least privilege, deny-by-default protected access, and defense in depth.
- Treat client input, external responses, and persisted user content as untrusted.
- Authenticate and authorize protected operations server-side, then enforce domain rules before side effects.
- Minimize data collection, disclosure, privileges, and exposed attack surface.
- Preserve Organization isolation and explicit public/staff visibility at every layer.
- Fail closed when identity, permission, or required validation cannot be established; provide safe errors and observable failures.

## NIST CSF 2.0 alignment

The six functions in [NIST CSF 2.0](https://www.nist.gov/cyberframework) organize CityVUE's security work. The mapping below is CityVUE guidance, not a completed CSF assessment or exhaustive control mapping.

| Function | CityVUE architectural requirement                                                                                |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| Govern   | Record security decisions, accountable owners, review gates, supplier risk, and explicitly justified exceptions. |
| Identify | Inventory services, data, dependencies, identities, integrations, trust boundaries, and threats.                 |
| Protect  | Enforce identity, least privilege, validation, secrets protection, transport security, and isolation.            |
| Detect   | Collect sanitized correlated telemetry and define actionable security alerts.                                    |
| Respond  | Establish incident triage, containment, credential revocation, evidence handling, and communication ownership.   |
| Recover  | Establish protected backups, tested restoration, recovery priorities, and lessons learned.                       |

**Planned/future:** City-approved operational owners, incident procedures, recovery objectives, retention, alert thresholds, and current/target CSF profiles require definition and validation before enterprise production use.

## Zero Trust / NIST SP 800-207

Apply [NIST SP 800-207](https://csrc.nist.gov/pubs/sp/800/207/final) principles: internal network location or City ownership alone grants no trust. Identity and authorization are distinct; access must be limited to the requested resource and action. Reevaluate effective permissions for protected requests rather than trusting stale browser state. Account lifecycle, device/risk signals, and session policies belong in an approved identity and operational design.

**Planned/future:** Entra Conditional Access/MFA and device policies need City administration and approval. This document neither configures them nor claims a complete Zero Trust deployment.

## Trust boundaries

```text
User (public/citizen or staff)
  -> React frontend (untrusted client; never a security boundary)
  -> CityVUE API
       -> authentication for protected operations
       -> authorization for resource, action, and Organization scope
       -> validation / business rules
       -> PostgreSQL and/or controlled integration router/adapters
       -> external City systems (each a separate trust domain)
```

This is the logical enforcement flow, not a prescribed middleware execution order. Explicitly public operations may be anonymous but still require server validation, abuse controls, and limited response data.

The browser must not hold privileged vendor credentials or access PostgreSQL directly. Hiding or disabling a UI control provides no authorization. The API independently enforces every protected operation. Treat database, identity provider, each downstream system, and each deployment environment as separate trust domains; a successful CityVUE login does not grant unrestricted downstream access. Integration adapters use only the minimum permissions necessary.

## Identity and authentication

**Factual serving-status amendment — 2026-10-09 (F060.4A-1).** The ADR-025
paragraph below retains its historical Slice 0 status. Registry resolution,
hostname normalization, peer-gated proxy trust, frozen request tenant context,
resident Organization propagation and guarded registry startup are now
implemented. The frontend defaults its API base to `/api/v1`; that does not
provision same-origin hosting. F060.4A-1 validates singular wire authority before
lookup: invalid authority yields generic 400 on resident tenant-dependent
routes, valid unresolvable hosts/untrusted peers retain 404, and registry
exceptions retain 503. Staff identity and credential-based tracking remain
independent of resident hostname. Express trust proxy stays disabled. Earlier
claims below that no resolver exists or registry serving is unavailable must
not be read as current. Production edge/TLS/cache/origin evidence and operational
approvals remain outstanding. See the [ADR-025 dated amendment](../architecture/decisions/ADR-025-trusted-production-organization-resolution.md)
and [F060.4A-1 validation record](../features/F060-4A-1-http-authority-hardening.md).
Duplicate wire authority is now rejected. This slice hardens HTTP authority
selection; it does not implement edge, TLS, CDN or routing. Remaining production
blockers belong to later F060.4A slices.

Use Microsoft Entra ID for authenticated City staff, following F008: separate SPA and API registrations, public-client authorization code with PKCE, and no SPA secret. Protected APIs must validate signed access tokens, trusted issuer, intended audience, tenant, lifetime, required claims, and delegated scope. An ID token or browser assertion is not API authorization.

**Anonymous Organization resolution (ADR-025, Accepted).** Anonymous resident surfaces do not derive Organization from identity. They currently use one server-configured Organization, which is **not** a production multi-tenant boundary. `TENANT_RESOLUTION_STRATEGY` makes that explicit and fail-closed: the `development` strategy requires an explicit `DEVELOPMENT_ORGANIZATION_ID`, no longer falls back to a repository fixture UUID, and is rejected in production and in any client profile; the `registry` strategy is accepted configuration state but has no resolver, so the API refuses to serve under it. The intended production design resolves a normalized hostname against a verified tenant-domain registry, treating the hostname as a lookup key rather than an authentication credential, with default-deny forwarded-host trust and fail-closed behavior for unknown, inactive, unverified or ambiguous hosts. **Planned/future:** the registry, hostname normalizer, trusted-proxy policy, request tenant context, staff/hostname consistency and tenant-aware cache keys and CORS origins are not implemented. Browser query parameters, bodies, custom Organization headers and browser storage are never Organization authority.

Resolve workforce identity through immutable tenant/object identity and active, approved StaffIdentity provisioning. Never invent tenant/client IDs, scopes, redirect URIs, role grants, or consent. Do not request broad directory access merely to sign in. Token handling, logout, provisioning/deprovisioning, and session policy require review and testing; local MSAL storage is not evidence of protection against XSS.

**Locally observed, outside this committed baseline:** Workforce identity and permission code exists in the development working tree. **Planned/future:** Live delegated-token UAT, administrator consent, operational lifecycle validation, and production activation remain incomplete.

**Reconciliation (F057.4):** the preceding paragraph describes the September 8, 2026 baseline. Workforce identity resolution and RBAC evaluation are now committed repository code, and delegated-token UAT has been performed against a personal development tenant. Administrator consent, operational lifecycle validation and production activation remain **Planned/future**; no production or client identity resource is configured or approved by this framework.

## Authorization and least privilege

RBAC with scoped permissions is the target model: Entra establishes workforce identity/coarse admission; CityVUE determines effective application permissions. Check resource ownership, Organization, applicable Department/Division membership, action, and field visibility server-side. Apply scope to lists, counts, details, exports, and mutations. Assignment, a guessed reference, or a client-selected Category does not grant access.

Public, Citizen, Staff, Supervisor, Administrator, and Integration Service are **conceptual access personas**, not an approved role/grant matrix. Locally observed development permissions do not establish final City-wide grants. Administrative and service identities also require constrained permissions; no implicit cross-Organization administration is authorized.

### Implemented — administrative access and permissions (F057)

Committed repository code implements Organization-scoped, fail-closed administration of staff permissions at `/admin/access`, served by `/api/v1/admin/access`. This is verified repository behavior; it is not deployment, production approval, or an independent assessment.

- **Separate read and manage authority.** [`admin.access.read` and `admin.access.manage`](../../server/src/auth/auth.types.ts) are registered with zero default grants and classified provisioning-only in [access-policy](../../server/src/access/access-policy.ts), so neither can be granted through the runtime administrative API. Reading additionally requires `admin.configuration.read`; managing requires all three.
- **No implicit administrator.** Bootstrap is explicit and starts false. Sign-in, startup, migration, permission registration, and existing Admin permissions promote no principal. The controlled operator command is restricted to a development profile and an approved local database; **production bootstrap and recovery remain Planned/future and require separate security approval.**
- **Deny by default.** For protected staff and administrative surfaces, the Organization is resolved only from authenticated staff context and never accepted from a request. The development fallback principal is rejected. Unknown and cross-Organization targets return the same safe not-found response. This statement scopes those surfaces; anonymous resident surfaces resolve Organization separately and are governed by [ADR-025](../architecture/decisions/ADR-025-trusted-production-organization-resolution.md).
- **Least privilege preserved.** Self-edit is prohibited in application code and by database constraint. Runtime commands cannot change a target's effective Access Administrator status in either direction, including indirectly through `admin.configuration.read`, and cannot grant access, geospatial, or AI authority.
- **Reevaluated, not cached.** Effective permissions are recomputed from the database on every request; access tokens carry no permission claims. A revocation takes effect on the next request.
- **Governed concurrency.** One command occupies one transaction with Organization-first locking, an expected-revision check taken after the lock, in-transaction actor re-resolution, and no automatic retry or idempotency key for consequential access mutations.
- **Externally and provisioning-owned access is read-only** to Access & Permissions, as is Department and Division membership.

The accepted architecture for production bootstrap and recovery is recorded in [ADR-027](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md): no bootstrap token, authority derived from existing infrastructure/deployment authority through a production-mode operator CLI, platform operator kept separate from Organization-bound tenant staff, control-plane authority that does not grant tenant data-plane access, recovery bounded to re-binding a trusted identity to already-authorized authority, and no local authentication fallback. **Acceptance of that architecture authorizes no implementation**; the controlled provisioning command remains restricted to a development profile and an approved local database, and ADR-023's statement that emergency break-glass is not implemented remains factually true.

**Least-privilege operator database role (ADR-027, F060.3C-2c-3) — production operator database boundary complete, not provisioned.** The tenant-domain operator path's database privileges have been derived empirically against the pinned **PostgreSQL 17** major version, with a disposable cluster carrying three genuinely separate identities (provisioning superuser, non-superuser schema owner, and a constrained role that owns nothing, holds no role membership, and has no `CREATE` on the schema or the database). The measured surface is four control-plane tables and nothing else: `SELECT, INSERT, UPDATE` on `tenant_domain`, `SELECT, INSERT` on `tenant_domain_audit` and `tenant_domain_operator_approval`, `INSERT` on `tenant_domain_verification_attempt`, no `DELETE` or `TRUNCATE` anywhere, zero privilege of any kind on `organization`, no sequence privilege, and exactly one function — the Migration 48 `SECURITY DEFINER` Organization lock helper. The one column-level exception is `tenant_domain_operator_approval.policy_version`, authorized on review solely because `SELECT ... FOR SHARE` on an approval row requires `UPDATE` on at least one column; it is proven to confer no mutation authority, since every `UPDATE` — including the no-op `policy_version = policy_version` — is refused by the approval table's immutability trigger, `check(policy_version = 1)` admits no other value, and the role can neither disable that trigger nor replace the guard function. Firing a trigger does **not** check `EXECUTE` on the trigger function, proven by revoking `EXECUTE` from `PUBLIC` on all seven control-plane trigger functions and re-running every verb, so the trigger functions are deliberately absent from the grant set; creating a trigger has different requirements and the operator never creates one. Also proven against the real role: it cannot widen its own authority (a self-issued `GRANT` is a PostgreSQL warning, not a grant), cannot `set session_replication_role` to disable the guards, cannot `set role` to the schema owner, cannot read `pg_authid`, install an extension, read a server file or `COPY ... FROM PROGRAM`, and cannot redirect the application's unqualified helper call even with `pg_temp` listed first in `search_path` and a same-signature decoy planted there, because PostgreSQL never consults `pg_temp` for function names. Object resolution no longer depends on a value the operator can edit: the operator CLI pins the application schema on the connection at startup from the infrastructure-owned `REQRO_DEPLOYMENT_SCHEMA` (strict identifier validation, reserved namespaces refused, defaults to `public`, no `--schema` flag and no operator-supplied override), and a pinned connection is proven to override a hostile role-level `search_path` default while an unpinned one fails. **Implemented** is the proof, the schema pin, and the reviewed grant artifact at [`deploy/database/operator-role.sql`](../../deploy/database/operator-role.sql) — which carries its own fail-closed assertions that refuse to leave a widened posture behind, and which is proven by being applied with `psql` inside the container rather than imitated. That artifact is reviewed configuration, not a provisioning action: **no database role or grant exists in any deployment**, IaC owns role creation and credentials, and no password appears in it. Runtime/migration role separation does not exist in the repository at all — `server/compose.yml` still defines a single superuser that owns its own database — and remains the independent production blocker **F060.3C-2d**. This status is explicitly not "overall Reqro database least privilege complete". **Production deployment remains unauthorized.**

**Runtime reference locks and owner-controlled database primitives (ADR-027, F060.3C-2d) — primitives hardened, roles not yet separated.** PostgreSQL requires `UPDATE` privilege on at least one column of a row-locked table, so the runtime application's `SELECT ... FOR SHARE` on reference tables it never writes would otherwise have forced write authority over catalog routing and staff metadata. **A runtime row-lock requirement must not be satisfied by granting broad mutation privilege.** Migration 49 therefore moves those locks into seven narrowly scoped `SECURITY DEFINER` helpers covering `department`, `division`, `staff_identity`, `operational_role`, `work_group` and the atomic Category+Department case — each returning only a boolean, `VOLATILE`, owned by the schema owner, pinning `search_path = pg_catalog, pg_temp`, fully schema-qualified, free of dynamic SQL, and with `PUBLIC` `EXECUTE` revoked. **`SECURITY DEFINER` is used only where PostgreSQL row-lock privilege would otherwise force inappropriate `UPDATE` authority**, never for convenience; business values stay with the caller's ordinary `SELECT`, which observes the pinned row because row locks are transaction scoped. **Category is the single accepted exception:** thirteen of its sixteen lock sites lock the Category row atomically alongside the Service Request and the Organization in one statement, and preserving that atomicity in the hottest request paths was preferred over eliminating one privilege, so the intended future runtime grant there is `UPDATE (id)` **only** — made inert because `protect_category_identity` renders Category identity immutable in the database, and every other Category update remains unauthorized. That is the **sole** accepted lock-only column privilege in the runtime design. The authorization-revision maintenance functions (`advance_access_revision`, `invalidate_access_revision`) are now **owner-controlled database primitives**: both `SECURITY DEFINER`, with no runtime `EXECUTE` and no runtime `UPDATE` on `authorization_revision`, `mutation_txid` or `updated_at`, leaving `UPDATE (bootstrap_established)` as the only intended direct runtime mutation of access state. Three redundant locks were removed where a foreign key, a unique partial index or an unconditional immutability trigger already carried the invariant. **Implemented** is the migration, the call-site conversion and the PG17 proof; **no database role, grant or provisioning exists**, and owner/migration/runtime role separation remains outstanding work under **F060.3C-2d**. Rolling Migration 49 back is coupled to withdrawing the runtime grants it makes safe, in one operational change. This status is **runtime reference-lock database primitives hardened**, not "Reqro application database least-privilege foundation complete". **Production deployment remains unauthorized.**

**Database role separation (ADR-027, F060.3C-2d) — Reqro application database least-privilege foundation complete, not deployed.** The reproducible environment previously collapsed the database owner, the migration role and the runtime application role into a single superuser, so every least-privilege control built above it rested on a credential that could do anything. Four separate identities now exist, all `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`: `reqro_owner` is **NOLOGIN** and owns the database, schema and every application object; `reqro_migrate` is a member of the owner and holds no authority until it explicitly `SET ROLE`s, which is why `NOINHERIT` is load bearing — measured on PostgreSQL 17, a migration path that forgets to assume the owner is denied rather than creating objects owned by the login; `reqro_runtime` owns nothing and holds only the canonical DML matrix plus eleven function grants; and `reqro_operator` is unchanged from F060.3C-2c-3. **Credentials are separate and not interchangeable:** `DATABASE_URL` is runtime-only, `MIGRATION_DATABASE_URL` is migration-only and has **no production fallback**, the runtime is structurally unable to read it (asserted over the built runtime module graph, which is why the two resolvers live in separate modules), and runtime code performs no `SET ROLE`. Migrations assume the owner on a single-connection pool and then **prove** it: `current_user` must be the owner, `session_user` must still be the migration login, and the two must differ — so ownership is uniform across deployments and the audit trail survives the assumption. The deployment-owned `REQRO_DEPLOYMENT_SCHEMA` is pinned on the runtime, migration and operator connections, each stripping a `search_path`-bearing `options` parameter first, because a connection-string `options` value overrides an application-level pin. Provisioning is infrastructure SQL, not application migrations: [`bootstrap-roles.sql`](../../deploy/database/bootstrap-roles.sql) creates the roles and **sets no password**, and [`runtime-role.sql`](../../deploy/database/runtime-role.sql) grants the exact surface — no `GRANT ALL`, no `ON ALL TABLES`, no `REVOKE ALL ON DATABASE`, and deliberately **no default privileges**, so a future table is unreachable by both constrained roles until granted. Both artifacts carry fail-closed assertions that refuse a widened posture. `PUBLIC` keeps `CONNECT` and loses `TEMPORARY` and schema `CREATE`; `EXECUTE` is not revoked globally, because every function outside the eleven `SECURITY DEFINER` ones is `SECURITY INVOKER` and so confers no authority beyond the caller. Two column-scoped grants are the only lock-driven privileges: `UPDATE (id)` on Category, inert behind Migration 49's identity trigger, and `UPDATE (bootstrap_established)` on access state, with the database-maintained revision columns absent and the hardened trigger chain proven to still advance them. **Implemented** is the topology, the credential split, the provisioning artifacts and a PostgreSQL 17 five-identity proof; **no role, grant or database exists in any deployment**. **Production deployment remains unauthorized** — the outstanding blockers are infrastructure, not database: per-human IAM with JIT elevation, a production job runner, secret-manager integration, immutable off-host audit retention, real production provisioning, and domain, DNS, TLS and edge configuration.

**Planned/future for this area:** production bootstrap and recovery, endpoint-specific abuse controls for access mutation, Organization-wide audit retrieval, access-read auditing, and staff lifecycle/deprovisioning administration. See the [F057.4 refresh](../features/F057-4-access-administration-architecture-refresh.md) for the recorded gaps; none of that future work is approved for implementation.

## Public/citizen versus staff access

Public catalog and resident creation routes are anonymous in the local implementation. Contact information supplied on intake is not proof of identity. Citizen authentication, ownership verification, and tracking remain **Planned/future**, separate from workforce Entra. A reference number is not a bearer credential.

Keep public responses minimal and separate from staff details, internal notes, assignments, and personal data. Legacy `/issues` and Dashboard browser-local behavior must not be mistaken for secured production staff access. Development read/action gates and synthetic actors are test conveniences, not authentication; preserve production rejection of these gates.

## Backend/API security requirements

Maintain security headers, explicit environment-specific CORS, constrained methods/content types, bounded payloads/pagination/timeouts, and appropriate rate limits. CORS controls browser response access; direct HTTP clients still require authorization. Preserve safe defaults and fail startup on invalid security configuration.

Review every new endpoint's public/protected classification and enforcement. Protect sensitive diagnostic surfaces; approve production OpenAPI exposure, ingress/proxy trust, and abuse controls explicitly. **Planned/future:** Distributed throttling and endpoint-specific policies require design before scale or exposure warrants them; the existing baseline is not a complete denial-of-service defense.

## Input validation and business-rule enforcement

Validate types, sizes, formats, allowed properties, identifiers, relationships, and published service-version rules on the API. Client validation supports usability only. Reject unauthorized properties and mass assignment. Use parameterized database queries and allowlisted query/sort choices.

Enforce Organization ownership, workflow transitions, assignment eligibility, concurrency, and required geographic eligibility in application/domain services and transactional persistence. Do not accept client-selected actors, authoritative Organization context, or arbitrary status changes. External data must pass validation too; retries must not duplicate consequential effects.

## OWASP application security

Use [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) to select verifiable application requirements and [OWASP API Security guidance](https://owasp.org/www-project-api-security/) to review object/property/function authorization, resource consumption, configuration, SSRF, and unsafe downstream consumption. Record the version and relevant requirements in feature reviews; no ASVS level or certification is claimed here.

Render untrusted content as text or use an explicitly reviewed sanitization policy; avoid unsafe HTML insertion. Review token/session handling, injection, browser storage, output encoding, and sensitive caching. Evaluate CSRF protection if cookie-based credentials are introduced. Future uploads need authorized access, type/size limits, safe metadata, and scanning design before enablement.

## Secrets and configuration management

Production passwords, client secrets, private keys, bearer tokens, database credentials, and privileged vendor credentials must never be committed to Git or embedded in frontend JavaScript. Frontend/Vite environment values are client-visible; `VITE_*` is not secret storage. Public identifiers may be configured there only when appropriate.

Use ignored local secret files or approved developer tooling, placeholders in examples, and approved server-side secret management. Keep secrets out of images, build output, URLs, logs, and documentation. Scope credentials by environment, Organization, and integration; define rotation/revocation and compromise response. **Planned/future:** Key Vault/managed identity is the F008 direction, not an implemented secret retrieval service.

## Data protection

Collect and return only needed information. Protect requester/contact data, precise location, answers, attachments, and internal Activity through explicit visibility rules. Avoid production personal data in development/test without authorization and protection. Browser-local persistence is a prototype limitation, not an enterprise confidential-data store.

Require approved encryption at rest, access restrictions, backup protection, retention/deletion, export controls, and separation of Development, Test/QA, and Production. **Planned/future:** City classification, records policy, key management, and retention/recovery settings must be approved; no periods or legal obligations are invented here.

## Logging, monitoring, correlation IDs, and audit events

Never log passwords, bearer tokens, session/authentication cookies, private keys, client secrets, or unnecessary sensitive personal information. Use minimal structured fields and safe error classifications; do not rely solely on field-name redaction. Review URLs/query strings, headers, free-form messages, and error objects for leakage and log injection.

Retain validated/generated correlation IDs across approved backend calls where supported. Correlation is diagnostic context, never identity or authorization. Restrict telemetry access and apply approved retention and Organization scope.

**Implemented in this logging slice:** The [shared logging policy](../../server/src/common/logging/log-sanitization.ts) allowlists operational fields and static messages for direct Pino calls, Nest wrappers, and child bindings. HTTP completion/error logs use registered route templates (or `unmatched`), server-generated request IDs, methods, status, duration, and recognized error names/codes. Only known content types are retained from headers, without parameters. Raw URLs/query strings, path values, other headers, bodies, nested payloads, remote addresses, and error messages/stacks/causes are omitted. Database readiness/pool errors and migration, seed, and API startup failure reporting use safe classifications; configuration failures retain a fixed label without values.

Unknown messages become `Application event`; unknown error names/codes become `UnknownError`/`unknown`. New messages, fields, and codes require allowlist review. HTTP correlation IDs are fresh server-owned UUID v4 values, returned in the response header; inbound values are never echoed or logged, even if UUID-shaped. Custom context IDs must also use UUID v4. Route templates come only from private provenance attached at the HTTP boundary after framework route resolution, never arbitrary `route` fields or child bindings. Service identity is fixed to `cityvue-api`; version is restricted to numeric major.minor.patch with one to three digits per part and environment to development/test/production, with `unknown` replacing invalid values. Components use a fixed allowlist. The HTTP context builder is an internal trusted API and must only receive real framework requests. The policy does not sanitize independent console output, third-party logging, proxy logs, or future exporters. Removing raw stacks/messages limits diagnostics; central security monitoring, retention enforcement, alerting, and full audit logging remain future work.

**Planned/future:** Security audit events should cover sign-in/admission failures, access denials, provisioning and role changes, privileged configuration, sensitive exports, and integration credential or operational changes. Record a safe actor identifier, Organization, timestamp, action, resource, outcome, and correlation context as appropriate, without secret payloads. Define access, integrity, retention, alerting, and incident ownership separately. Existing business Activity and Pino logs do not constitute this subsystem.

**Implemented for access changes (F057):** the permission-change portion of the above is committed. Every governed access mutation writes an immutable change set and permission deltas recording actor, target, Organization, constrained operation, source, server-generated correlation UUID, transaction identity, before/after authorization revisions, and timestamp. Database triggers reject UPDATE, DELETE, and TRUNCATE on the audit and ownership tables, require matching same-transaction delta evidence before any owned permission or assignment write, and verify completeness through deferred constraint triggers at COMMIT, so a mutation and its audit cannot partially commit. No secret payload, provider identifier, token, or requester content is stored. This stream is deliberately distinct from operational request Activity.

This covers permission changes only. Sign-in and admission failures, access denials, privileged configuration, sensitive exports, integration credential changes, access-read auditing, retention, alerting, and incident ownership remain **Planned/future**, and a privileged database owner able to alter schema or disable triggers is outside the guarantees this audit provides.

## Secure error handling

Return stable, minimal errors and correlation IDs. Never disclose stacks, SQL, credentials, internal/vendor endpoints, or unnecessary identity/data details. Review both expected and unexpected errors and preserve safe not-found behavior for inaccessible records where applicable. Log only sanitized diagnostic context; a sanitized HTTP response does not imply its server log is safe.

## TLS / transport security

Require HTTPS for production client/API and integration traffic, and certificate-validated TLS for production database connections. Configure trusted certificates, termination, proxy handling, and renewal through approved deployment design. Do not disable certificate validation globally or trust forwarded headers indiscriminately.

**Implemented:** The [shared database TLS policy](../../server/src/config/database-tls.ts) now requires `verify-full` in production for both API and migrations, with `rejectUnauthorized: true` and default hostname verification. It rejects all URL SSL/TLS parameters, `uselibpqcompat`, and host overrides before pg parsing, closing the previously discovered configuration-precedence gap. Earlier wording described only the mode variable and overstated effective protection. Unverified `require` is rejected everywhere; explicit `disable` remains development/test-only. Optional server-only `DATABASE_SSL_CA_FILE` supplies a validated PEM CA bundle; otherwise Node default trust applies. See [server operator guidance](../../server/README.md#database-tls-and-ca-trust). Production certificate-chain/hostname handshakes and deployment trust remain to be validated. These checks do not implement HTTPS ingress.

## Database security expectations

Access PostgreSQL through backend repositories and approved operational tooling, never React. Use least-privileged runtime access, separately controlled migration/admin privileges, restricted network reachability, secure credentials, and reviewed migrations. Preserve transactions, constraints, and explicit Organization scoping. Database constraints complement API authorization.

**Planned/future:** Production role grants, networking, protected backup/restore tests, and operations need validation. PostgreSQL row-level security remains optional defense in depth subject to a separate decision, not an existing control or automatic requirement.

## External integration security

Reach VUEWorks, Trimble Cityworks, OpenGov Cartegraph, MGO, VistaShare, and future City systems only through controlled backend integration boundaries. Approve vendor API capabilities, endpoints, authentication, data ownership, and mappings before implementation. Never forward user tokens to a vendor by default or accept arbitrary client-supplied destinations.

Use least-privileged service credentials or approved workload identities, validated transport, destination restrictions, bounded timeouts/retries, and safe error handling. Validate downstream responses, design idempotency/recovery, and preserve authorization/audit for incoming changes. **Planned/future:** Enterprise router/adapters and live credentials are not implemented by this task.

## Vendor-neutral adapter security model

Keep `ServiceRequest`, `Location`, `Attachment`, `WorkItem`, and `RequestStatus` independent of vendor schemas. Adapters own vendor field transformations, authentication mechanics, endpoints, and explicitly supported capabilities. Organization-scoped routing and mapping configuration must not leak credentials or references across boundaries.

Do not force unsupported operations or invent status mappings. Adapter-originated workflow updates must pass approved CityVUE authorization and business rules; a downstream success is not permission to bypass canonical controls.

## Dependency and supply-chain security

Use the existing npm manifests and lockfiles for root/frontend and isolated server packages. Review dependency necessity, provenance, maintenance, install scripts, vulnerabilities, and transitive changes; prefer reproducible installs and focused upgrades. Review container bases and build/CI permissions, protect artifacts and secrets, and remediate findings according to approved risk decisions. No vulnerability-free or supply-chain-attestation claim is made by this document.

## Secure development and code-review expectations

Identify security-sensitive changes explicitly. Review affected trust boundaries, abuse cases, permission scope, secret/data handling, errors, and operational impact. Add/update meaningful tests when security behavior changes: unauthenticated/unauthorized access, wrong Organization/object/field scope, malformed input, forged/expired tokens, development-gate misuse, redaction, and dependency failure as applicable.

Run relevant existing tests, lint, type checks, and builds; report failures and skipped checks honestly. Review diffs for credentials and unintended scope. Any weakening of authentication, authorization, validation, CORS, TLS, throttling, logging sanitation, or error sanitation requires explicit justification and review. Record durable decisions in an ADR and significant feature requirements in a feature specification; unresolved security decisions must not be silently treated as approval.

## Security requirements for future features

Before implementation, document public/protected operations, data classification/visibility, identity and permission rules, Organization boundaries, abuse/failure behavior, audit needs, tests, and configuration. Before production activation, obtain applicable City decisions and validate the controls in the intended environment. Follow [F016 deployment readiness](../features/F016-production-hosting-deployment-readiness-plan.md); this standard is not deployment authorization.

## Explicit non-goals / items not yet implemented

This documentation task implements no Entra/OAuth/OIDC flows, RBAC code, gateway, middleware, database schema, credentials, integrations, or deployment changes. It does not include or activate the pre-existing local workforce identity foundation.

Citizen identity/tracking, final City role grants, enterprise adapters, managed secrets, full security audit/monitoring, incident/recovery procedures, production transport/isolation validation, and production identity UAT remain separately scoped work. Validate deployed database certificate trust and resolve the documented logging limitations during that work. No City-wide policy, certification, compliance assessment, or completed production security posture is asserted.

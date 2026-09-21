# ADR-001 — Organization isolation

**Status: Accepted** — consolidation of the implemented Organization boundary through F041.

## Context

Reqro serves client-neutral municipal domains. Separate deployments do not remove the need to prevent relationships or reads from crossing Organizations. Authentication alone cannot choose a tenant or authorize its records.

## Decision

Organization is the trusted tenant boundary. Protected staff APIs validate Entra identity, resolve an active pre-provisioned StaffIdentity and obtain Organization, permissions and memberships from the database. Browser headers, route/body/query fields, category selections and identity claims supplied outside verification are not Organization authority. Anonymous catalog/intake currently uses server-configured development context; this is not a production multi-tenant resolver.

Apply Organization predicates before projection, count and pagination. Request staff queries also require an active Organization and effective Department/Division scope: explicit request routing overrides catalog scope, including an explicitly null routed Division. Empty Department membership admits no requests; no Division membership admits only otherwise-authorized Department-level requests.

Use Organization-constrained relationships and composite foreign keys where implemented. Routing changes operational scope, never parent Organization ownership. Scope must constrain both current request and routing/ownership targets. Do not introduce cross-tenant administration or rely on PostgreSQL RLS that the application has not implemented.

## Consequences

Repositories and services carry trusted Organization context explicitly. Tests exercise other-Organization identifiers and scope substitution. Client-specific configuration and future adapters remain Organization-owned; the preferred isolated deployment model remains distinct from approval for a shared SaaS service.

## Security and privacy

Inaccessible records use safe denial/not-found contracts without revealing their existence. A permission, reference, assignment or operational membership cannot bypass Organization isolation. Composite integrity complements server authorization; neither replaces the other.

## Related evidence

[F030](../../features/F030-internal-service-request-access-policy.md), [F040](../../features/F040-public-service-request-staff-workspace.md), [client-neutral deployment ADR](../../decisions/ADR-003-client-neutral-platform-isolated-development.md), [staff authorization resolver](../../../server/src/auth/staff-authorization.service.ts), [request scope](../../../server/src/service-request/staff-request-scope.ts).

# F018 — Phase B Microsoft Entra Authentication and RBAC Foundation

**Status:** Local implementation; live delegated-token validation and production activation blocked on tenant administrator consent

## Identity architecture

CityVUE Web is a public-client React SPA using MSAL authorization code flow with PKCE, a tenant-specific authority, session-storage MSAL cache, and no client secret. CityVUE API is a distinct resource registration exposing `access_as_user`. Configuration uses `VITE_ENTRA_TENANT_ID`, `VITE_ENTRA_WEB_CLIENT_ID`, `VITE_ENTRA_API_SCOPE`, `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_EXPECTED_AUDIENCE`, and `ENTRA_REQUIRED_SCOPE`; identifiers are never hard-coded. Redirect and post-logout URIs derive from the current origin. Production remains legacy mode.

The API validates signature with cached tenant JWKS, exact v2 issuer, CityVUE audience, a required expiration claim and expiration/not-before, `tid`, `oid`, and delegated scope. It maps immutable `tid` + `oid` only to an active, pre-provisioned `StaffIdentity`; authentication never auto-provisions or equals authorization. Organization comes exclusively from that mapping. Raw tokens and full claims are neither persisted nor logged.

## Authorization

Organization-scoped roles map to fixed permissions: `service_request.view`, `assign`, `start_work`, `hold`, `resume`, `close`, and `reopen`. Active Department membership is required; Division-owned requests additionally require active explicit Division membership. No implicit citywide access exists. Lists apply scope in SQL; details/actions return safe not-found behavior outside scope. Assignment/workflow Activity records the canonical StaffIdentity actor.

Public catalog and resident request creation remain anonymous. Canonical list, details, assignment, and workflow endpoints use bearer auth when Entra is configured. Existing development read/action gates remain local fallbacks and remain production-forbidden. React `/` and `/report` remain public; staff routes display a sign-in-required state in local API/Entra mode. MSAL silently acquires the CityVUE API token; consent/interaction failures receive a concise administrator-approval message. Access tokens remain only in MSAL-managed cache and request memory.

`User.Read` and Microsoft Graph are unnecessary because CityVUE uses token claims; the registration permission can be reviewed for removal after validation. Enterprise Application “Assignment required?” should be considered after City approval. Conditional Access (MFA, device, network, risk, session policy) remains an Entra policy concern and requires no CityVUE bypass.

## Current blocker and modes

Tenant admin consent for `access_as_user` is **PENDING**. Live sign-in/token/API UAT cannot be claimed complete and production activation remains blocked. Supported modes are local legacy, local API development fallback, local API Entra, current production legacy, and a separately approved future production API/Entra deployment.


## Independent prerequisite validation (2026-09-13)

Validated the complete F018 tree over commit `241a65c`, excluding all F020 changes. Server-side bearer verification, pre-provisioned staff identity, delegated scope, organization/resource permissions, and explicit development gates enforce authorization independently of React. The review added a required `exp` claim and a signed-token regression for missing expiration, plus four guard tests covering anonymous/invalid credentials, missing scope/provisioning/permission, resolved identity, and disabled fallback behavior.

Results: 87 backend unit, 16 E2E, 5 PostgreSQL integration, 91 React, and 62 shared tests passed with zero failures or skips. TypeScript, lint, formatting, and API/React builds passed. The archive validation copy initially had CRLF line endings; normalization in that copy resolved formatting without source changes. Vite retains its large-chunk warning. PostgreSQL tests used an isolated local test database/schema, not a production connection.

The prerequisite consists of 46 files: authentication/RBAC modules and migration, protected service-request access and development seed integration, MSAL/authenticated API wiring, configuration and dependency manifests/locks, regression tests, and architecture/feature documentation. It does not include AI routes, permissions, configuration, or UI. Live Entra UAT remains pending administrator consent; these local results do not establish production readiness.

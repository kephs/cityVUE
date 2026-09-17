# F027 — Controlled development identity and geospatial grant validation

**Status:** Development provisioning and database-backed integration harness implemented. Live personal Entra and PostgreSQL UAT remain outstanding until independently controlled resources are configured. No City resource was accessed.

## Identity and authorization path

The existing F018 adapter validates an Entra delegated API token against the externally configured tenant, issuer, audience, expiry and scope. Its verified `tid` and `oid` resolve an active, pre-provisioned `StaffIdentity`; email, display name, browser roles and headers do not establish authority. That record owns one Organization, and its active Organization role assignments join to active roles and CityVUE permission keys in PostgreSQL. F026's `GET /api/v1/geospatial` requires `geospatial.read`; F025 checks the trusted scope again before the synthetic provider runs. Authentication or Organization membership alone grants no geospatial permission. The F026 catalog migration supplies the key without a default role grant.

Personal Entra is an optional, isolated development identity provider behind this boundary, not a platform dependency. The E2E database harness replaces **only** token signature verification with fictional principals; it exercises the real F018 guard, PostgreSQL `StaffAuthorizationService`, F025 policy and F026 route/provider. It is test-only and cannot become runtime authentication. A real signed-token test requires a personally controlled tenant and is not claimed here.

## Explicit local provisioning

Use a personally controlled development PostgreSQL database with migrations applied. The existing `seed:development` command creates fictional Organization A (`10000000-0000-4000-8000-000000000001`); the F026 provider has matching synthetic data. Do not use City or production resources. Keep local connection settings and personal tenant/application IDs in ignored `server/.env` or process environment; `.env*` files are ignored except placeholders in `.env.example`. No SPA client secret is needed. Use F018's `ENTRA_TENANT_ID`, `ENTRA_API_CLIENT_ID`, `ENTRA_EXPECTED_AUDIENCE`, `ENTRA_REQUIRED_SCOPE`, and SPA public-client settings from the existing examples. Set `CITYVUE_ENABLE_EXTERNAL_IDENTITY=true`, `CITYVUE_DEPLOYMENT_PROFILE=development`, `NODE_ENV=development` and a development `DATABASE_URL` in the process environment. The CLI does not load `.env` itself.

For each verified personal-tenant object ID, explicitly supply `F027_ENTRA_OBJECT_ID`, `F027_ORGANIZATION_ID`, and `F027_GRANT_GEOSPATIAL_READ=true` or `false`, then run `npm run provision:geospatial:development` from `server/`. These values are operator-supplied environment variables, never browser input. `false` creates membership without a grant for a new principal. `true` transactionally creates or reuses the Organization-local `geospatial-reader` role with only `geospatial.read` and assigns it to that identity. The command refuses production/client profiles, absent external identity opt-in, incomplete Entra configuration, inactive or missing Organizations, inactive or cross-Organization identities, missing catalog migration and roles containing unexpected permissions. Repeated runs are idempotent. Running `false` does **not** revoke an earlier grant; revoke an assignment through a separately reviewed administrative process. There is no automatic assignment or production seed. No personal identifiers appear in migrations.

Use a separately controlled `TEST_DATABASE_URL` for `npm run test:db`; tests create and drop isolated schemas. The suite never falls back to `DATABASE_URL`. The integration test applies prerequisite migrations and the F026 catalog migration, provisions fictional members in Organizations A and B, then verifies HTTP 401/403, membership, explicit grant, cross-Organization denial, immediate revocation, two isolated successful reads, and zero provider calls on every denial. The migration test checks repeat application, rollback and no default grant. The local connection must allow test schema creation/deletion. Do not point tests at City or production databases.

## Deployment boundary

| Development profile | Future client profile |
| --- | --- |
| Personally controlled Entra tenant | Client-approved identity provider/adapter |
| Same CityVUE verified-principal boundary | Same CityVUE verified-principal boundary |
| Fictional Organization, development PostgreSQL | Client Organization and approved database |
| CityVUE Organization roles and permissions | Same neutral CityVUE RBAC |
| F026 synthetic GIS provider | Separately approved GIS adapter |

Production requires a client profile and cannot run the development provisioning command or the F026 synthetic GIS provider. Missing identity configuration fails closed. No City Entra, ArcGIS, database, infrastructure, account or non-public data is required for independent development. External GIS integration and `/map-preview` API cutover remain deferred.

## Live UAT checklist (outstanding)

With a personal tenant, a separate development database, and a real delegated API token, verify: (1) an explicit grant reads only its Organization's fictional data, (2) an Organization member without a grant gets 403, (3) a valid identity without membership gets 403, (4) an A member requesting B gets 403, and (5) missing, invalid and expired tokens get 401. Capture only sanitized results and correlation IDs; never store or log tokens, connection strings, personal account details or claims. No live success is asserted until this is run.

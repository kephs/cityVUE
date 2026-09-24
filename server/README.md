# CityVUE API — Backend Workspace

This workspace began with the Phase A platform foundation and now contains Reqro's implemented backend through F041: canonical catalog/requests, Entra/database authorization, operations, protected contact and Internal Notes. CityVUE remains the existing technical identifier. Read the [current architecture](../docs/ARCHITECTURE.md) and [development protocol](../docs/development/REQRO_CODEX_PROTOCOL.md) before changes; historical phase-specific sections below describe their original scope.

## Prerequisites

- Node.js 22 LTS is recommended. Node 20.19+ through Node 24 is supported.
- npm
- PostgreSQL 17 for local readiness and migration testing; Docker Compose is the reproducible option.

## Setup

From `server/`:

```text
npm ci
copy .env.example .env
docker compose -f compose.yml up -d
npm run migration:status
npm run dev
```

The development values in `.env.example` and `compose.yml` are local-only placeholders. Never reuse them in shared or production environments. Actual `.env` files are ignored by Git.

From the repository root, `npm run server:dev` starts the backend and `npm run react:start` starts the frontend. The frontend connects only when API mode and the applicable identity configuration are explicitly supplied; the original Phase A alone did not connect them.

Backend development uses the existing TypeScript compiler in watch mode with `tsconfig.build.json`, then starts/restarts Node on `dist/main.js` only after a successful complete emit. This preserves Nest constructor decorator metadata, which `tsx` does not emit. Failed builds leave the last successfully started server running until the source is corrected. Ctrl+C closes the compiler watcher and server. Production `npm start` remains unchanged; `tsx` remains available for the existing database CLIs, which do not use Nest dependency injection.

`npm run dev -- --check` performs a bounded compile and full Nest initialization without listening or watching. It uses the normal configuration validation and must receive valid settings; the unit regression runs it with fictional environment values and isolated dotenv discovery. No real Entra login or database provisioning is performed by this check.

## Platform endpoints

- Readiness: `GET http://localhost:3000/api/v1/health`
- Liveness: `GET http://localhost:3000/api/v1/health/live`
- Explicit readiness: `GET http://localhost:3000/api/v1/health/ready`
- OpenAPI UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs-json`

OpenAPI describes implemented endpoints, including the later domain APIs. Restricting or disabling documentation in production remains a deployment/security decision.

## Commands

```text
npm run build
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run test:db
npm run migration:create -- lowercase-kebab-description
npm run migration:up
npm run migration:down
npm run migration:status
```

Set `TEST_DATABASE_URL` to an isolated disposable PostgreSQL database before `npm run test:db`. The connectivity test skips rather than contacting an unapproved database when it is absent.

Migration names use `YYYYMMDDHHMMSS-kebab-case-description.ts`. Phase A contains no migration files and creates no tables.

## Configuration

F022 deployment isolation uses `CITYVUE_DEPLOYMENT_PROFILE=development` by default. Production requires an explicit `client` profile. Client profiles reject the existing development staff/read gates and deterministic location provider, including in client test environments. To use a personally controlled Entra test tenant while running a development profile under `NODE_ENV=development`, set `CITYVUE_ENABLE_EXTERNAL_IDENTITY=true` along with the complete existing Entra settings. This opt-in does not verify tenant ownership; never configure client resources for independent development. See [F022](../docs/features/F022-client-neutral-architecture-development-isolation.md).

Local staff mutation exercises require both `ENABLE_DEVELOPMENT_STAFF_ACTIONS=true` and an active Organization-scoped `DEVELOPMENT_STAFF_ACTOR_ID` created by the development seed. This gate is not authorization and is rejected when `NODE_ENV=production`. Never enable these endpoints in a deployed environment; production staff access still requires Entra authentication and server-enforced RBAC.

Startup validation requires `DATABASE_URL` and validates `NODE_ENV`, `PORT`, `APP_NAME`, `APP_VERSION`, `LOG_LEVEL`, `DATABASE_SSL_MODE`, pool/timeouts, `CORS_ORIGINS`, baseline rate limits, and telemetry placeholders. The shared database TLS policy requires `DATABASE_SSL_MODE=verify-full` in production for both the API and migration CLI. `require` is rejected in every environment; `disable` remains available only in development/test for local Docker.

CORS uses an explicit comma-separated origin allowlist. `*` is rejected. Development defaults to `http://localhost:5173`; add `https://cityvue-1.web.app` explicitly in a future approved deployment environment.

## Database TLS and CA trust

API and migration connections use the same databaseConnectionOptions policy in src/config/database-tls.ts. DATABASE_URL must have a TCP hostname. URL parameters beginning with ssl or tls (case-insensitive), uselibpqcompat, host, and hostaddr are rejected in every environment, including apparently safe sslmode=verify-full parameters. Remove these options and configure TLS centrally; this prevents pg URL parsing from replacing the application policy. Other query options remain supported.

Without DATABASE_SSL_CA_FILE, verified TLS uses Node's default trusted CA set; OS trust depends on the Node runtime configuration. The actual production certificate chain has not been inspected. For an approved private CA, set DATABASE_SSL_CA_FILE to a readable PEM CA bundle mounted outside the repository and image. A relative path resolves from the process working directory; prefer an absolute path. An explicit bundle replaces Node's default CA list for that connection. Keep it server-side, never in VITE_* or Git. Unreadable, malformed, non-CA, or non-certificate material fails startup with a generic error. A CA file cannot be used with disable. Certificate and hostname verification remain enabled; never bypass verification globally.

Before production activation, validate the real database hostname, certificate chain, mounted CA permissions, and rotation procedure for both API and migration jobs. Current automated checks verify effective pg options without production connections; they do not establish successful production handshakes. No TLS server fixture is included in the existing local PostgreSQL Compose workflow.

## Database and migrations

Kysely with the `pg` pool is the persistence/migration foundation. It provides explicit SQL, typed query composition, transactions, reviewable migrations, and support for future version-column optimistic concurrency without forcing a domain schema now. Pool size and connection/statement timeouts are configurable. Connections are lazy, readiness is observable, and shutdown destroys the pool cleanly.

Start or stop local PostgreSQL with:

```text
docker compose -f compose.yml up -d
docker compose -f compose.yml down
```

The named volume preserves local development data. Use `docker compose -f compose.yml down -v` only when intentionally discarding that local volume.

## Logging, errors, and telemetry

Pino/pino-http emit allowlisted structured JSON with request ID, method, registered route template (or `unmatched`), response status, duration, and recognized error classifications/codes. Known content types are retained without parameters; other headers, raw URLs/query strings, bodies, remote addresses, nested payloads, error messages/stacks/causes, and unknown fields are omitted. Every HTTP request receives a fresh server-owned UUID v4 in logs and the response `x-correlation-id` header. Inbound IDs, including valid UUIDs, are never echoed or logged.

The shared `common/logging/log-sanitization.ts` policy accepts reviewed static messages and operational fields. Arbitrary string/object messages become `Application event`; unknown error names/codes become `UnknownError`/`unknown`. Direct calls, Nest wrappers, and child bindings pass through the policy before output. Migration, development seed, and API startup failures use the same safe error classification. Custom context IDs must be UUID v4. Route templates are carried by private HTTP-context provenance from the resolved framework request; arbitrary `route` fields, copies, and child bindings cannot assert a trusted template. Log service identity is fixed to `cityvue-api`; configured versions must be numeric `major.minor.patch` (one to three digits per part) and environments must be development/test/production, otherwise `unknown` is used. New events/codes need explicit allowlist review. This deliberately trades raw exception detail for safer diagnostics and does not sanitize third-party console output or activate centralized monitoring.

Unexpected errors return sanitized status/error/request-ID data. Helmet supplies API security headers. Global Nest validation whitelists DTO properties, transforms values, and rejects non-whitelisted input.

OpenTelemetry SDK/exporter activation is deliberately deferred until an approved telemetry environment exists. `OTEL_SERVICE_NAME`, an optional OTLP endpoint, correlation IDs, and structured logs preserve the integration boundary for Application Insights/Azure Monitor later.

## Containers and Azure boundary

The multi-stage Dockerfile builds on Node 22 Alpine and runs as the non-root `node` user with production dependencies only. It does not contain configuration or secrets.

The future deployment boundary remains: API and later worker in Azure Container Apps, PostgreSQL in Azure Database for PostgreSQL, secrets through Key Vault/managed identity, and telemetry through Application Insights/Azure Monitor. Blob Storage belongs to the later attachment phase. Phase A provisions none of these resources and does not implement managed identity.

## Deferred beyond Phase A

- Entra authentication and application authorization
- Business/domain modules and tables
- Reference-number allocation
- Catalog, ServiceRequest, Answer, workflow, Activity, notification, attachment, GIS, and EAM behavior
- Endpoint-specific abuse controls and distributed rate-limit storage
- Compression pending response-size evidence
- OpenTelemetry SDK/exporter activation
- React API cutover and deployment

## Explicit personal-development staff authorization (F036)

Use the [F036 operator runbook](../docs/features/F036-safe-development-staff-authorization-provisioning.md) for `dev:staff:inspect`, `dev:staff:provision` and `dev:staff:deprovision`. These separate commands require explicit development profile, personal-tenant confirmation and the verified local reqro_dev database. They never run during sign-in, startup or migrations. Dry-run is read-only; writes require `--confirm`. No default grants or production administration API are added.

The commands read process environment. To load deliberately selected ignored local files with Node, use (from `server/`):

```text
node --env-file=.env --env-file=.env.f036 node_modules/tsx/dist/cli.mjs src/database/development-staff-cli.ts inspect
node --env-file=.env --env-file=.env.f036 node_modules/tsx/dist/cli.mjs src/database/development-staff-cli.ts provision --dry-run
node --env-file=.env --env-file=.env.f036 node_modules/tsx/dist/cli.mjs src/database/development-staff-cli.ts provision --confirm
```

Keep `.env.f036` ignored and private. It contains only the explicitly selected personal tenant confirmation, internal principal ID, fictional Organization/scopes and permission selection described in the runbook. Never put tokens in it. Substitute `deprovision` for targeted removal after a reviewed dry run.

## Service participation development foundation (F051)

`PARTICIPATION_SUPPRESSION_THRESHOLD` is a server-only integer from 5 through 1000, default 5. Positive smaller counts are suppressed before disclosure, including declined/not-collected buckets. The protected `GET /api/v1/staff/analytics/service-participation?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD` additionally requires the explicit `analytics.service_participation.read` permission and existing PUBLIC request read/scope. UTC periods are inclusive, 28–366 days, with no future end date. No default or broad-bundle grant exists.

After the F051 migration, the guarded `dev:participation` CLI creates/reuses three fictional Organization areas. It requires the verified personal `reqro_dev` target, explicit development environment/profile, and process-only `F051_FICTIONAL_DATA_ONLY=true`. From `server/`, with that explicit opt-in:

```text
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts --dry-run
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts --confirm
```

The CLI changes no requests or permissions. Verify authenticated analytics denial before narrowly provisioning the dedicated development permission using F036; preserve existing request scopes. Use the developer-launched API outside the restricted sandbox for normal Entra signing-key retrieval. The protected preview is `/staff/analytics/service-participation`; it has no global navigation link. Production area administration and configuration audit are deferred. See [F051](../docs/features/F051-requester-geography-service-participation.md) and [ADR-013](../docs/architecture/decisions/ADR-013-operational-participation-geography.md) for privacy limitations and approved semantics.

### F051 Organization collection control

New Organizations default to collection disabled. Area provisioning does not enable collection. After the separate `20260928000000-add-participation-collection-setting` migration, explicitly preserve the approved fictional development setup using the same guarded CLI and process-only `F051_FICTIONAL_DATA_ONLY=true` opt-in:

```text
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts status
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts enable --dry-run
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts enable --confirm
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts disable --dry-run
node --env-file=.env node_modules/tsx/dist/cli.mjs src/database/development-participation-cli.ts disable --confirm
```

Status distinguishes `disabled`, `ready`, and `incomplete`; incomplete means enabled with no active areas. Disabled/incomplete hides the optional intake section and normal requests remain NOT_COLLECTED, while explicit geography is rejected. Area configuration, historical geography, grants/scopes and authorized historical analytics are untouched. After temporary disable UAT, explicitly re-enable the development Organization. Production administrative mutation authorization/UI/audit is deferred; no ordinary staff mutation endpoint exists.

### F052 read-only Organization administration

The real `/admin` UI uses `GET /api/v1/admin/configuration`, authenticated with Entra and independently authorized by `admin.configuration.read` in the trusted Organization. Query parameters are only `issuePage` and `areaPage`; both lists use fixed pages of 25. There are no Admin configuration write routes or write permission. `/admin-preview` remains non-authoritative demonstration content.

The migration `20260929000000-add-admin-configuration-foundation` registers the permission with **zero grants** and initializes independent participation collection/area revisions to 1. Database triggers increment only the resource whose collection/name/active/order values actually change. Existing F048/F049/Issue-action revisions are reused. Collection provisioning now reports `collectionRevision`; identical settings and dry runs do not advance it. Privacy threshold remains deployment-owned and has no Admin-editable revision.

For personal-development UAT, keep the API running outside the restricted sandbox. First prove and obtain user confirmation of authenticated Admin **403**. Then use the existing guarded F036 provisioning command with the explicitly selected existing principal/Organization, unchanged existing scopes, and `F036_PERMISSIONS=admin.configuration.read`; omit any bundle. Review `provision --dry-run` before `provision --confirm`. This permission is allowlisted for explicit selection only and is absent from every broad bundle. Preserve analytics and operational grants. Verify **200** afterward and retain the intentional narrow grant. Never copy bearer tokens or put private configuration in committed files.

Admin reads use a read-only repeatable-read database snapshot and append no mutation audit records. Normal logs must omit response snapshots. Future writes require separate authorization, expected resource revision with stale **409**, validation and immutable safe audit; those write APIs and production administrator governance remain deferred. See [F052](../docs/features/F052-organization-administration-foundation.md) and [ADR-014](../docs/architecture/decisions/ADR-014-administrative-configuration-authorization.md).

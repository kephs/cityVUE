# CityVUE API — Phase A Platform Foundation

This isolated workspace contains the CityVUE backend platform foundation. It intentionally has no business-domain endpoints, authentication, catalog, ServiceRequest schema, GIS, attachments, notifications, or integrations.

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

From the repository root, `npm run server:dev` starts the backend and `npm run react:start` starts the frontend. Phase A does not connect them.

Backend development uses the existing TypeScript compiler in watch mode with `tsconfig.build.json`, then starts/restarts Node on `dist/main.js` only after a successful complete emit. This preserves Nest constructor decorator metadata, which `tsx` does not emit. Failed builds leave the last successfully started server running until the source is corrected. Ctrl+C closes the compiler watcher and server. Production `npm start` remains unchanged; `tsx` remains available for the existing database CLIs, which do not use Nest dependency injection.

`npm run dev -- --check` performs a bounded compile and full Nest initialization without listening or watching. It uses the normal configuration validation and must receive valid settings; the unit regression runs it with fictional environment values and isolated dotenv discovery. No real Entra login or database provisioning is performed by this check.

## Platform endpoints

- Readiness: `GET http://localhost:3000/api/v1/health`
- Liveness: `GET http://localhost:3000/api/v1/health/live`
- Explicit readiness: `GET http://localhost:3000/api/v1/health/ready`
- OpenAPI UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs-json`

OpenAPI describes only implemented platform endpoints. Restricting or disabling documentation in production remains a deployment/security decision.

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

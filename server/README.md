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

Local staff mutation exercises require both `ENABLE_DEVELOPMENT_STAFF_ACTIONS=true` and an active Organization-scoped `DEVELOPMENT_STAFF_ACTOR_ID` created by the development seed. This gate is not authorization and is rejected when `NODE_ENV=production`. Never enable these endpoints in a deployed environment; production staff access still requires Entra authentication and server-enforced RBAC.

Startup validation requires `DATABASE_URL` and validates `NODE_ENV`, `PORT`, `APP_NAME`, `APP_VERSION`, `LOG_LEVEL`, `DATABASE_SSL_MODE`, pool/timeouts, `CORS_ORIGINS`, baseline rate limits, and telemetry placeholders. Production rejects disabled database TLS. `verify-full` preserves certificate validation; never disable certificate validation globally.

CORS uses an explicit comma-separated origin allowlist. `*` is rejected. Development defaults to `http://localhost:5173`; add `https://cityvue-1.web.app` explicitly in a future approved deployment environment.

## Database and migrations

Kysely with the `pg` pool is the persistence/migration foundation. It provides explicit SQL, typed query composition, transactions, reviewable migrations, and support for future version-column optimistic concurrency without forcing a domain schema now. Pool size and connection/statement timeouts are configurable. Connections are lazy, readiness is observable, and shutdown destroys the pool cleanly.

Start or stop local PostgreSQL with:

```text
docker compose -f compose.yml up -d
docker compose -f compose.yml down
```

The named volume preserves local development data. Use `docker compose -f compose.yml down -v` only when intentionally discarding that local volume.

## Logging, errors, and telemetry

Pino/pino-http emit structured JSON request logs with request ID, method, path, response status, duration, and errors. Authorization/cookie headers and common secret fields are redacted; bodies are not logged. A safely formatted inbound `x-correlation-id` is preserved, otherwise a UUID is generated and returned in that header.

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

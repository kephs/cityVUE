# F009 — Phase A Backend Platform Foundation

**Status:** Implemented and infrastructure-validated locally; not deployed  
**Scope:** Backend platform foundation only  
**Canonical development name:** CityVUE  
**Architecture authority:** F008 and its approved pre-Phase-A addenda

## Outcome

Phase A adds an isolated `server/` package without connecting or changing the React/Vite production app, Parcel rollback app, `IssueService`, browser `cityvueIssues`, Firebase Hosting, or deployment configuration. It establishes the runnable API platform only; no business/domain module, endpoint, schema, or migration exists.

## Structure and package management

`server/` owns its package manifest and lockfile, source, tests, migrations, TypeScript/lint/format configuration, Docker assets, environment example, and README. The root package adds convenience scripts through `npm --prefix server`; existing frontend and deployment scripts retain their behavior. This avoids a monorepo tool and prevents backend dependency resolution from changing the frontend dependency graph.

Node 22 LTS is recommended. The declared compatibility range is Node 20.19+ through 24 so the existing Vite baseline and currently available development/CI runtimes remain compatible.

## Selected libraries

- NestJS 11 modular REST application with `/api/v1` prefix
- strict TypeScript with `strict`, `noImplicitAny`, `strictNullChecks`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and related safeguards
- Joi centralized environment validation through `@nestjs/config`
- Kysely plus `pg` for explicit typed PostgreSQL access, pooling, transactions, and migrations
- Pino plus pino-http for low-overhead structured JSON logs
- Swagger/OpenAPI through `@nestjs/swagger`
- Helmet security headers and `@nestjs/throttler` configurable baseline rate limiting
- class-validator/class-transformer global Nest validation boundary
- ESLint flat configuration and Prettier
- compiled TypeScript tests using Node's native test runner plus Supertest/Nest testing

Kysely was selected over Prisma, TypeORM, Drizzle, and Knex for this foundation because it keeps PostgreSQL SQL and migrations explicit/reviewable, avoids generated schema artifacts and decorators before a domain exists, integrates directly with `pg`, supports explicit transactions, and permits future optimistic concurrency through normal version-column predicates. This decision does not approve any business schema.

## Configuration

Startup rejects missing or invalid required configuration. Variables are documented in `server/.env.example`:

- `NODE_ENV`, `PORT`, `APP_NAME`, `APP_VERSION`, `LOG_LEVEL`
- `DATABASE_URL`, `DATABASE_SSL_MODE`, `DATABASE_POOL_MAX`
- `DATABASE_CONNECTION_TIMEOUT_MS`, `DATABASE_STATEMENT_TIMEOUT_MS`
- `CORS_ORIGINS`, `RATE_LIMIT_TTL_MS`, `RATE_LIMIT_MAX`
- `OTEL_SERVICE_NAME`, optional `OTEL_EXPORTER_OTLP_ENDPOINT`

Wildcard CORS is rejected. Production cannot use `DATABASE_SSL_MODE=disable`; `verify-full` keeps server-certificate validation enabled. Secrets remain environment-managed and are never logged or committed.

## PostgreSQL and migrations

The pool connects lazily from centralized configuration, emits observable readiness failures without logging credentials, handles idle-client errors, and closes through Nest shutdown hooks. Pool maximum, connection timeout, and statement timeout are configurable with conservative defaults.

Kysely's `FileMigrationProvider` supplies create/up/down/status commands. Migration names are UTC `YYYYMMDDHHMMSS-kebab-case-description.ts`. The migrations directory contains instructions only: there is no bootstrap or domain migration and no table is created. Kysely supports the later explicit transactions and version-column optimistic concurrency required by F008.

`server/compose.yml` supplies PostgreSQL 17 Alpine on loopback only, a healthcheck, a named development volume, and documented local-only credentials. It was validated with Docker Desktop's Linux engine and Docker Compose 5.4.0: PostgreSQL 17.11 became healthy, published only `127.0.0.1:5432`, created the `server_cityvue-postgres-data` named volume, and accepted both host API and isolated test connections. `npm run server:test:db` passed against that controlled local database without skipping.

Migration tooling was validated end to end with temporary no-op migrations: create, pending status, apply, executed status, revert, and pending status all succeeded. The temporary files were then removed. No business table or lasting Phase A migration was added; the local validation database contains only Kysely's migration bookkeeping tables.

## HTTP and operational foundation

- `GET /api/v1/health/live` confirms process liveness without requiring PostgreSQL.
- `GET /api/v1/health` and `/api/v1/health/ready` require a successful PostgreSQL query and return 503 otherwise.
- OpenAPI UI is `/api/docs`; JSON is `/api/docs-json`. Production restriction remains a deployment/security decision.
- The global validation pipe transforms values, whitelists DTO fields, and rejects non-whitelisted fields.
- The global exception filter sanitizes unexpected errors and includes the request ID without exposing stack traces, SQL, credentials, or secrets.
- pino-http preserves a safely validated inbound `x-correlation-id` or generates a UUID, returns it in the response header, and logs method, URL, response status, duration, and error context.
- Helmet enables API security headers. CORS uses an explicit environment allowlist.
- A configurable in-memory global rate-limit baseline is enabled; endpoint-specific policies and distributed storage await actual public endpoint design and scale requirements.
- Compression is deferred until response sizes and proxy behavior justify it.
- Graceful shutdown closes PostgreSQL. Application version is explicit configuration defaulting to the server package version and can be replaced by approved build metadata.

## Telemetry and Azure readiness

Phase A prepares, but does not activate, an OpenTelemetry exporter. Service-name/OTLP configuration, structured logs, and request correlation are compatible with later OpenTelemetry/Application Insights work without adding SDK/exporter complexity before an approved destination exists.

The production-oriented multi-stage Dockerfile uses Node 22 Alpine, installs deterministic lockfile dependencies, copies only compiled runtime output, and runs as non-root. It contains no secrets. Future Azure boundaries remain Container Apps for API/worker, Azure Database for PostgreSQL, Key Vault and managed identity for secrets/access, Application Insights/Azure Monitor for telemetry, and later Blob Storage for attachments. No Azure resources or managed identity code were created.

## Test strategy and results

Phase A adds unit coverage for configuration success/failure, production TLS enforcement, CORS rejection, health behavior, correlation-ID selection, and error sanitization. Supertest E2E coverage exercises real Nest bootstrap/middleware for readiness, liveness, correlation headers, and Helmet headers while replacing only database reachability. A PostgreSQL connectivity test requires an isolated `TEST_DATABASE_URL`.

Implementation validation:

- strict typecheck/build: passed
- ESLint: passed
- formatting check: passed
- backend unit tests: 11 passed
- backend E2E tests: 2 passed
- database integration: 1 passed, 0 skipped against controlled local PostgreSQL
- PostgreSQL failure behavior: liveness remained 200; both readiness routes returned sanitized 503 responses; readiness recovered after restart
- migration lifecycle: create/apply/status/revert passed; temporary validation migrations removed
- production Dockerfile: multi-stage build passed; final corrected image size 70,223,567 bytes; runtime uses UID/GID 1000 (`node`) with no development dependencies or baked secrets
- containerized API: liveness, readiness, OpenAPI UI/JSON, and PostgreSQL connectivity passed on the Compose network; graceful stop completed in 0.44 seconds and restart reconnected successfully
- structured logging: request ID, method, route, status, and duration present; Authorization and Cookie values redacted; no database password logged
- correlation IDs: generated when absent, preserved when safe, and replaced when unsafe
- CORS: `http://localhost:5173` received the configured allow-origin header; an unapproved origin received no permissive header
- rate limiting: configurable global baseline enforced at 120 requests per 60 seconds; health endpoints currently participate in the baseline
- production TLS: startup rejected `DATABASE_SSL_MODE=disable`; development retained documented local disabled-TLS behavior
- root regressions: 58 passed; React tests: 48 passed; Parcel rollback and React/Vite builds passed
- root and backend dependency audits: 0 vulnerabilities

The backend test scripts were corrected to run from their compiled test directories because quoted recursive globs were not expanded by Node's test runner on Windows and prevented the suites from executing. Database dependency logging was also narrowed to safe error name/code fields after validation showed that serializing a raw `pg` idle-client error included its ephemeral backend cancel key; the corrected outage logs contain neither that key, the database password, nor supplied Authorization/Cookie values.

Frontend regression/build results and dependency audit are recorded in the completion report for the implementing task.

## Phase boundary and limitations

Phase A does not create or implement ServiceRequest, Answer, Department, Division, Category, ServiceDefinition, Assignment, Activity, Notification, Attachment, ExternalSystemReference, reference generation, Entra/RBAC, GIS, EAM integration, worker/background processing, or frontend API calls. It creates no database tables.

Before Phase B, the City still must approve Entra registrations, identifiers, scopes, tenant configuration, Conditional Access, admission model, granular authorization design, provisioning/deprovisioning, and security/privacy controls described by F008. Infrastructure standards, Azure environments, networking, secrets, telemetry destinations, operational ownership, database provisioning/TLS certificates, and CI/CD approvals also remain required. Phase B must be separately authorized.

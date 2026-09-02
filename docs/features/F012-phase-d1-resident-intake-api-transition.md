# F012 — Phase D1 Resident Intake API Transition

**Status:** Implemented for local development/testing; production cutover deferred

## Boundaries

React `/report` now depends on catalog and request repositories. `legacy` mode uses the existing fixture and wraps `IssueService`; `api` mode uses the canonical catalog endpoints and `POST /api/v1/service-requests`. The default is `legacy`, so Firebase production, `/issues`, Dashboard, Home analytics, and Edit/Delete remain localStorage-backed. No public request-read endpoint, deployment, Entra/RBAC, GIS, staff workflow, or Organization selector is included.

## Configuration and architecture

`VITE_CITYVUE_DATA_SOURCE` accepts `legacy` or `api` and defaults to `legacy`. API mode requires `VITE_CITYVUE_API_BASE_URL`; local development uses `http://localhost:3000/api/v1`. `createResidentIntakeRepositories` selects `FixtureCatalogRepository` plus `LegacyIssueRepository`, or `ApiCatalogRepository` plus `ApiServiceRequestRepository`. The browser never supplies an Organization ID; the API retains `DEVELOPMENT_ORGANIZATION_ID` ownership.

The native-fetch client centralizes JSON, timeout/abort support, correlation ID capture, and resident-safe errors. Catalog failures have explicit retry; selection sequencing prevents stale results from replacing newer choices. Submission is not automatically retried and Submit is locked while a POST is in flight. Category and Issue search filter loaded collections locally.

API DTOs normalize to the existing presentation model while retaining the exact `serviceDefinitionId`, `serviceDefinitionVersionId`, canonical question IDs, and option keys. The canonical mapper is separate from `mapIntakeToLegacyIssue`: description remains resident text, answers remain structured and typed, contact is included only for identified reporting, and entered location text is sent without geocoding or eligibility claims. The API reference is displayed verbatim.

## Local workflow

Use three PowerShell terminals from the repository root:

```powershell
docker compose -f server/compose.yml up -d
npm run database:migrate
npm --prefix server run seed:development
```

```powershell
npm run server:dev
```

```powershell
$env:VITE_CITYVUE_DATA_SOURCE='api'
$env:VITE_CITYVUE_API_BASE_URL='http://localhost:3000/api/v1'
npm run react:start
```

Open `http://localhost:5173/report`. Server CORS explicitly allows `http://localhost:5173` and does not use a wildcard.

## Security and production gate

The POST is a future public resident endpoint, not a staff-authenticated API. Local D1 is not production-ready. Production API mode requires approved API hosting, managed PostgreSQL, Key Vault/secrets, telemetry, TLS/networking, production CORS, privacy/security review, operational ownership, backup/restore, anti-abuse controls, environment configuration, smoke/UAT, and rollback. Staff read/manage functionality still requires identity and server-enforced RBAC.

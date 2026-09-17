# F026 — Protected Geospatial Read API and Permission Grant Foundation

**Status:** Local synthetic API proof only. No production GIS provider, live identity UAT, push, or deployment.

## Protected path

`GET /api/v1/geospatial` uses the existing F018 `StaffAccessGuard` with `@RequireEntra()` and `@RequirePermission('geospatial.read')`. Signed-token validation, delegated scope, pre-provisioned active StaffIdentity resolution, and active Organization-scoped role grants remain the authoritative production path. F025's `GeospatialAuthorizationService` checks the guard-resolved Organization, principal, and permission again before `GeospatialReadService` invokes the repository. Browser-side Organization scope is not authorization. No public endpoint is provided.

An optional `organizationId` query value is a consistency hint only. It must exactly match the server-resolved Organization. An `X-Organization-Id` header, browser role, or arbitrary body cannot grant access. Missing authentication returns 401; an authenticated principal without the permission or with missing/malformed context or a mismatched hint gets a generic 403. Denied requests make **zero provider calls**. The response uses `Cache-Control: no-store` and existing server-generated correlation IDs, sanitized HTTP errors, and allowlisted route/status logging. No bearer token, identity object, location payload, or arbitrary header is logged by this feature.

## Permission and grant strategy

The existing CityVUE `Permission` allowlist includes `geospatial.read`. An additive, repeat-safe migration adds that key to the PostgreSQL permission catalog and grants it to **no role or staff member**. A future administrator can explicitly associate the neutral permission with an approved Organization-owned role and assign that role through the existing RBAC records; no group name or claim is embedded in the geospatial service. External IdP groups/roles may later map through a separately reviewed identity adapter to CityVUE roles and neutral permissions. Business services depend only on `geospatial.read`.

The E2E harness uses fictional `geospatial-reader` role assignments in test-only code to prove explicit granting. Its token validator and role resolver overrides are never registered in application source or built into production. F018's development actor fallback cannot access this route because `@RequireEntra()` blocks it, and F025 also rejects `development: true`. The synthetic provider refuses all reads when `NODE_ENV=production` or `CITYVUE_DEPLOYMENT_PROFILE=client`. Thus adding a catalog key creates neither a default grant nor a production data fallback. Real delegated-token and database grant UAT requires separately controlled development identity and test infrastructure.

## Data contract and provider

The server returns `{ organizationId, boundary, requests }`, matching F024's narrow neutral GeoJSON subset without importing frontend code. `boundary` is one closed Polygon Feature with ID/name. `requests` is a FeatureCollection of Point Features with ID, title, category, and status. Longitude/latitude must be finite and in range; IDs are unique. A response projector rejects unsupported/invalid shapes and strips unexpected provider fields before HTTP output. Two distinct fictional Organizations and locations near 0°N, 0°E test isolation. They contain no real resident addresses, assets, staff/device locations, or City GIS data. The provider is behind `GeospatialReadRepository` and does not make authorization decisions.

The API is deliberately separate from `/map-preview`, which retains its F024 development-only browser repository. This feature does not change resident location eligibility. No ArcGIS SDK, PostGIS, production GIS database, City Entra tenant, City layer, City endpoint, credential, or production infrastructure was used. CityVUE independent development needs no City resource.

## Invariants and next work

1. Browser-side Organization scope is not authorization.
2. Private Organization-owned resources require guard-resolved server context.
3. Authorization precedes repository/provider access.
4. External identity roles map to CityVUE-neutral permissions; business code never depends on client group names.
5. GIS providers do not authorize callers.
6. Independent development requires no City resource.
7. Synthetic identity and provider paths cannot become production fallbacks.

Tests cover HTTP 401/403, authorized A/B reads, hint matching/mismatch, absent/invalid context, provider non-invocation after denial, production/client provider rejection, narrow response projection, logging sanitation, and permission migration behavior. Full local validation passed: backend unit 118/118, E2E 36/36, React 138/138, and legacy/shared 62/62; backend typecheck, lint, formatting, backend build, and React build also passed. The React build retains its existing large-chunk advisories. Eight PostgreSQL integration tests, including the new permission migration test, skipped because `TEST_DATABASE_URL` was unset. A local browser check confirmed `/map-preview` still rendered the fictional area, four requests, and inside/outside list selection. No live Entra or client GIS UAT occurred. Future work should approve the source and data ownership, explicit Organization role grants, operational audit/monitoring, and production provider before replacing the synthetic repository. PostGIS or ArcGIS remain optional adapter choices, not core domain types.

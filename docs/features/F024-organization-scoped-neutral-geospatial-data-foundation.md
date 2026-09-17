# F024 — Organization-Scoped Neutral Geospatial Data Foundation

**Status:** Local development preview only. No deployment or City GIS integration.

## Objective and decision

F023 rendered a bundled synthetic polygon and four points directly from the map page. F024 moves data ownership to `createSyntheticGeospatialRepository`, with one asynchronous `loadMapData(organizationId, { signal })` operation. The page consumes this boundary and validates its response; `CityVUEMap` still only renders supplied data. The existing route and accessible list remain. This is a small frontend boundary, not a new authoritative GIS service.

A backend endpoint was deferred. Existing public catalog reads use a configured development Organization, and protected staff reads use server-validated identity; a new public geographic endpoint would need an approved production access and Organization context model. Moving a four-point preview fixture into NestJS today would add an API and configuration policy without improving production authorization. Future provider work should put Organization-scoped reads behind the CityVUE API and trusted server context, with adapter translation to these neutral shapes. A browser-provided Organization ID must never authorize a backend read.

## Shape, scope, and provider

The serializable response is `{ organizationId, boundary, requests }`. `boundary` is a GeoJSON `Feature` with one closed Polygon ring, ID and name. `requests` is a GeoJSON `FeatureCollection` of Point features, each with string ID, title, category, and status. Longitude/latitude pairs must be finite and within geographic bounds; request IDs must be unique. Unsupported or malformed geometry fails safely. `toNeutralLocation` and `isInsideBoundary` are presentation-only helpers; the existing canonical Location and `LocationEligibilityProvider` continue to govern intake without any change.

The synthetic repository is instantiated for the deterministic local seed Organization ID and refuses missing or different IDs. Each load returns a fresh snapshot. Tests instantiate two different Organization scopes and verify cross-scope refusal and distinct datasets. **This browser-side scope is demonstration data isolation, not a security boundary.** It cannot authorize private data. The default provider is enabled only by Vite's development mode; a production/client build shows a safe unavailable state. No new client configuration or provider selector is needed because there is only one development provider.

Fixtures remain fictional near 0°N, 0°E. No resident address, staff/device location, browser geolocation, City credential, non-public GIS data, external tile service, or City endpoint is used. The demonstration notice remains visible during loading and error states. Provider errors are not shown. The map and its MapLibre classes stay inside the presentation component; neutral data code has no MapLibre import. The inside/outside text is explicitly non-authoritative and never changes service eligibility.

## Persistence and future evolution

No PostgreSQL schema, migration, persistence, API endpoint, or PostGIS extension is added. Spatial indexes or queries are not required for a four-point fixture. ArcGIS and Esri DTOs/SDKs are excluded. A future approved adapter may normalize authorized source data into the neutral response behind a server read service, after Organization authorization, source ownership, privacy, refresh, and production profile rules are settled. PostGIS remains an option only if real spatial operations justify it. A production map data source and authoritative service areas remain open decisions.

## Validation and limitations

Focused tests cover Organization isolation, snapshot independence, shape rejection, loading, invalid/unavailable data, list selection, map click, inside/outside text, warnings, WebGL fallback, and the production fixture gate. Full validation passed: React 138/138, backend unit 111/111, E2E 29/29, legacy/shared 62/62, backend typecheck, lint, formatting, backend build, and React build. Seven PostgreSQL integration tests skipped because `TEST_DATABASE_URL` was not configured; F024 changes no persistence.

Local browser checks showed the fictional boundary and four points, list and map point selection, map click details, light/dark themes, and accessible textual details. At 390px and 768px, the page did not overflow horizontally and the details remained visible. A local production build showed the safe unavailable state rather than rendering the synthetic fixture. Loading, invalid-data, and provider-error states are covered by automated tests. No browser network-panel verification was performed; source/style review found no external tile URL or City GIS endpoint.

The synthetic fixture only supports one boundary and Point requests; it is not a general GIS schema. Production builds intentionally cannot render synthetic map data. A separately approved production data provider and server authorization remain necessary.

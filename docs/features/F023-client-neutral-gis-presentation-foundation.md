# F023 — Client-Neutral GIS Presentation Foundation

**Status:** Local stakeholder demonstration. No City GIS, production geocoding, tile service, or deployment.

## Purpose and scope

F023 proves that CityVUE can display a service area and request points with a replaceable rendering technology. `/map-preview` is a public presentation-only route under the existing App layout, like `/ai-preview`. It does not initialize staff identity, submit a request, call the API, or change server location eligibility. CityVUE remains the development name.

## Architecture and dependency

The only new direct dependency is `maplibre-gl` 6.10.0 (BSD-3-Clause), installed with the existing npm lockfile. No React map wrapper is needed: the component owns initialization, events, selected-point styling, resize, error state, and `remove()` cleanup. MapLibre stays in `react/src/map/CityVUEMap.jsx`; other components receive neutral GeoJSON and `{ latitude, longitude }`. MapLibre is a renderer, not the CityVUE Location domain model or a GIS provider. The existing backend `LocationEligibilityProvider` remains authoritative for canonical intake and is untouched.

The preview fixture is explicitly **SYNTHETIC TEST DATA** near 0°N, 0°E: one fictional polygon, four fictional request points with category/status labels, and an outside point. It contains no resident address, contact information, City coordinate, or internal GIS data. A small point-in-polygon function reports only whether a demo point is inside the fictional shape. It must never drive real service eligibility. A map click produces a neutral `{ latitude, longitude }` value for display only; it is not saved or passed into the Report an Issue form.

The MapLibre style has only a background, local GeoJSON sources, and fill/line/circle layers. It has **no basemap, tile URL, geocoder, API key, or external map style request**. This avoids an external service and makes the preview usable in isolated development. It also means the preview offers abstract geographic context rather than streets or addresses. A future public basemap or client tile source requires separate license, privacy, availability, security, accessibility, and production review. The Vite `?worker&url` import bundles MapLibre's worker as a same-origin asset, as required by MapLibre 6's Vite guidance; CSS is also bundled. Neither asset is City infrastructure.

## Interaction, accessibility, and layout

Users can pan and zoom the map, select a point, or click a sample location. The request list is keyboard accessible and exposes the same request selection and text details without relying on the canvas or color. `aria-pressed` indicates the selected list item; status and inside/outside location are written in text. Map controls come from MapLibre. The canvas is hidden from the accessibility tree because the adjacent list and details are the usable alternative. Loading and failure text remains visible as needed. A WebGL or map error cannot crash the route; the list remains available.

The page reuses CityVUE navigation, typography, Bootstrap theme, content width, and responsive patterns. It uses one column below 900px, bounds the map height on phones, and uses the current light/dark theme. MapLibre is recreated on a theme change and cleaned up on unmount. No precise resident location is logged, persisted, or sent to analytics.

## Boundaries and later work

No ArcGIS organization, City GIS layer, City credential, City network, City API, City database, or production geocoder is accessed. The preview's fictional inside/outside result is not a substitute for F015's server-side provider decision. Future authorized GIS work can supply neutral geometry through an Organization-scoped backend/provider adapter and map presentation can consume it without exposing vendor schemas in the domain or browser. Integration with canonical Location, production service areas, geocoding, actual basemaps, asset selection, and intake remains out of scope.

## Validation

Focused tests cover synthetic inside/outside points, neutral coordinate conversion, local style data, MapLibre initialization/click/cleanup, route rendering, selection, runtime error, unresponsive-map timeout, and WebGL fallback. Full regression passed: React 135/135, backend unit 111/111, backend E2E 29/29, and legacy/shared 62/62. Seven PostgreSQL integration tests skipped because `TEST_DATABASE_URL` was not configured. Backend typecheck, lint, formatting, and build passed; React production build passed. The map route is lazy, but MapLibre adds a 1,024.82 kB route JavaScript chunk and 507.75 kB same-origin worker; Vite warns about chunks over 500 kB, including the existing main bundle.

Local browser inspection verified the desktop preview, fictional boundary and four points, map marker selection, map click location, and light/dark themes. The available in-app browser did not expose mobile/tablet viewport overrides, so those widths were not manually verified. Automated tests do not use network tiles. Source/style review confirms no City endpoint or external tile URL is configured; a browser network-panel inspection was not available.

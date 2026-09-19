# F028 — Protected Geospatial Client Integration

## Scope and flow

Reqro is the commercial/platform working name; existing CityVUE code, configuration and resource names are retained. Client branding remains a separate white-label concern. F028 connects the existing map preview to F026 without changing the backend, granting default permissions, or introducing an external GIS integration.

MSAL authenticated session → existing authenticated API client → `GET /api/v1/geospatial` → trusted server Organization authorization → provider-neutral repository → validated neutral Polygon/Point response → MapLibre.

`VITE_CITYVUE_DATA_SOURCE=api` selects the API repository. Use the existing `VITE_CITYVUE_API_BASE_URL` (including `/api/v1`) and complete F018 Entra settings. The page uses the existing AuthContext sign-in action; the API client acquires the delegated token through the existing F018 token provider. No second MSAL instance, token store, token logging, or token-bearing UI is added. Without configured authentication or a signed-in account, no map request occurs.

Normal API requests send no Organization hint. The server resolves scope from verified identity and database authorization. The response Organization value is validated as part of the neutral contract, not accepted as client authority. MapLibre has no authentication, authorization, Organization-selection, or provider-selection responsibility.

## States and data lifetime

- Loading announces status and shows no prior protected map or demo fixtures.
- HTTP 401 presents a session-unavailable message and the existing sign-in action.
- HTTP 403 presents access denied. **401 != 403**: denial never forces Microsoft logout, reveals Organization existence, or displays internal permission names.
- Network errors, existing API-client timeouts, 5xx, invalid JSON, malformed geometry and unsupported geometry show a generic unavailable state. Raw exceptions and response bodies are not rendered.
- Refresh and retry initiate a new protected read. The old map, list, selection and clicked location are cleared first. A subsequent 403 therefore removes protected presentation immediately on that read; there is no background polling or promise of instantaneous removal before a new read.
- Identity changes remount the protected view; sign-out unmounts it. Abort signals and late-response checks prevent responses from a previous principal or request from repopulating the view.

API mode never falls back to synthetic browser fixtures following denial or service failure. Legacy mode intentionally retains F024's development-only demo repository and inside/outside demonstration. Fixture imports are deferred to that demo load path; production demo reads fail closed. No protected data is persisted outside component memory.

## Presentation and security

The accessible request list and selected-request details remain available independently of WebGL. Native buttons support sign-in, retry, refresh and list selection. Loading uses status semantics; failures use alerts. Existing responsive layout, theme support, and map/list selection remain. API copy is provider-neutral; inside/outside indications remain visual and are not eligibility decisions.

The backend GIS provider remains synthetic in F028 and is still forbidden in production/client profiles. No ArcGIS SDK, REST call, credentials, DTO, City resource, external tile source, schema or migration is added. ArcGIS and any other real provider remain deferred pending a separate source/adapter decision. F018 verification, F025 authorization, F026 `no-store`, and F027 provisioning/revocation boundaries are unchanged.

## Validation

Focused React coverage exercises the real API client with fictional tokens and mocked transport: protected URL/authentication, server-owned scope, loading, success, 401 sign-in, 403 without logout, refresh after revocation, network/retry, timeout, 5xx, malformed responses, unsupported geometry, identity-switch races and missing authentication. Existing demo, geometry, inside/outside, WebGL fallback and selection tests remain.

Backend validation passed: unit 123/123, E2E 36/36, PostgreSQL 14/14 with zero skips, typecheck, lint, formatting and build. Shared tests passed 62/62. React passed 155/155 (19 files), including 17 additional cases; React production build passed with the existing large-chunk warning. All executed suites had zero failures. Personal identifiers, tokens and credential-bearing settings remain outside this document and Git.

Browser checks verified API-mode sign-in gating and development demo rendering, map/list selection, inside/outside text, light/dark themes, and no horizontal overflow at 390px, 768px and 1280px. Theme recreation now resets the renderer loading state so the selected-point highlight is reapplied after the new style loads.

Live F028 personal-Entra UAT passed after operator-completed sign-in. With the backend stopped, the UI showed a safe unavailable state and Retry. After startup, Retry showed loading then access denied while the grant was inactive. The supported F027 development grant enabled a protected 200 response and the two server-synthetic requests, with no browser-demo fallback. Authorized list selection and light/dark rendering worked, and the API-backed layout had no horizontal overflow at 390px, 768px and 1280px. Supported revocation followed by Refresh map data in the same Microsoft session returned 403 and removed both the map canvas and request list, showing access denied without logout. Final database verification confirmed the exact assignment inactive, identity and Organization membership retained, and unrelated assignments and permission catalog unchanged. Live provider-call counters were unavailable; automated backend tests cover zero calls on denial. The temporary backend/demo processes were stopped. No source/backend authentication bypass was used.

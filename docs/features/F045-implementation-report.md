# F045 — Requester Issue Location Experience: Implementation Report

## Checkpoint and scope

Starting HEAD: `54bb498ba37edcd28c646c84a4a1274370939697`, synchronized `main`, clean working tree, zero ahead/behind. F044 is accepted and synchronized. F045's local commit is `feat(requests): add requester service location experience`; its exact hash is supplied by the post-commit response and can be resolved with `git log -1 --format=%H -- docs/features/F045-implementation-report.md`. A commit cannot contain its own final hash. No push, deployment or F046 work is authorized.

The [feature specification](F045-requester-issue-location-experience.md) records the design. No migration, dependency, grant or production provider was added. This report groups the requested completion checklist by concern; statements about browser UAT, automated tests and development database observations are distinguished below.

## Location semantics and persistence

| Concept             | Meaning                                 | Persisted by F045?                               |
| ------------------- | --------------------------------------- | ------------------------------------------------ |
| Service Location    | Where the reported issue exists         | Existing Organization/request-owned Location row |
| Device Location     | Optional transient browser proposal     | No separate persistence                          |
| Requester Geography | Where a requester resides/is associated | Not implemented                                  |
| Map Selection       | Service Location input method           | No separate domain or provenance                 |
| Address Search      | Service Location input method           | No separate domain or provenance                 |

**Service Location describes the issue. It does not mean requester residence. Device geolocation does not create Requester Geography.** Contact name/email remains separately protected and is never automatically copied to Service Location. Service Location grants no Contact permission.

The existing `location` table already provides entered text, nullable `numeric(9,6)` latitude/longitude, location type, Organization/request foreign keys and eligibility snapshot fields. No migration was required. Text is trimmed and bounded to 2,000 characters. Coordinates must be finite numbers within latitude ±90/longitude ±180, supplied together; DTO validation and the creation service both enforce relevant input checks. Values use numeric serialization without coordinate swapping or locale parsing. PostgreSQL applies the existing six-decimal storage precision; the UI does not promise survey-grade accuracy or invent a postal address. Six-decimal and negative-value persistence is tested.

`locationType` remains a semantic type: coordinate proposals use `other`, text-only intake uses `entered_address`. Search/map/device provenance is not persisted or recoverable later. Normalized address and facility/park/parcel/asset references remain unset. Raw provider responses, accuracy, browser permission, device history and requester geography are absent. Existing eligibility snapshots remain server-owned.

## Input methods and search

| Input method             | Available                                                      | Requires map?      | Requires device permission? | Establishes Service Location?            |
| ------------------------ | -------------------------------------------------------------- | ------------------ | --------------------------- | ---------------------------------------- |
| Address/location search  | Synthetic development configuration; unavailable in production | No                 | No                          | Yes: label and coordinates               |
| Map selection/correction | Valid development boundary and working MapLibre                | Yes                | No                          | Yes: point plus generic/editable text    |
| Device geolocation       | Browser support and explicit action                            | No for acquisition | Yes                         | Yes: valid approximate point             |
| Manual text/coordinates  | Always available for applicable Issues                         | No                 | No                          | Yes, subject to Issue eligibility policy |

The neutral search contract is `search(query, { signal })` returning `{ id, displayLabel, latitude, longitude }`. Normalization rejects malformed/out-of-range coordinates, blank/overlong labels and removes provider extras. Queries require three trimmed characters, debounce for 300 ms, and yield at most five results. The development configuration supplies three fictional locations near the existing F026 fictional Organization boundary. No search query is sent to the server or a third party: filtering occurs in browser memory. An abort signal and sequence counter suppress stale responses after query changes or selection. Input changes cancel queued work. Failure preserves the query, offers explicit retry and keeps other methods available.

Results use a labelled list with native buttons. Tab/Enter selects; selected-result removal moves focus to the location field. There is no custom combobox requiring arrow-key behavior. Search labels are ordinary escaped text, not authorization, HTML or authoritative postal addresses.

Production geocoding is unconfigured. A future provider must implement the neutral contract and obtain explicit configuration, privacy/licensing/availability approval, credentials where necessary, quotas/throttling and appropriate server mediation. There is no production synthetic-address fallback and no commercial SDK/API key. Automatic reverse geocoding is not implemented.

## Organization boundary and MapLibre

`GET /api/v1/intake/location` is a separate minimized public configuration boundary. It uses the existing server-configured catalog Organization, checks that Organization is active, and takes no browser Organization selector. Only development runtime/profile returns its fictional boundary and synthetic search locations. Other profiles, unsupported or inactive Organizations return unavailable configuration. Responses are no-store/no-referrer and contain no staff grants, staff request points, administrative GIS metadata or credentials. The protected F026/F027 staff geospatial route and grants are unchanged.

The source is the existing F026 Organization A/B fixture, validated through the existing narrow GeoJSON projection. A belongs to the near-zero rectangle; B has a different rectangle. It is not municipal jurisdiction data. The coordinate-aware development eligibility provider supports the existing `city_boundary` and `service_area` policies. Other geographic policies cannot be satisfied merely by a point or a search label. Missing/unsupported geometry or malformed points cannot produce eligibility. Edge points are included; clear inside, outside, edge and cross-Organization cases are covered.

Issue policy remains authoritative. The live seed Issues use `no_geographic_restriction`: outside the displayed fictional boundary warns but does not block or redirect. Existing restrictive policies reject ineligible results and block unavailable/undetermined validation. Technical failure is never labelled outside. Text-only fallback can reach Review but does not bypass a restrictive policy that cannot establish eligibility. No new operational boundary policy or location-based routing/assignment was invented.

MapLibre renders and handles interaction; it is neither the authoritative geocoder nor service-boundary database. It consumes local GeoJSON with background/fill/line layers, no street basemap, no tile/style endpoint and no external map request. Its existing same-origin worker/CSS are reused. The map loads lazily only on applicable intake details, cleans up on unmount, uses ResizeObserver, updates markers without recreating the map on every selection, and recreates for theme/configuration changes. A new click/tap corrects the marker; drag is not required. Failure/timeout and lazy-module failure retain manual/search controls.

## Device geolocation and draft privacy

Only **Use my current location** invokes `getCurrentPosition`; page load, Issue selection, map load and Back/Edit do not. Options use a ten-second timeout, no cached position and no high-accuracy request. Success validates coordinates, selects an approximate point and asks the requester to check that it represents the issue. Accuracy is neither retained nor displayed as a precision claim. Duplicate clicks are suppressed while pending, and stale callbacks after another selection, edit or unmount cannot overwrite the draft.

Permission denied, unsupported/unavailable, timeout and malformed success each give safe text and retain other methods. No automatic reprompt occurs. The raw browser payload is never logged or stored. Chosen coordinates become only Service Location if the requester eventually submits.

Draft text/point live in React memory, survive Review/Back, and clear when Category/Issue changes. Refresh loses the unsaved draft; no localStorage/sessionStorage location persistence was added. Search query, selected coordinates and provider response do not go into URLs, titles, analytics or logs. Existing structured API logging sanitation remains; the old intake console exception output was removed. No attachments, photos, camera, EXIF, requester geography, location analytics or anonymous-policy expansion was implemented.

## Creation, projections and compatibility

The same PUBLIC/F029 creation route resolves the configured Organization, scoped published Issue/version, existing Issue action and requester/answer/location rules. It evaluates applicable eligibility before starting writes. Inside the existing transaction it locks/rechecks the current Issue action, allocates the F033 reference, creates the request, separate Contact/Location/Answers and existing Activity including F035 `REQUEST_CREATED`, then commits. No second creation route exists. Invalid coordinates or eligibility failure leave no request/location/Activity/counter consumption; disposable database snapshots verify this. The existing external-only guard remains authoritative even for valid search/map/manual-labelled points, with no local request/reference/location side effect.

Staff-assisted PUBLIC uses the same validated Location DTO and creation service. INTERNAL text-location behavior is preserved, with no staff intake redesign or new permission. Existing staff details support text and optional coordinates; F045 correctly types PostgreSQL numeric reads and explicitly normalizes them to JSON numbers, and F043 continues to show the entered text. F044's requester projection remains text-only Service Location: no coordinates, device metadata, provenance, Contact, Notes, Activity or Communications were added. Its disposable credential/projection tests verify a coordinate-bearing Location still returns only the approved text projection. No development tracking credential was issued.

Review shows editable Service Location text and selected coordinate context. Back/Edit preserves the active draft. Successful confirmation shows the accepted submitted label (trimmed exactly as persisted) and Issue beside the existing receipt reference. The F029 receipt contract itself remains ID/reference/status/time; this is not a new public detail lookup or independent post-save retrieval. Automated creation/persistence and confirmation tests cover this compatibility. No live submission was needed or performed; consequently no new fictional request or live staff-detail session is claimed.

## Browser UAT and responsive/accessibility results

An isolated headless Chrome ran the real local React PUBLIC intake and API catalog/configuration. The in-app browser could not attach. Initial browser loading exposed stale Vite optimized dependencies; the user restarted the frontend. A temporary alternative-port frontend was not used to bypass the API's existing CORS policy. No auth/CORS relaxation was made.

Real browser UAT used Pothole and fictional near-zero Service Locations. Search returned three bounded results; Tab/Enter selected the result and focused the location field. Map click/reselection, inside/outside messages, correction via another result, manual text/coordinates, Review and Back/Edit all passed. Browser geolocation was mocked with fictional coordinates for success, denial, unavailable and timeout; no real physical location was requested for or persisted as UAT data. Four explicit mock calls occurred and Back/Edit did not add any. Automated tests additionally prove no automatic request, malformed/unsupported results and stale callbacks.

Map module loading and location-configuration failures were deliberately injected in separate browser pages. Both retained a manual text path through Review; no submission occurred. Actual external-only behavior and submission atomicity are disposable automated/database evidence, not an invented live external-redirect or creation observation.

| Width | Light/dark controls and search | Map height | Selected summary/manual controls                    | Review/Back and overflow |
| ----- | ------------------------------ | ---------- | --------------------------------------------------- | ------------------------ |
| 1440  | Passed                         | 360 px     | In bounds                                           | Passed; none             |
| 1280  | Passed                         | 360 px     | In bounds                                           | Passed; none             |
| 1024  | Passed                         | ~348 px    | In bounds                                           | Passed; none             |
| 768   | Passed                         | ~261 px    | In bounds                                           | Passed; none             |
| 390   | Passed                         | 220 px     | Stacked coordinates; optional device action visible | Passed; none             |

Browser geometry checked search/results, map, selected text, optional device control, manual fields and navigation at all ten width/theme combinations. Review was checked at every width in both themes. Visual inspection included desktop light and mobile dark. The tests use browser viewport emulation, not a physical phone/software-keyboard certification. Pointer and keyboard paths are available; no map operation is required for manual completion where policy allows.

Native labels/fieldset/legend, list/button semantics, selected-location/status announcements, errors, textual boundary meaning and visible keyboard focus were checked. The focused device control showed a three-pixel outline. UAT fixes enlarged map zoom buttons to 44×44 and improved dark outline-button contrast; both were rechecked. The map itself is not claimed fully accessible, and there is no screen-reader certification. **This validation is not a WCAG certification.**

## Failure matrix

| Failure                        | Actual result and continuation                                                                                 |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Search provider unavailable    | Safe message, query retained, explicit retry; map/manual remain if config exists                               |
| No results                     | Textual empty state; change search or use another method                                                       |
| Map unavailable                | Safe fallback message; search/manual remain                                                                    |
| Device permission denied       | Safe denial; no automatic retry; other methods remain                                                          |
| Device unavailable/unsupported | Safe message; other methods remain                                                                             |
| Device timeout                 | Safe timeout; explicit retry or another method                                                                 |
| Boundary unavailable           | Distinct unavailable/undetermined handling; restrictive server policy blocks, unrestricted manual path remains |
| Outside boundary               | Warning for unrestricted Issues; restrictive server policy rejects                                             |
| Invalid coordinates            | Rejected without selection/persistence; correct coordinates or use permitted text input                        |

## Development integrity and configuration

Read-only checks confirmed **22 applied migrations, zero pending**, **zero active/four revoked tracking credentials** and **21 explicit operator grants exactly matching FULL_UAT_OPERATOR**. No migration/provisioning/credential operation was performed. Existing PUBLIC `SR-202609-000007` remains Open, revision 26, updatedAt `2026-09-22T01:47:20.478Z`; INTERNAL `DEV-202609-00000003` remains On Hold, revision 24, updatedAt `2026-09-20T09:56:47.999Z`. PUBLIC counts match the accepted F044 record: one Note, two Communications, 27 Activity records, seven assignment-history records, one watcher and no structured Contact. F045 used only reads against reqro_dev and disposable writes against reqro_test. These recorded state/count comparisons are not a new claim of complete historical child-content snapshots.

No operator action is required for existing development PUBLIC intake. Synthetic configuration requires `NODE_ENV=development` and the development deployment profile, an active configured catalog Organization matching the existing fictional fixture, and the current API/frontend. Existing restrictive development eligibility additionally requires its already-established provider opt-in; F045 did not change local environment files to enable it. Unrestricted seed Issues remain unrestricted. Production geocoder, tiles/style and authoritative boundary sources are deliberately unconfigured.

## Validation and performance

Automated baseline: **898 passing tests** — backend unit **210**, API E2E **40**, PostgreSQL **174** with **zero skips**, shared **62**, React **412** across 30 files. The final numeric detail-projection compatibility fix additionally passed ten affected unit tests and the creation database integration test. The final frontend confirmation assertion and location components passed all 24 targeted React tests. TypeScript, backend lint, configured backend formatting, new frontend/document formatting, backend/frontend production builds, Git whitespace, relative documentation links and scoped private-data checks passed as local-commit gates. Frontend lint has no configured script and is not claimed.

Tests use the configured script-equivalent Node entrypoints: server TypeScript compilation with tsconfig.test.json, then Node --test in each compiled unit/e2e/database directory (serial E2E/database; final units also serialized), root shared-test file list from package.json, and Vitest run --config vitest.config.mjs --maxWorkers=1. Only TEST_DATABASE_URL is loaded for disposable database tests, validated as localhost reqro_test. TypeScript noEmit/build configs, ESLint, configured Prettier globs and Vite build use their existing local package entrypoints. No assertion or security policy was weakened.

The production build retains the existing >500 kB chunk warning and Vite plugin-timing notices. The lazy Service Location map reuses the approximately 1.03 MB MapLibre engine and 507.75 kB worker; the Report route is approximately 26.54 kB (7.46 kB gzip). There is no new mapping dependency. Search is local and bounded, configuration is one read per mounted Details component, map state changes do not refetch config, and boundary checking is linear in the small single-ring fixture. Back/Edit remounts Details and revalidates configuration. No production geocoder performance, quotas, distributed rate limits or volume capacity is claimed.

During validation, an initial database runner invocation used a directory argument unsupported by Node's test runner; the corrected script-equivalent working-directory invocation passed. An initial concurrent unit run timed out in an unchanged subprocess sanitation test; serial rerun passed without weakening assertions. A search test also exceeded the five-second limit under contention; focused rerun passed. Final suites determine completion, not those failed initial runs.

## Security review and deferred work

The reviewed diff preserves server Organization authority, PUBLIC/INTERNAL admission, staff GIS authorization, independent Contact permissions, F032 external-only rules and F044 projection boundaries. No default grant, precise-location log, new persistent browser storage, third-party query, provider credential, client GIS or analytics path was added. Map failure is not a single point of failure for permitted manual intake. Final private-data and whitespace checks cover the complete commit set. No screenshots, browser fixture, API capture or UAT log belongs in the commit.

Deferred: production geocoder selection/credentials, authoritative client addresses/parcels/jurisdiction GIS, automatic reverse geocoding, requester residence/geography/identity/history, device-location history, aggregate/heat-map/equity analytics, photos/attachments/camera/EXIF, anonymous policy, location routing/assignment, geofencing notifications, offline maps, tile/provider procurement and production provider quota/rate-limit design. No F046 implementation was started.

After all completion gates pass, create the local F045 commit, verify a clean tree and main one ahead/zero behind unchanged origin/main, and stop for review. Nothing is pushed or deployed; no remote/cloud/client resource is changed.

## Final file inventory

32 intended files; no migrations, environment files, dependency manifests, screenshots or UAT artifacts.

| File                                                                           | Kind           |
| ------------------------------------------------------------------------------ | -------------- |
| `docs/ARCHITECTURE.md`                                                         | Documentation  |
| `docs/CITYVUE_CONTEXT.md`                                                      | Documentation  |
| `docs/ROADMAP.md`                                                              | Documentation  |
| `docs/features/F045-implementation-report.md`                                  | Documentation  |
| `docs/features/F045-requester-issue-location-experience.md`                    | Documentation  |
| `docs/features/README.md`                                                      | Documentation  |
| `react/src/catalog/catalogRepositories.js`                                     | Implementation |
| `react/src/pages/report/IssueForm.jsx`                                         | Implementation |
| `react/src/pages/report/ReportIssuePage.jsx`                                   | Implementation |
| `react/src/residentIntake/ServiceLocationInput.jsx`                            | Implementation |
| `react/src/residentIntake/ServiceLocationMap.jsx`                              | Implementation |
| `react/src/residentIntake/locationSearch.js`                                   | Implementation |
| `react/src/residentIntake/residentIntakeRepositories.js`                       | Implementation |
| `react/src/residentIntake/serviceLocation.css`                                 | Implementation |
| `react/src/serviceRequests/canonicalSubmission.js`                             | Implementation |
| `react/test/ReportIssueApiMode.test.jsx`                                       | Permanent test |
| `react/test/ServiceLocationInput.test.jsx`                                     | Permanent test |
| `react/test/ServiceLocationMap.test.jsx`                                       | Permanent test |
| `server/src/database/database.types.ts`                                        | Implementation |
| `server/src/geospatial/synthetic-geospatial.repository.ts`                     | Implementation |
| `server/src/location-eligibility/development-location-eligibility.provider.ts` | Implementation |
| `server/src/location-eligibility/evaluate-location-eligibility.service.ts`     | Implementation |
| `server/src/location-eligibility/intake-location.controller.ts`                | Implementation |
| `server/src/location-eligibility/location-eligibility.module.ts`               | Implementation |
| `server/src/location-eligibility/service-location.domain.ts`                   | Implementation |
| `server/src/service-request/create-service-request.service.ts`                 | Implementation |
| `server/src/service-request/get-service-request-details.service.ts`            | Implementation |
| `server/src/service-request/service-request.dto.ts`                            | Implementation |
| `server/test/database/request-tracking-checks.ts`                              | Permanent test |
| `server/test/database/service-request.integration.test.ts`                     | Permanent test |
| `server/test/e2e/service-request.e2e.test.ts`                                  | Permanent test |
| `server/test/unit/service-location.test.ts`                                    | Permanent test |

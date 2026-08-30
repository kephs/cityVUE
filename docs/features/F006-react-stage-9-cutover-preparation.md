# F006 — React Stage 9 Cutover Preparation

**Status:** Complete  
**Scope:** React/Vite MVP cutover preparation and Firebase Hosting preview only

## Prepared React MVP

The supported React routes remain `/`, `/report`, `/issues`, `/issues/:issueId/edit`, and `/dashboard`, with the React Not Found experience for unsupported routes. Home, Report, Issue List, Edit Issue, and Dashboard are route-level lazy imports. The shared application shell stays rendered during navigation and exposes a restrained `role="status"` loading message while a page chunk loads.

The production React build remains `dist-react/`; the Parcel rollback build remains `dist/`. Stage 9 does not alter the existing `firebase.json`, its `dist/` target, or the legacy `npm run deploy` behavior.

## Preview Hosting Configuration

`firebase.react.preview.json` is the only configuration approved for the Stage 9 preview channel. It:

- serves `dist-react/`;
- rewrites unmatched requests to `/index.html` for direct SPA route loads;
- gives hashed `/assets/**` files a one-year immutable cache policy;
- prevents persistent caching of `/index.html`;
- includes legacy Issue List and Dashboard redirect declarations; and
- assigns local Hosting emulator port `5209`.

The React compatibility router also handles `/pages/issues.html`, `/pages/dashboard.html`, and `/pages/report.html`. The report compatibility route is required because Hosting configuration cannot safely interpolate the historical `?id=<issue-id>` query value into `/issues/:issueId/edit`. It maps a trimmed ID with URL encoding and sends the no-ID form to `/report`. Unknown IDs then receive the existing Edit Issue not-found behavior.

## Build and Performance

Before Stage 9, the React build emitted a single 552.27 kB minified / 176.35 kB gzip JavaScript bundle. With route-level splitting, the initial JavaScript is 288.45 kB minified / 92.05 kB gzip. Dashboard and Chart.js are isolated in a deferred 214.49 kB minified / 72.74 kB gzip route chunk. Other page chunks range from 5.34 kB to 15.95 kB minified. Vite emits hashed assets and no production source maps.

The 2.12 MB Home hero PNG remains the largest emitted asset and is a future image-optimization opportunity; changing it was outside this cutover-preparation scope.

## Storage and Preview Data

The MVP still uses browser `localStorage` under the `cityvueIssues` key. Storage is origin-specific: data created at the emulator origin, the eventual Firebase preview URL, an existing localhost development port, and the live Hosting origin are separate. Preview UAT therefore starts with an independent data set unless that exact preview origin was used previously. This is expected prototype behavior, not migration or synchronization.

Use only synthetic disposable UAT records. Do not enter resident or production data. Remove disposable records through the existing confirmed Delete workflow when UAT ends.

## Security and Dependency Review

The Vite output contains no `.map` files. The built output is reviewed for private keys, service-account credentials, bearer tokens, credential-bearing URLs, and common secret assignments before preview deployment. Firebase browser configuration, if later introduced, must never contain privileged server credentials.

The initial audit found `brace-expansion` 5.0.7 through the development-only chain `rimraf → glob → minimatch → brace-expansion`. It was updated within the existing compatible range to patched 5.0.9 without `--force` or a broad upgrade. The post-update audit reports zero vulnerabilities.

## Emulator and Preview Acceptance Gates

Before preview deployment:

- run `npm test`, `npm run test:react`, `npm run build`, and `npm run react:build`;
- run `npm audit`;
- start Hosting locally with `firebase emulators:start --only hosting --config firebase.react.preview.json --project cityvue-1`;
- verify every supported route by direct load and refresh, legacy mappings, asset responses, Not Found, responsive overflow, theme behavior, and browser console output; and
- exercise create, list search/filter/sort, edit, delete confirmation, Dashboard statistics/recent issues/chart drill-down, and cleanup using synthetic data.

The only permitted deployment command for this stage is:

```powershell
firebase hosting:channel:deploy stage9-react --config firebase.react.preview.json --project cityvue-1
```

Do not run `firebase deploy`, `npm run deploy`, or any live-channel command during Stage 9.

## Cutover Checklist

- [ ] Preview-channel UAT is accepted by the product owner.
- [ ] The exact production cutover window and operator are approved.
- [ ] A fresh React build passes all automated and manual gates.
- [ ] The production Hosting configuration change from `dist/` to `dist-react/` and SPA rewrite is separately reviewed.
- [ ] Legacy URL behavior, especially historical edit links, is accepted.
- [ ] Browser-only storage limitations and loss of cross-origin prototype data are accepted.
- [ ] Cache behavior, asset loading, source maps, secrets, and dependency audit are rechecked.
- [ ] Monitoring, accessibility, privacy, support ownership, and rollback authority are confirmed.
- [ ] A backup/tag or otherwise identifiable known-good legacy revision and build are available.
- [ ] Live deployment receives a separate explicit authorization; Stage 9 preview approval is not live approval.

## Rollback Plan

If a later authorized live cutover fails, stop further changes, restore the last known-good revision/configuration whose `firebase.json` serves the Parcel `dist/` build, run the established Parcel production build, validate its output, and deploy that known-good version through the separately approved production procedure. Firebase Hosting release history may provide an additional rollback mechanism, but the operator must verify the intended site and release before changing the live channel. Preserve logs and record the failed release, symptoms, time, and rollback outcome.

Stage 9 itself needs no live rollback because it does not change the live Hosting channel. Its preview can be allowed to expire or explicitly removed later through an authorized channel-management action.

## Non-Changes

Stage 9 does not remove Parcel or legacy pages, change the live Firebase channel, reshape `Issue`, `IssueService`, or `cityvueIssues`, add authentication/backend/API behavior, introduce a future `ServiceRequest` model, change catalog/search/dynamic-question semantics, or begin post-MVP product work.

## Preview Record

Preview channel: `stage9-react`  
Preview URL: `https://cityvue-1--stage9-react-589gstb6.web.app`  
Final preview release: August 29, 2026 at approximately 10:52 PM America/New_York  
Expiration: September 5, 2026 at 10:52:45 PM America/New_York

Hosted UAT passed direct loads and refreshes for all supported routes, the React Not Found route, legacy compatibility mappings, desktop/mobile overflow checks, theme switching, intake create/review/submit, Issue List search, direct-refresh editing and update, Dashboard statistics, and status-filter drill-down. Browser console review found no warnings or errors. Firebase reported an Auth-domain synchronization warning; CityVUE does not use Firebase Auth in this MVP, so it did not affect preview behavior and no Auth configuration was changed.

The synthetic emulator record `Pothole` at `102 Stage 9 Test Way` and synthetic preview record `Streetlight Out` at `202 Preview Test Way` were permanently deleted after UAT. Both origins were verified at zero issues afterward.

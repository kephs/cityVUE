# F059.1 — Reqro homepage: approved composition implementation

Status: **manual visual UAT approved by the product owner**. The currently
displayed and validated F059.1 homepage is the accepted visual implementation.
The product owner authorized staging and one local commit with subject
`feat(home): add configurable Reqro resident homepage`. Push, merge and
deployment remain unauthorized. F059.2 is not started.

## Current request and baseline

This record's current section supersedes the earlier visual implementations
retained below as historical evidence. The latest user request explicitly
authorizes refining the existing uncommitted homepage to the approved mockup.

Verified branch `codex/f059-home-redesign`, HEAD
`fe12baf0dd01d85ba80c655f12cc5f7c6cb6c1b5`, 0 ahead/0 behind local
`main`, empty index. The existing F059.1 changes and supplied assets were
already uncommitted; the worktree was **not clean** at this refinement's start.
No remote fetch or Claude worktree inspection occurred. AGENTS and protocol
remain applicable; frozen staff/admin surfaces are outside this change.

The package was found at `.local-uat/reqro-home-assets-codex/README.md`, rather
than the shorter path in the request. Its production files already existed at
the specified public paths and all 12 SHA-256 comparisons matched the package.
The approved reference at `.local-uat/design-reference/reqro-home-approved.png`
was visually inspected before changes. No mockup, preview sheet or package
README was copied into production.

## Result and configuration contract

Page order: homepage navigation; unchanged eligible F019 Resident Alerts;
scenic hero containing live tagline/headline on the left and configured action
cards on the right; live benefits band; compact footer.

- Desktop cards stack vertically with icon, title/description and semantic CTA.
  Smaller cards place their CTA below the copy. At tablet/mobile widths the
  headline and cards stack above the complete scenic image. Disabled actions
  are filtered and enabled actions sorted by explicit order. Zero actions has
  no action section; 1–6 actions were checked. This latest stack requirement
  supersedes the earlier grid layout requirement.
- Hero uses the supplied 1920×521 scenery at its natural ratio, with no stretch
  or crop. On desktop, a sky gradient and top-edge fade extend it behind the
  live composition. It is decorative by default; configuration can supply
  meaningful alt text. No old routing infographic is mounted.
- Headline segments are React text nodes with a boolean highlight flag.
  No raw HTML is accepted. No secondary hero paragraph/CTA is rendered.
- Header and footer use the supplied white wordmark at natural proportions.
  Public Home/Report navigation comes from configuration. Existing authenticated
  staff entry/sign-in callbacks and protected route behavior remain unchanged.
- Footer alone contains the accessible icon-only theme button. It uses the
  existing shared theme hook without changing shared controls or theme logic.
- Benefits use supplied SVG icons, real headings/descriptions, dividers,
  enabled/order fields, and responsive four/two/one-column layouts.
- Homepage-only layout fills spare shell height with scenery, removing the
  former empty gap before the footer. Content may grow and scroll; nothing is
  clipped to force a one-screen layout.

`homePresentation.js` is the single content boundary consumed through
`HomePresentationProvider`. It supplies brand/logo/wordmark, navigation labels
and destinations, tagline, structured headline, scenic asset and alt behavior,
actions, benefits, footer/optional links, theme-control labels/visibility and
metadata. The supplied emergency/contact values exist only in this configuration
in production source. Their use is explicitly authorized by the latest request;
they are replaceable/disableable defaults, not hardcoded organizational policy.

`presentationPolicy.js` maps icon keys and approved style choices to packaged
assets/tokens. Current approved theme choice is `reqro`; semantic action tones
are `primary`, `danger`, `warning`. Existing shared surface/text/brand tokens
are reused. Unknown style keys fall back safely; no raw CSS or arbitrary remote
asset input is accepted. Packaged local asset paths are restricted to branding.

Action contract: `id, enabled, order, iconKey, title, description, ctaLabel,
actionType, target, tone`. Types are `internal` (root-relative local path),
`external` (HTTPS without embedded credentials), and `phone` (validated
telephone syntax normalized to `tel:`). Invalid destinations are omitted
without reserving a card. External links use ordinary same-tab navigation.
These checks constrain presentation only; they do not replace authorization.

Future published organization configuration can replace the provider input.
No API, database schema, editor, upload, tenant fetching or F059.2 implementation
was added. Future publication still requires its own approved validation.

## Files in the current feature

Modified tracked files:

- `react/src/components/layout/AppLayout.jsx`
- `react/src/pages/HomePage.jsx`
- `react/src/pages/home/Hero.jsx`
- `react/src/pages/home/home.css`
- `react/test/HomePage.test.jsx`

Removed tracked file: `react/src/pages/home/QuickActions.jsx`. It had no remaining
imports and duplicated the emergency/contact defaults in JSX. Removing this
obsolete homepage-only component leaves one source for the configured values;
underlying services and unrelated routes are retained.

Added feature source/test/documentation relative to HEAD:

- `react/src/pages/home/HomeShell.jsx`
- `react/src/pages/home/HomeBenefits.jsx`
- `react/src/pages/home/HomePresentationContext.jsx`
- `react/src/pages/home/ResidentActions.jsx`
- `react/src/pages/home/PresentationLink.jsx`
- `react/src/pages/home/presentationPolicy.js`
- `react/src/pages/home/homePresentation.js`
- `react/src/pages/home/useHomeMetadata.js`
- `react/test/HomePresentation.test.js`
- `docs/features/F059-1-reqro-homepage.md`

The earlier untracked `HeroArtwork.jsx` was removed; scenery now belongs to
`Hero.jsx`. Legacy Impact Summary/Recent Activity remain in the repository,
unmounted.

Supplied production assets (already present, unchanged by this refinement):

- `react/public/branding/reqro/branding/reqro-wordmark-white-transparent.png`
- `react/public/branding/reqro/branding/reqro-wordmark-navy-transparent.png`
- `react/public/branding/reqro/branding/reqro-mark-transparent.png`
- `react/public/branding/reqro/hero/reqro-home-background.png`
- `react/public/branding/reqro/icons/actions/action-report.svg`
- `react/public/branding/reqro/icons/actions/action-emergency.svg`
- `react/public/branding/reqro/icons/actions/action-water.svg`
- `react/public/branding/reqro/icons/benefits/benefit-residents.svg`
- `react/public/branding/reqro/icons/benefits/benefit-responsive.svg`
- `react/public/branding/reqro/icons/benefits/benefit-operations.svg`
- `react/public/branding/reqro/icons/benefits/benefit-community.svg`
- `react/public/branding/reqro/icons/ui/ui-theme-moon.svg`

This inventory includes **12** supplied production assets (three
branding, one hero, three action, four benefit and one UI icon); all match the
package. The earlier supplied symbol and routing hero remain untouched,
untracked inputs and are not used by the current homepage.

## Validation and visual differences

Focused command:
`node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 react/test/HomePage.test.jsx react/test/HomePresentation.test.js react/test/NavigationDesign.test.jsx react/test/ResidentAlertBanner.test.jsx`.

Initial focused run: **4 files / 51 passed**, 20.46s. Final focused run after
layout/local-favicon changes: **4 files / 51 passed**, 21.22s. Neither had
failures/skips. These are overlapping runs, not 102 distinct tests.

Shared theme preference check:
`node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test test/ThemePreferences.test.js`
passed **7 tests**, no failures/skips. These are separate Node tests, not added
to the full React total.

Production command:
`node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir`.
Initial and final builds passed (exit 0). Existing >500kB chunk warning remains,
with main about 547kB and map worker about 1031kB. No dependencies changed.

The browser harness's initial enlarged-text screenshot was captured before
lazy-route completion. After fixing that wait, a real 360px/200% text overflow
was detected. The implementation now allows long words to wrap and bounds
decorative benefit icons; the focused overflow diagnostic reports no elements
outside the viewport. Earlier incomplete evidence is not a pass for enlarged
text. Final browser result is recorded below.

Final browser run: **12 homepage cases and 84 action-count cases passed**, with
no page errors. Widths: **360, 480, 720, 900, 1200, 1440px**, each in **light and
dark** themes. The image ratio remained 1920:521; there was no horizontal
overflow, no hero/benefits gap and no benefits/footer gap. Default 1200/1440px
pages fit a 900px-tall viewport. Keyboard menu Enter/Escape, Report Issue routing
and existing shell restoration, 360px/200% text, 720×450 short-height reflow,
image failure and forced-colors focus checks passed. The 720px check represents
reflow at the effective width of a zoomed desktop, not native browser zoom UAT.
Cards also use a rem-based container query to stack their contents when enlarged
text would crowd a side-by-side layout. Final evidence replaces the earlier
incomplete enlarged-text capture.

Full React command:
`node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1`.
**820 passed / 1 failed / 821 total**, 55 files passed / 1 failed / 56 total,
401.49 seconds, exit 1; no skipped tests. The unchanged
`IssueCreation.test.jsx:132` External Redirect test timed out at 5,000ms. The
same test failed during the preceding refinement and its isolated diagnostic
rerun (retained below). No further identical rerun was needed. No assertions,
timeouts, frozen source or unrelated tests were changed. This is **not a clean
full-suite pass**. The prior staff narrative failure did not reproduce in this
full run; the historical failure remains recorded. Final homepage layout and
favicon refinements were independently covered by the focused/browser/build
checks above; the full suite began before those refinements and the removal of
the unreferenced legacy QuickActions component.

`git diff --check` passed. Protected staff/admin/auth/alerts/theme/backend scopes
and package manifests/lockfile have no diff. No frontend lint script exists;
no lint result is claimed. Build output contains no asset-package README,
design-reference directory, preview sheet or flattened mockup.

Known visual differences from the mockup:

1. The supplied wordmark has a blue/green symbol, not the white/green symbol in
   the mockup, plus a faint outline artifact at its top/left edge. Its approved
   bytes are preserved; no recoloring or reconstruction was attempted.
2. Supplied benefit-responsive SVG is a radial symbol rather than the mockup's
   gear. Production icons are used exactly as supplied.
3. Scenic production image has a wider aspect ratio than the mockup's hero.
   The complete image stays undistorted; a sky gradient/fade supplies the upper
   desktop area. Tablet/mobile deliberately show the complete scenery below
   the foreground content. Text wraps naturally instead of matching a flattened
   reference at every width.
4. Dark theme uses shared dark card surfaces while retaining the bright scenic
   background and legible navy/blue heading. Short displays/enlarged text scroll.

No live calls, database mutations, alert authoring or auth bypass were used.
Telephone URLs were inspected but **not activated**. Screen-reader and live
authenticated staff UAT remain manual; automated checks are not WCAG certification.

## Manual visual UAT

Preview: `http://127.0.0.1:5175/`.

Evidence directory: `.local-uat/approved-screenshots/`, with
`home-{360,480,720,900,1200,1440}-{light,dark}.png`,
`home-360-text-200.png`, `home-720-short-height.png` and
`image-failure-forced-colors.png`. Logs/results remain ignored in
`.local-uat/approved-*.log` and `approved-visual-results.json`.

Review the desktop composition against the approved reference; inspect the
wordmark/icon differences, headline emphasis, card prominence, benefits
dividers and compact footer. Check all six widths in both themes, keyboard
focus/menu behavior, zoom/enlarged text and shorter-height displays. Verify
Report Issue opens the existing report page. Review telephone destinations
without placing a test emergency call. Confirm normal authorized staff access
and existing F019 notice behavior through their established UAT procedures.

**Manual visual UAT approved.** Separate explicit authorization permits staging
and one local commit only. Stop after that commit; no push, merge, deployment or
F059.2 work. The validation results above are preserved, including the full
React suite's unchanged Issue Creation timeout.

Commit packaging includes the referenced white wordmark, mark fallback, scenic
background, action/benefit/theme SVGs, implementation, tests and this record.
The favicon is already tracked in the baseline. The unused navy wordmark,
earlier routing hero and earlier symbol input remain untracked and excluded.
No `.local-uat` file is tracked or included; design references, screenshots,
local visual scripts and package README material are excluded.

---

# Historical implementation records (superseded presentation)

The records below preserve earlier commands/results and rejected or refined
presentation states. Their component/asset/layout descriptions are historical.
# F059.1 — Reqro resident homepage

Status: visual refinement implemented after first-pass UAT feedback; current
validation record below. Manual visual UAT is **not approved**. Not accepted,
staged, committed, integrated or deployed. F059.2 remains deferred.

## Baseline and scope

Started on `codex/f059-home-redesign` at
`fe12baf0dd01d85ba80c655f12cc5f7c6cb6c1b5`, 0 ahead/behind local `main` and
last-known `origin/main`. Tracked tree and index were clean. The only untracked
inputs were the supplied transparent symbol and hero artwork. No remote fetch
or inspection of Claude's rejected worktree occurred.

The user authorized a new homepage, replacing its legacy presentation, with
unchanged backend, authorization, routes and frozen staff/admin screens.
Only `/` selects the new header and footer; all other shell branches remain
unchanged. The old Impact Summary and Recent Activity are no longer mounted on
Home; their components, underlying services and routes are retained.

## Presentation and assets

The trusted local `homePresentation.js` provides brand identity, intrinsic logo
dimensions, local image paths, live tagline/content/CTA, navigation copy, Resident
Actions and their heading, benefits and footer copy. `HomePresentationProvider`
supplies one value to the homepage header, body and footer via `AppLayout`'s
`homepagePresentation` input. A synthetic component test replaces the whole
presentation through that input. It does not access Admin configuration, storage,
a public branding API or remote assets. This is a future F059.2 input boundary,
not its implementation. Theme control behavior remains the shared component.

Approved assets must retain their exact bytes:

| Asset under `react/public/branding/reqro/` | SHA-256 |
| --- | --- |
| `reqro-logo-dark.png` | `51e67e1d0d8152a26342fcb92b287197d0cc98c2dec62f5427390784817ba482` |
| `hero/reqro-home-hero.png` | `2f827fbe8f6c48ee87e8c9a5fec285147b55c6bc61eb000829d5035addc39a29` |

The original supplied `reqro-logo-transparent.png` is a symbol only. During
refinement the user supplied the existing full light/dark wordmark paths in
response to clarification. Home now uses the dark full wordmark unchanged,
including its supplied dark background. No transparency, recoloring or wordmark
reconstruction is performed. The earlier symbol input remains untouched.

Current sequence: navigation, eligible F019 alerts, compact semantic intro,
Resident Actions, full-width artwork, blue benefits, footer. The intro uses two
columns on wide screens and stacked flow below 960px. The exact artwork uses
intrinsic dimensions, width 100% and height auto, with no cropping, transforms,
redrawing or overlays. The former caption and repeated six-service list are
removed, including their spacing. Alternative text describes the resident,
routing hub and all six services. The diagram is never reconstructed in HTML.

The exact tagline is `People ● Requests ● Progress`: navy live words with
prominent green decorative separators. The compact intro retains a light
readable surface in both themes; cards, footer, navigation and benefits honor
the theme. This is intentional, not image recoloring. The footer tagline is
exactly `Built for Today. Ready for a Stronger Tomorrow.` Homepage title,
description and favicon are restored on unmount.

## Actions, navigation and alerts

Only Report a Concern is enabled by default. The existing `/track` page requires
a bearer tracking link and has no generic code-entry UI, so Home does not invent
a tracking flow. No client contacts or emergency numbers are introduced.

Disabled actions are filtered before rendering. Zero means no section; one
and two are bounded/centered, three use equal columns, four use four columns
at 1200px and above or two below, and five or more wrap into centered rows.
Below 576px every action is one column. Action-count layout tests use synthetic
presentation fixtures and do not introduce new destinations or live data.

Anonymous homepage navigation contains Home, Report a Concern, theme controls
and existing sign-in when enabled. The authenticated Service Requests entry
retains the existing `enabled && isAuthenticated` visibility rule and points to
the existing protected destination. This is not a new permission check or an
authorization grant. Existing staff navigation is retained on staff routes.

F019 `ResidentAlertBanner` remains above the hero without an outer spacing
wrapper. Its API, repository, eligibility/order, refresh/expiry, failure and
announcement behavior are unchanged. Empty results reserve no space.

## Validation and UAT

Required automated checks: focused Home/Navigation/F019 React tests, full React
suite, production build and `git diff --check`.

Responsive matrix: 360, 480, 720, 900, 1200 and 1440px, light and dark. Verify
full artwork visibility/aspect ratio, horizontal overflow, readable live text,
CTA/focus, logo, action counts 0–6, benefits and deliberate spacing. Also check
keyboard/mobile menu, text enlargement, image failure, existing alert variants
and route-scoped shell/metadata restoration. Synthetic browser evidence is not
authenticated staff UAT or manual visual acceptance.

Manual reviewer must accept the complete new page and the supplied-artwork
mobile presentation before staging or integration. Do not stage, commit, push,
merge or deploy as part of this task.

## Validation record — 2026-10-02

**Historical first-pass evidence.** The subsequent refinement record below
supersedes this section for current execution results, without erasing failures.

No installed dependencies were present in this worktree. Installed the existing
root lockfile using npm 10.9.9 with `ci --ignore-scripts --no-audit --no-fund`;
no manifest/lockfile changes. An initial npm 12 tooling attempt was incompatible
with bundled Node 20.20.2 and did not install the project. Installation warned
that the existing transitive `@mapbox/jsonlint-lines-primitives` requests Node
22+. This feature introduces no dependency.

The available Node executable invoked the repository script entry points:

- Focused: `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1 react/test/HomePage.test.jsx react/test/NavigationDesign.test.jsx react/test/ResidentAlertBanner.test.jsx`.
  Initial sandbox invocation: 2 files / 13 tests passed, but the Home worker
  failed to start (worker response timeout; exit 1). Unchanged retry outside the
  sandbox: **3 files / 29 tests passed**, no failures or skips, 25.17 seconds.
  The retry does not erase the initial worker failure.
- Production: `node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir`.
  **Passed**, including a final rebuild after visual corrections. Existing
  large-chunk warning remains (main about 545 kB; map chunk about 1,031 kB).
- `git diff --check`: **passed**; Git emits normal LF-to-CRLF notices.
- Full React suite: `node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1`
  outside the sandbox: **796 passed / 3 failed / 799 total**, 52 files passed /
  3 failed / 55 total, 438.37 seconds, exit 1. No skipped tests reported. This is
  **not a clean full-suite pass**. Failures in unchanged staff/admin tests:
  - `IssueCreation.test.jsx`: F056.5 Handling follows Availability — 5,000ms timeout.
  - `StaffRequestWorkspace.test.jsx`: F041 Notes response 404 — parent heading
    was still present at the final synchronous assertion.
  - `WorkspaceRefinement.test.jsx`: F058.2B mobile cards — `change is not a function`
    when invoking the test's captured media listener.
  These files directly exercise unchanged staff/admin components, not the
  homepage. No timeout, assertion, test selection in the full run, or application
  behavior was changed to hide these failures.
- Focused diagnosis, same runner and worker count, restricted to the three failing
  test names in those files: **2 passed / 1 failed / 195 deliberately filtered
  skips**, 17.83 seconds, exit 1. The Issue Creation timeout and media-listener
  error did not reproduce. The Notes 404 assertion reproduced at line 460 and
  remains unresolved in its unchanged frozen-workspace test/implementation.
  This is supplemental evidence only, not a full-suite pass or proof of a
  production authorization defect. Separate investigation is recommended;
  no frozen staff code or tests were altered. Log: `.local-uat/focused-diagnostics.log`.

Headless Microsoft Edge against the local Vite server verified **12 homepage
cases** (six requested widths in both themes) and **84 synthetic action-layout
cases** (counts 0–6 at each width/theme). Every homepage image was full viewport
width at the 1672:941 natural ratio; every case had no horizontal overflow.
Verified expected action row counts, centered first rows, no zero-action section
and all-disabled omission. Reviewed full-page screenshots across the matrix,
including mobile readability, logo backing, headline scale and benefits layout.

Additional browser checks passed: keyboard menu Enter/Escape, 200% text at 360px,
CTA navigation to `/report`, restoration of its existing shell and removal of
the homepage favicon, image-failure retention of heading/CTA/service caption,
visible keyboard focus and forced-colors control borders. No page errors in the
completed matrix. The local harness initially needed CommonJS module interop
and a wait for lazy route completion; these were harness corrections, not
application failures or changed test expectations.

Evidence is local and ignored under `.local-uat/`: `visual-results.json`,
`screenshots/`, `build.log` and `full-react.log`. No credentials, live request
mutations, alert authoring, database access or grant changes were used. Browser
fixtures are not production configuration and are not included in feature files.

Both approved asset hashes match the pre-edit inventory. Staff/admin/auth/alert
implementation, shared theme tokens, backend, package definitions and lockfile
have no diff. Existing staff-shell navigation regression tests passed. Live
authenticated staff UAT and screen-reader UAT were not performed.

## Review notes and files

The current dark full wordmark is supplied artwork, including its background;
its pixels are unchanged. On narrow screens the complete hero image is
necessarily reduced; descriptive alt text preserves equivalent routing meaning.
The supplied 1672px master has no higher-density variant; no generated or
substituted hero is used. These are explicit manual visual review considerations.

Changed: `AppLayout.jsx`, `HomePage.jsx`, `home/Hero.jsx`, `home/home.css`,
and `HomePage.test.jsx`. Added under `home/`: `HomeShell.jsx`, `HomeBenefits.jsx`,
`ResidentActions.jsx`, `homePresentation.js`, `useHomeMetadata.js`,
`HomePresentationContext.jsx`, `HeroArtwork.jsx`; added this
feature record. The two supplied assets remain untracked inputs pending the
user's separate staging approval. No other source files are changed.

Manual review: open `http://127.0.0.1:5175/` while the local preview runs. Review
the complete page in both themes and the screenshot matrix; specifically accept
the full wordmark, earlier actionable cards, direct artwork-to-benefits transition,
single enabled default action and light intro in dark mode. Approval does not
itself authorize Git integration.

First-pass state (historical): homepage implementation and its focused/visual checks are complete,
but repository-wide validation is **not clean** because of the failures recorded
above. HEAD remains the starting checkpoint, index is empty, and all changes
remain unstaged. No staging, commit, push, merge, deployment or F059.2 work.

## Refinement validation — 2026-10-02

The refinement uses the supplied dark full wordmark, a compact intro followed by
Resident Actions, then full-width artwork directly adjoining the benefits band.
The duplicate visible caption/service list is removed; the image alternative
retains the routing meaning. All homepage copy/assets flow through one
presentation provider. The footer uses the exact approved tagline.

- Focused command recorded above: **3 files / 31 tests passed**, 11.60 seconds,
  exit 0, no failures or skips. Includes replacement configuration across the
  header, content, footer and metadata, plus revised section order.
- Production build command recorded above: **passed**, exit 0. Existing large
  chunk warnings remain; no package or lockfile changes.
- Full React command recorded above: **799 passed / 2 failed / 801 total**,
  53 files passed / 2 failed / 55 total, 512.58 seconds, exit 1. No skips.
  The unchanged `IssueCreation.test.jsx` External Redirect test timed out at
  5,000ms (line 132). The unchanged `StaffRequestWorkspace.test.jsx` narrative
  403 test still found the disabled draft textbox at its synchronous removal
  assertion (line 1957). This is **not a clean full-suite pass**.
- Supplemental rerun of those two exact test names, same runner/worker count:
  **2 failed / 155 deliberately filtered skips**, 14.73 seconds, exit 1.
  Both failures reproduced. No assertions, timeouts or frozen source/tests were
  changed. These findings require separate investigation; they are not proven
  to be harmless flakes. Log: `.local-uat/refinement-diagnostics.log`.
- `git diff --check`: **passed**. The index is empty; protected source scopes,
  dependencies and supplied artwork hashes remain unchanged.
- Responsive browser checks: **12 homepage cases and 84 action-layout cases
  passed**, covering 360/480/720/900/1200/1440px in light and dark themes,
  action counts 0–6 and disabled-action omission. No page errors or horizontal
  overflow. Artwork retains its natural ratio and has zero gap to the benefits.
- Keyboard menu, route navigation, 200% text, image failure, visible focus and
  forced-colors checks passed. These are not WCAG certification or screen-reader
  UAT. Frozen staff surfaces and live authenticated UAT were not exercised here.

With no eligible alerts, the default action card's bottom was approximately
714/687/682/690/627/666px from the top at the six widths respectively. Alert
content can increase these positions; these measurements do not promise all
content above the fold at every viewport height.

Evidence remains ignored in `.local-uat/`: `refinement-focused.log`,
`refinement-build.log`, `refinement-full-react.log`,
`refinement-visual-results.json`, and `refinement-screenshots/`. Screenshots
were reviewed across all six widths in both themes. The full wordmark retains
its original visible navy backing; the narrow hero's raster labels are small,
with equivalent meaning supplied by the alternative text.

Manual visual UAT remains **not approved**. Review the logo, compact first screen,
card prominence, artwork transition, both themes and exact footer in the local
preview. Nothing is staged, committed, pushed or merged; F059.2 is not started.

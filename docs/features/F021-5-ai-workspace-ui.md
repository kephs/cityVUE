# F021.5 — CityVUE AI Workspace UI

**Date:** 2026-09-13. **Baseline:** `e9bd534caee725ea0400dc338bbe59b75930c67d` on main, initially clean.
**Status:** UI and approved circular branding implemented and validated. This feature does not enable live AI.

## UI and shared shell

Add AI Workspace (`/staff/ai`) to the existing PrimaryNavigation list. All React shared-layout pages receive the same item, active styling, mobile menu handling, theme toggle and existing staff identity controls. The dormant legacy Parcel application is unchanged. Existing navigation has no permission list or permission-aware visibility architecture; the entry is discoverable to all users but cannot grant access. The unchanged Entra-only route guard and server metadata authorization determine workspace admission. Rejected or unconfigured users never receive the assistant controls or an Authorized status.

The authorized UI uses CityVUE's existing shared header, Bootstrap blue, theme tokens, card radius, focus styles and responsive layout. It includes the AI Workspace heading/tagline, City AI Assistant (Staff), internal navigation, task examples, New Conversation, disabled model/composer/Send, status card, privacy notices, responsible-use guidance and verification disclaimer. Guidelines, privacy, governance and help open an informational section with a focused heading. Example Prompts is a working page anchor.

Example buttons preview only fixed example text in the disabled textarea. New Conversation clears that local preview and explicitly states no conversation was created. No input content is submitted, logged, stored or simulated as an AI response. The local view unmounts on sign-out/authorization denial and is keyed by account identity. Metadata cannot enable Send or model execution even if future backend fields claim availability.

## Branding asset requirement

The approved visual reference is `docs/design/cityvue-ai-workspace-approved-mockup.png`. Its blue shared shell, workspace navigation, central assistant/tasks/composer and right-hand status/responsible-use panels guide this implementation. Existing CityVUE navigation and theme behavior are retained; unrelated navigation destinations pictured in the mockup are not added.

The approved circular artwork is `react/public/branding/city-of-rockville-logo-circle.jpg`, served at `/branding/city-of-rockville-logo-circle.jpg`. It appears at the bottom of the workspace navigation, with accessible alt text “City of Rockville — Rise Together”. Its native 182 × 196 aspect ratio is preserved with automatic height and a maximum display width of 140 pixels. A white backing preserves the original artwork in both themes. The incorrect homepage screenshot asset was removed; the logo is neither regenerated nor cropped.

## Responsive, theme and accessibility validation

Headless installed Edge rendered an isolated temporary UI test fixture using the real shared AppLayout, ThemeProvider and AIWorkspaceView with synthetic authorized metadata. No authentication bypass, new application route or test fixture was added to the production application. The temporary fixture files were removed after checks.

Screenshots were captured and inspected at 390, 768 and 1440 CSS pixels in light and dark themes. All six cases had no horizontal overflow and Send disabled. Additional checks passed at 320 pixels, including mobile menu visibility, informational heading focus, local example/reset behavior and zero API calls from the presentation fixture. Screenshots are available locally as `%TEMP%/cityvue-ai-ui-{width}-{theme}.png`; they show the approved circular artwork, with its intrinsic aspect ratio checked in every viewport/theme combination. Full browser zoom and live Entra UAT are not claimed.

The sidebar reflows on small screens; task/status cards stack on phones, support panels move below the assistant at tablet sizes. Semantic headings, named navigation landmarks, native buttons, visible focus styles, labelled disabled controls, a polite preview announcement, text-based disabled status and logo alt text are preserved. Colors inherit the application's existing light/dark Bootstrap tokens, with a white logo backing for the supplied artwork.

## Security and scope

F018/F020/F021 backend code, RBAC, Entra configuration, provider registries, generation gates, migrations and permissions are unchanged. Only authenticated server-authorized metadata produces the full view. AI remains disabled by default; no live provider, provider credential, generation endpoint, content persistence or raw content logging is added. Public resident behavior is unchanged except for the explicitly requested shared navigation entry. No new dependency, deployment or F022 implementation.

## Validation results

- React: 116 tests across 16 files passed; zero failed/skipped. Includes route guard/denial, shared navigation and active states, local preview/reset, guidance focus, theme toggle, logo alt, safe model projection and permanently disabled execution.
- Final circular-branding validation repeated the regression checks and all six responsive/theme cases. An earlier concurrent run had one existing ReportIssuePage test exceed its 5-second timeout; the standalone rerun passed all 116 without changing tests or timeout settings.
- Backend unit: 106 passed; E2E: 29 passed; zero failed/skipped.
- Shared/legacy: 62 passed; zero failed/skipped.
- Server TypeScript, ESLint, Prettier check and build: passed.
- React production build: passed; existing >500 kB chunk advisory remains (542.31 kB main chunk).
- No root frontend lint/typecheck/format script is configured; frontend compilation is covered by Vite/Vitest and styles follow existing conventions.
- Database suites were not repeated: no backend/schema changes in this UI feature.

Live Entra UAT remains pending administrator consent; the browser fixture validates presentation only, while React/backend regressions validate authorization behavior. Security dependency disposition remains the existing SEC-001 follow-up; no lockfiles changed.

## Files

- `react/src/components/navigation/PrimaryNavigation.jsx`
- `react/src/ai/AIWorkspacePage.jsx`
- `react/src/ai/AIWorkspaceView.jsx`
- `react/src/ai/aiWorkspace.css`
- `react/test/AIWorkspacePage.test.jsx`
- `docs/features/F021-5-ai-workspace-ui.md`

## Git scope

The commit contains only the six feature files above and the following approved assets:

- `react/public/branding/city-of-rockville-logo-circle.jpg`
- `docs/design/cityvue-ai-workspace-approved-mockup.png`

Commit message: `feat(ai): integrate staff AI workspace into CityVUE UI`. No deployment or F022 work is included.

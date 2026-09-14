# F021.6 — AI Workspace Stakeholder Preview

**Date:** 2026-09-13. **Baseline:** main `1a3dd25776b766d2b2e93ba2dbe54b209015fa00`, initially clean.

## Objective

Let City leadership, Cybersecurity, Infrastructure and other stakeholders review the approved F021.5 interface while Entra administrator consent, live identity UAT and provider approval remain pending. This is a presentation-only feature, not approval for production AI or deployment.

## Routes and security separation

`/ai-preview` is a separate public route using the existing App shell and AIWorkspaceView. AIPreviewPage passes only the explicit presentation flag; it imports no repository, identity, token, City data or execution module. All demo labels are frontend-owned and non-sensitive. No backend model is registered.

AuthRoot moves from the bootstrap wrapper to the existing normal application route tree. Every existing route retains that provider; `/staff/ai` retains the exact `<StaffRouteGuard requireEntra>` wrapper and AIWorkspacePage server-permission check. The preview is a sibling route outside AuthRoot, so it neither initializes MSAL nor inherits authenticated identity or staff header actions. Leaving the normal route tree unmounts its auth provider and existing token-provider cleanup runs. Returning mounts normal authentication again; this does not sign the user out of Entra or erase its cache. No guard, token validation, configuration, server RBAC, quota or audit implementation changes.

There is no fallback from `/staff/ai` to preview. Direct unauthenticated access still displays the existing denial/sign-in state. Authenticated users without server permission still receive the existing safe denial.

## Navigation and interaction

The shared AI Workspace navigation item targets `/ai-preview` for everyone during evaluation. This intentionally avoids inferring authorization from a browser account. Active styling and mobile navigation reuse the existing NavLink behavior. Staff can still navigate directly to `/staff/ai` subject to existing controls.

A prominent Demonstration Mode notice appears above the page heading. Stakeholder Preview and Preview Only labels, a demo-only model, no authentication requirement and disabled data transmission replace claims of staff authorization. The approved circular Rockville logo and F021.5 design remain unchanged.

Reviewers can type in the labelled textarea, choose fixed example prompts and clear the in-memory draft with New Conversation. The model is an inert display selector; Send always remains disabled with an explicit explanation. There is no form submission, response simulation, generation callback or execution dependency.

## Privacy and network isolation

Prompt state lives only in the presentation component's React state and is discarded on unmount or refresh. No preview code writes localStorage, sessionStorage, IndexedDB, logs, database, usage or audit records. Autocomplete and spellcheck are disabled for the textarea. The existing theme toggle may store the theme preference; it never receives prompt content.

Automated route tests spy on the AI repository and verify the preview does not initialize MSAL or read auth configuration, even with a synthetic signed-in account available. Interaction tests reject fetch, XMLHttpRequest, storage writes and console logging. Browser verification additionally trapped fetch, XHR, sendBeacon and IndexedDB access, inspected requests/logs/storage, and confirmed the draft disappears on refresh. No AI, staff, City-system, model/provider, usage/audit or identity requests occurred. Normal static page/assets and Vite development transport are outside the no-API assertion. With no persistence or API path, preview input cannot reach usage/audit tables. No database code changed.

## Responsive and accessibility validation

The real `/ai-preview` route was rendered in headless installed Edge at 390, 768 and 1440 CSS pixels in light and dark themes. All six cases had no horizontal overflow, an undistorted 182:196 logo, readable banner, labelled editable prompt, inert model selector and disabled Send. The banner starts within the initial desktop viewport. Screenshots are stored locally at `%TEMP%/cityvue-preview-{width}-{theme}.png`.

Existing semantic headings, named navigation, visible focus and theme tokens remain. The banner uses a status announcement; disabled behavior is stated in text. Guidance navigation moves focus to its heading. The browser check confirms `/staff/ai` still denies unconfigured access without rendering the preview. Live Entra UAT and a full assistive-technology audit are not claimed.

## Validation

- React: 123 tests across 17 files passed; zero failed/skipped. This adds six preview/security tests and one navigation case to F021.5's 116 tests.
- Backend unit: 106 passed; E2E: 29 passed; shared/legacy: 62 passed; zero failed/skipped.
- Server TypeScript, ESLint, Prettier and backend build: passed.
- React production build: passed; existing large-chunk advisory remains (542.57 kB main bundle). No separate frontend lint/typecheck/format scripts exist.
- Actual route: six viewport/theme checks passed without horizontal overflow. Built-preview checks additionally passed dark-logo rendering, mobile navigation, keyboard focus, shared theme toggle and absence of API requests.
- The first React run caught a demo-label encoding error, which was corrected, and three existing intake tests timed out during concurrent browser work. The final standalone run passed all 123 without changing timeout settings.
- Database suites were not repeated: backend/schema files are unchanged. Live Entra UAT remains pending City administrator consent.

## Exit Criteria

Reconsider or remove preview mode once all of the following hold:

- Microsoft Entra administrator consent is complete.
- Live Entra UAT passes.
- The City approves the AI provider architecture.
- `/staff/ai` becomes the approved staff navigation destination.

At that separately approved transition, switch the navigation target back to `/staff/ai`, remove the public route and preview-only component behavior if no longer needed, and retain protected-route and authorization regressions. Do not convert the preview into an execution route. No deployment, provider connection, credentials, production AI execution or F022 work is included here.

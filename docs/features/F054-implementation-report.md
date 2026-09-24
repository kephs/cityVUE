# F054 implementation report

Status: implementation, automated validation, authenticated UAT, logging privacy and audit reconciliation passed. Starting synchronized `main`: `94a1bd54c9b7e7ca45df62e65f7a78d3746cd901`. No push, deployment or F055.

## Approved assets and scope

User supplied nine canonical PNG/ICO files and two supporting README files in `react/public/branding/reqro/`. These are explicitly approved product assets. Their hashes match the pre-implementation baseline; no redraw, regeneration, substitution or byte modification occurred. PNG metadata checks found no EXIF/XMP. The later user direction supersedes the original trademark notation: Reqro, with neither trademark symbol. Exact tagline and primary message are centralized in `ReqroBrand.jsx`.

The authoritative `/admin` now uses the preview's header/sidebar/grouped-navigation/card language while retaining only real configuration content and routes. `/admin-preview` implementation/data remains unchanged. Other staff/resident pages and technical CityVUE identifiers remain outside scope. Admin-only title/favicon restore on exit; app-icon files are available assets, not a new PWA/manifest implementation.

## Branding model and security

See [ADR-015](../architecture/decisions/ADR-015-product-organization-branding.md) and the [specification](F054-admin-portal-branding-foundation.md). One Organization-owned row contains nullable display name/tagline/fixed logo key, independent positive revision and timestamps. Null branding is REQRO_DEFAULT; Organization mode requires a name. Text bounds are 100/140 characters. No HTML/CSS injection or arbitrary style values. A database trigger owns meaningful revision increments; no-op/GET/clear semantics preserve history and unrelated resources. New Organizations initialize the same default.

The existing read-only repeatable-read Admin snapshot adds one indexed branding query and safe health/projection. Admin read permission and server-resolved Organization remain mandatory; no new public tenant metadata endpoint, permission, write route or branding-management UI. Unknown paths/URLs cannot be turned into image requests. Only the fixed `example-organization` key maps to a packaged generic fictional raster fixture. That 96×96 E mark is intentionally public/distributable test data and contains no tenant identity or EXIF/XMP. It is separate from canonical Reqro imagery. Private F046 storage is not reused; no uploaded bytes, SVG sanitizer, arbitrary file reader, remote fetch or CSP change is introduced. Production logo upload/storage remains deferred.

Missing custom logo uses the approved product mark, missing tagline leaves no empty placeholder, invalid missing name uses Reqro fallback, failed configured logo preserves safe text plus product mark, and product-image failure leaves visible Reqro text. Product text remains while optional Organization identity appears with Powered by Reqro. Organization data is in memory, cleared during refresh/denial/client changes, with no new persistence. No instantaneous erasure claim for already authorized browser disclosures.

## Provisioning and migration

`dev:branding` follows existing CLI conventions. Explicit NODE_ENV=development, CITYVUE_DEPLOYMENT_PROFILE=development, F054_FICTIONAL_DATA_ONLY=true, validated personal localhost reqro_dev and existing development Organization are required. Commands: status; set/clear with --dry-run or --confirm. Set uses F054_DISPLAY_NAME, optional F054_TAGLINE and optional fixed F054_LOGO_KEY; set/clear require F054_EXPECTED_REVISION. Output contains operation/revision/presence only, not configuration bodies. Dry-run makes no changes. Concurrent/stale expected revisions fail; no-op stays unchanged. CLI provisioning does not fabricate authenticated administrator attribution or reuse collection-change audits. Production branding writes need a separate narrow permission and F053-style transactional safe audit.

Migration `20261001000000-add-organization-branding` passed disposable apply/down/reapply and preservation checks, then was applied to the personal development database. No prior resources/grants were altered by migration. Meaningful retained branding/revisions prevent destructive rollback. Current development state: 31 applied migrations / zero pending; REQRO_DEFAULT at branding revision 3 after the normal development set/clear lifecycle.

## Automated evidence

| Check                         | Result                                                   |
| ----------------------------- | -------------------------------------------------------- |
| Backend unit                  | 242 passed                                               |
| API E2E                       | 40 passed                                                |
| PostgreSQL                    | 266 passed, zero skips                                   |
| Shared                        | 64 passed                                                |
| React                         | 537 passed, 38 files                                     |
| Focused Admin/branding/F053   | 28 passed again after final navigation-focus correction  |
| TypeScript / test compilation | Passed                                                   |
| Backend production build      | Passed                                                   |
| Backend ESLint                | Passed after four initial style/type findings corrected  |
| Full server formatting        | Passed                                                   |
| Frontend build                | Passed, existing large-chunk advisory                    |
| Frontend lint                 | No configured script                                     |
| Live branding/responsive UAT  | Passed; Passed; logging PASS; audit additions reconciled |

Full suite total: 1,149 passes. Existing F052 health-order assumption was preserved by appending branding health; new synthetic Organization fixture was corrected to include required short name/timezone. Final full PostgreSQL run passed without weakened assertions/skips. Tests cover isolated projections, default/new-Organization initialization, revision/no-op/clear/concurrent behavior, unknown logo keys/paths, XSS text escaping, fallback/broken images, authorization, no branding mutation route and preservation of F053 audits/grants/requests. Existing F039–F053 regressions all passed. Native mobile navigation and visual layout require live checks; no WCAG certification claimed.

## Authenticated live evidence

The developer-launched API ran outside the restricted sandbox, preserving normal Entra signing-key retrieval. Existing normal sign-in and Admin grants were used. No token was inspected/copied and no grant was changed. Reqro default rendered on all six real pages, normal CLI dry-run/confirm configured the fictional long-name/tagline/logo at revision 2, and normal clear dry-run/confirm restored Reqro default at revision 3. Refresh observed both changes without another API restart.

All six routes (Overview, Issues, Intake Settings, Participation Areas, Analytics & Privacy, Configuration Status) passed 1440, 1280, 1024, 768 and 390 widths in light and dark themes. DOM checks found no horizontal overflow or broken branding images; representative desktop/mobile screenshots were reviewed inline and not saved. Expanded mobile navigation also stayed within the viewport. Long Organization text wrapped. Mobile disclosure, selection/heading focus and Escape/button focus passed. Theme remained shared; Staff workspace navigation restored the existing staff title and removed the Admin shell. The viewport override was reset.

The F053 disable confirmation was opened in both themes at 390, then canceled without submitting. Initial focus was Cancel, keyboard reached the action, Escape restored Save focus, and Cancel change reset the draft. Collection remained Enabled/revision 3 with exactly two original F053 audits. No new collection write was needed: full automated F053 regression covers save, validation, permission separation, stale 409, transaction/audit failure and historical preservation. Unauthorized/cross-Organization branding, denied-refresh clearing, missing/broken assets and XSS cases are automated evidence; no live grant revocation or destructive asset failure was induced. This distinction is deliberate, not a claim of live coverage for those cases.

Default presentation uses Reqro Administration and a compact theme-appropriate mark in the header, the approved dark wordmark and tagline against the navy sidebar, and the approved primary message on Overview. Organization mode replaces only the sidebar identity block with its fixed fictional logo, name, optional tagline and Powered by Reqro. Reqro remains in the header. On mobile that identity block follows the disclosed navigation. Desktop icon-only collapse was optional and is not implemented. No preview sample metrics, charts, activity streams or unimplemented routes were copied. The six pages retain their actual configuration lists, editor and health facts.

## Integrity and completion gates

Read-only comparison after the lifecycle: all original monitored Organization/configuration/request/Contact/Requester/assignment/watcher/Activity/Notes/Communications/attachment/grant rows unchanged; tracking state/timestamps and private file hashes unchanged; canonical asset hashes and deployment privacy threshold unchanged. This covers SR-202609-000013 and its existing participation value as part of the unchanged request table. There are still 13 requests, 1 active and 5 revoked tracking credentials, 3 active areas, collection Enabled/revision 3 and two F053 audit rows. No Requester Tracking operation occurred.

Analytics-read audits increased from 35 to 38, with all original rows retained. User confirmed these were their analytics reads; the additions are reconciled. Normal API log privacy UAT: PASS (user confirmed absent). Safe investigation of the three added analytics audits found participation_read by provisioned staff in the expected development Organization, threshold 5, at 2026-09-24 03:18:12, 03:21:57 and 03:29:08 UTC. After reviewing the timestamps, the user confirmed these were their analytics reads. No identities, response bodies or credential values were inspected. The two ignored comparison artifacts (.local-uat/f054-integrity.cjs and .local-uat/f054-before.json) were physically removed after final comparison and reconciliation. No browser captures, API log captures or temporary uploaded assets were created. The packaged fictional PNG is an intentional repository fixture.

## Review and limitations

This is a development/client-neutral branding foundation, not production Organization branding management. Production requires approved logo governance/storage/serving/retention, image validation and limits, a narrow write permission, management UI, expectedRevision/409 handling, transactional safe audit, CSP review and recovery policy. F054 introduces no upload MIME/byte/dimension limits because there is no upload input; its only configured logo is the fixed 96×96 packaged PNG. Untrusted SVG, external URLs and filesystem paths are unsupported. No arbitrary HTML/CSS, remote tracking pixels, private storage lookup, new permission or default grant is present. Branding cannot select trusted tenant context.

F052 reads, projection/isolation/resource revisions and F053 write contracts remain intact. F039–F053 regressions passed; live original data remained unchanged as above. No F047 search code, F044 tracking code, F046 storage policy, F051 suppression, framework, dependency or deployment configuration changed. The production-build chunk advisory remains; frontend lint has no configured script. No production load benchmark or accessibility certification is claimed.

All required gates passed. Authorized local commit message: feat(admin): add Reqro branding foundation. No push, deployment, client/cloud resource change or F055. Starting/local tracking reference remains 94a1bd54c9b7e7ca45df62e65f7a78d3746cd901; final commit/status is reported in the completion response (the report is part of that commit).

Final review checkpoint: 36 changed/new files; 219 local documentation links resolved; private local configuration/JWT/private-key pattern scan and git whitespace check passed. No runtime client branding or trademark notation was introduced.

Runtime branding search: no Rockville, Rise Together or trademark symbols in authoritative Admin/branding code. Remaining references in AdminPreviewPage are preview-only; AI workspace, home and theme preference references are pre-existing out-of-scope runtime/context. Historical documentation and test fixtures remain intentionally intact. No mass rename was performed.

Changed scope: 36 files across eight governance/specification/report documents, thirteen public asset/documentation files, shared branding component, Admin JSX/CSS and React tests, one migration, development CLI/branding module/types, protected Admin projection, backend tests and the server package script. No dependencies added.

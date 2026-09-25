# F056.4 — Admin Shell & Brand Experience Refinement

Status: COMPLETE LOCALLY — NOT SYNCHRONIZED; automated validation and user-confirmed authenticated UAT/logging gates passed, as recorded in the [implementation report](F056-4-implementation-report.md). Starting synchronized `main`: `bc77d3ac8b9083f1222d2e10ee9745393a98e4f0`. No push or deployment is authorized.

## Scope and structure

Refine the shared Admin presentation, preserving Overview, Issue configuration, Participation Setup, Analytics & Privacy and Configuration Status behavior. Canonical routes remain `/admin`, `/admin/issues`, `/admin/participation`, `/admin/privacy` and `/admin/status`. The existing `/admin/intake` redirect remains. Preview route names do not become new routes.

`AdminConfigurationPage.jsx` retains the existing guarded wrapper, API client, authorized snapshot lifecycle and section components. The header uses existing `--brand-primary` and `--brand-on-primary` tokens, canonical compact Reqro imagery, **Reqro Administration**, **Organization Configuration**, the `/staff/requests` return link, existing `ThemeToggle`, and safe authenticated staff presence. No search control or nonfunctional user menu is added.

The top image remains `reqro-mark-dark.png`, with its original bytes/aspect ratio and `object-fit: contain`. Its box is 5.5rem × 3.5rem (88 × 56 CSS pixels at a 16px root); the padded canonical image's actual mark is approximately 40–48px high. The larger box is necessary to enlarge the mark without cropping/redrawing its supplied canvas. The adjacent title supplies accessible product identity, so the mark is decorative in this location.

## Identity and design-stop decisions

| Stop                | Existing architecture and safe decision                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §14 Role label      | The existing safe projection has no authoritative role label. Omit a role; do not infer Administrator from route access.                                                                                                                         |
| §58 Sign Out        | Admin already returns to Staff Workspace, whose shared navigation owns the existing sign-out action. Preserve that path; add no Admin sign-out implementation.                                                                                   |
| §59 Header identity | Pass only `useAuth().displayName` to the shell. No identity, directory, Graph, Contact or profile-photo fetch.                                                                                                                                   |
| §60 Canonical logo  | Reuse the approved compact dark mark and lower dark full wordmark from `react/public/branding/reqro/`. No replacement, byte edit or client seal.                                                                                                 |
| §61 Short tagline   | `reqroBrand.tagline` in `ReqroBrand.jsx` remains the single product source. Transform its separators for presentation only.                                                                                                                      |
| §62 Long statement  | `reqroBrand.message` remains the single source. No duplicate literal in production rendering or database field.                                                                                                                                  |
| §63 Sidebar scroll  | Keep the existing CSS grid and document content scrolling. A sticky sidebar contains a flex column with an independently scrollable navigation region and non-overlapping bottom brand region. No router/app scrolling architecture replacement. |

All seven decisions can proceed without API, domain or security changes. The display name is the existing AuthContext projection (`account.name`, existing username fallback, otherwise empty) already intentionally rendered in staff navigation. The Admin renderer trims surrounding whitespace and uses `Signed-in staff` only when absent. Initials derive from the first Unicode code point of the first and last whitespace-delimited name parts, uppercased; a single name produces one initial. Initials are decorative. Long names truncate visually with full text retained in the accessible DOM. Identity is not an interactive control, role or authority source. No raw account object, provider identifier, claims, permissions or grants are rendered.

## Sidebar and branding

Preserve Workspace → Overview; Service Requests → Issues / Participation Setup; Analytics & Privacy → Analytics & Privacy; System → Configuration Status. Existing links, icons, `NavLink` current-page semantics, mobile disclosure, Escape restoration and route heading focus remain.

The lower default-brand lockup uses `reqro-logo-dark.png` with actual text **People ● Requests ● Progress**. Green dots use the existing dark-surface `--brand-accent` token, supplied through the sidebar's scoped dark theme. The visual phrase is decorative to assistive technology; an equivalent visually hidden **People, Requests, Progress** phrase is announced once. The existing product image failure fallback and optional Organization branding behavior remain. Organization display name, optional tagline, fixed-registry logo and Powered by Reqro are not rewritten as product branding.

At desktop widths ≥992px, the header is sticky at the top with a 6rem height. The sidebar sticks below it, sized to the remaining dynamic viewport height. Navigation can scroll independently while the lower brand remains visible. Padding protects focus outlines. Main interactive elements and the heading have scroll margins for the sticky header. At heights ≤400px, header/sidebar return to document flow so extreme short-height/zoom conditions cannot trap navigation.

At widths below 992px, header and sidebar return to flow, header controls wrap, and the existing collapsed navigation disclosure remains. The secondary lower brand is hidden to preserve mobile navigation space. Product identity remains in the header. No fixed overlay covers navigation or main content.

## Main brand statement

**Built for Today. Ready for a Stronger Tomorrow.** is actual text in the shared main-content footer on every Admin route. Its 1.1rem, semibold, body-foreground treatment increases prominence over the former Overview-only 0.85rem secondary text. It remains below page content and below headings in the visual hierarchy. The short sidebar tagline is not duplicated in the main footer. No fabricated version, copyright, metrics or client name is added.

## Preserved boundaries

F056.4 does not add City of Rockville branding. Client-specific Organization branding remains separate from Reqro product branding under [ADR-015](../architecture/decisions/ADR-015-product-organization-branding.md). Historical CityVUE repository/runtime identifiers are not renamed; the refined Admin shell introduces no CityVUE product logo or client assumptions.

No migration, API, permission, grant, provisioning, branding persistence or application-data mutation is authorized. Server-side Admin/Organization/scope authorization, protected answers, Requester Contact, INTERNAL requests, Issue configuration, Participation, analytics privacy, health checks, requester tracking and all F056.3 behavior remain unchanged. Existing 25/50/100 pagination and API maximum 100 remain intact. No new logging, storage, identity/photo request, branding endpoint or additional per-route fetch is introduced. Existing static asset loading and existing configuration calls continue.

## Validation and deferred scope

Use protocol-required backend unit, API E2E, PostgreSQL, shared and React suites; TypeScript, configured lint, formatting, builds, whitespace, link and private-data checks. Distinguish synthetic layout checks from authenticated UAT. Required visual matrix: all five routes at 1440/1280/1024/768/390 and a short desktop height, both themes, keyboard/focus, contrast, navigation reachability and logging privacy. Accessibility-oriented validation is not WCAG certification. No production performance claim follows from development checks.

Deferred: `/admin/issues` content redesign, F057 permissions management, users/roles, Entra sync management, global Admin search, AI/model management, content-management additions and client-specific branding redesign. No new dependency, configuration or manual provisioning step is required.

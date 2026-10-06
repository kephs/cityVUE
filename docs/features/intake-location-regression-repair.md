# Issue configuration and resident location regression investigation

Baseline: `0c879ee7535ddbe64050c41d800801478f5bff01`, branch
`codex/intake-location-regression-repair`. Current origin/main was verified by
fetch and ls-remote before implementation. Human UAT passed on 2026-10-06.
The user authorized a focused commit and push of this branch after acceptance;
merge to main and deployment remain unauthorized. At commit preparation, fetched
origin/main is `07c5533217b5575329eda3083bfb1accc1f8a577`, one commit beyond
the starting baseline. This repair does not merge or replay that work.

## Confirmed regression repairs

Human UAT accepted the following scope:

- The meaningless Geographic Eligibility required-selection state is removed when
  unrestricted is the only supported option. New Issue creation defaults to
  No Geographic Restriction.
- MapLibre lifecycle and recovery robustness is repaired while preserving search,
  manual input, independent geolocation, and selected coordinates.
- Accepted create-time controls remain available: Service Location Required,
  Optional, and Not Used, plus requester identification and anonymous options.

## Confirmed product gaps, not regressions

The read-only code/schema/documentation assessment and user acceptance confirm
that the following were not existing supported Admin capabilities:

- Creation and management of real restricted geographic policies: there is no
  Organization-scoped policy registry, policy-management API/UI, or production
  geographic provider.
- Selection of an authoritative configured geographic policy: Issue creation
  intentionally supports only unrestricted behavior today.
- Editing Service Location or Geographic Eligibility on an existing Issue: the
  existing Issue PATCH contract does not support those edits.

These capabilities require a separately reviewed feature. They are explicitly
excluded from this accepted regression repair; adding radio choices alone would
not implement them safely.

## Accepted contracts and divergences (investigated before repair)

- [F056](F056-admin-issue-configuration-management.md), introduced by `36065c0`,
  copied location/geographic configuration from a source at creation. Its editor
  changed name/description, requester policy, assignment, state and order.
- [ADR-021](../architecture/decisions/ADR-021-complete-atomic-issue-creation.md)
  and F056.5 (`1d9cbd6`, refined by `5431941`) added explicit creation controls:
  Required = `required`, Optional = `optional`, Not Used = `not_applicable`.
  They did not add location/geography to the existing-Issue PATCH contract.
  The current UI renders these controls only for creation; IssueChangeDto and
  validateIssue reject such edit fields. This is a pre-existing capability gap,
  not evidence that accepted edit support disappeared. No permanent domain
  immutability is inferred from that gap. Enabling it needs a defined extension
  to the immutable-version publication and policy-selection contract.
- Geographic creation accepts only `no_geographic_restriction` with null policy
  reference. There is no authoritative restricted-policy registry or selection
  endpoint. Synthetic boundaries are not a registry. Existing restricted source
  configuration must be explicitly reviewed; it cannot silently become unrestricted.
- The user-authorized refinement defaults blank creation to the sole supported
  unrestricted policy. The outgoing command still explicitly supplies the same
  value and the backend validation is unchanged. This refines ADR-021's earlier
  deliberate single-radio UI decision, not geographic enforcement. Clearing a
  copied source restores the blank default. Copying an unsupported restricted
  source still clears selection and requires deliberate review.
- [F049](F049-anonymous-request-policy.md) and F056 retain both Identification
  required and Anonymous requests allowed on creation and edit for Reqro Intake.
  External Redirect intentionally hides intake-only controls. Identified PUBLIC
  intake requires Contact name (email optional); anonymous forbids Contact.
  The current policy governs future creation, not historical identity/contact.
- [F045](F045-requester-issue-location-experience.md) preserves search, manual
  text, paired manual coordinates, explicit device geolocation and map selection.
  Required location is validated; Optional permits omission; Not Used omits the
  location section. Device position is an input aid, not requester residence.
  Unrestricted policies do not block out-of-boundary points. Restricted checks
  stay authoritative on the server and fail closed when unavailable/undetermined.

## Map diagnosis and repair

`ReportIssuePage` mounts `IssueForm` on the details step. `IssueForm` mounts
`ServiceLocationInput` for Required/Optional. Map loading is conditional on the
repository supplying a boundary, independently of search/device/manual input.
The map already sits after search/device action and before Selected Location and
manual disclosures. It is not inside a collapsed details element. Its original
CSS already provided a 220-360px height; explicit full width/min-height now
reinforce that stable layout.

The exact short message "The map is unavailable. Use search or manual entry."
comes from MapFallback's React error boundary after a child render/lazy import
throws. Its original failure state was sticky. A separate longer message from
ServiceLocationMap followed a constructor exception, any MapLibre error, or the
8-second load timeout. Neither supplied a renderer retry. Old asynchronous
callbacks had no disposed-instance guard; context loss/restoration had no explicit
handling. ResizeObserver existed but load/next-frame/visibility handling did not.

Repair adds retry to both failure layers (including a fresh React lazy wrapper),
instance-local marker ownership, guarded callbacks and exact cleanup, resize on
load/animation-frame/layout/window/visibility changes, and explicit context-loss
recovery. A loaded idle event can recover a transient error; unready renderers
retain fallback. Coordinates remain in parent state and are reapplied on load or
retry. No location, identity or query values are logged or stored by these changes.

MapLibre 6.10.0 uses the existing same-origin Vite worker URL and inline style with
local boundary GeoJSON. No external tiles/style/geocoder dependency was added.
The original component initialized successfully in a synthetic browser harness;
the user's original intermittent browser incident was not reproduced. A transient
lazy-import failure was observed during an intermediate HMR edit, confirming the
short-message path, but it is not proof of the original incident's trigger.

## Scope and parity after repair

Creation retains all three Service Location options and the supported geography
value, now defaulted for blank creation. Requester choices remain create/edit
parity. Existing Issue location/geographic edit support remains unavailable under
the accepted API contract; no invented policy selector or migration was added.
No backend, history, authorization, Organization scoping, revisions or audits
changed. No database was contacted or historical requests mutated. Backend
historical-preservation tests were inspected, not represented as executed.
No Claude worktree or excluded tenancy source/configuration was edited.

## Validation

Commands ran from the isolated worktree using the already-installed parent
node_modules (no dependency or lockfile change). Test command prefix:
`node ../node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1`.
`--pool=threads` was used for completed runs except where specified below.
No test timeout was increased and no assertion was removed to obtain a pass.

| Invocation                                                                   | Result                                                                                                               |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Initial default-pool IssueCreation, ServiceLocationMap, ServiceLocationInput | Interrupted after no results were reported; not a pass.                                                              |
| Map-only thread-pool run                                                     | 6 passed, 2 failed (new test root StrictMode setup and encoded expected text). Harness corrected.                    |
| Three focused files, thread pool                                             | 36 passed, 7 failed: six creation timeouts, remaining encoded-text test mismatch. Text fixed explicitly using UTF-8. |
| Three focused files, default-pool retry                                      | Interrupted; emitted IssueCreation partial result 12 passed / 8 failed before termination. No complete-suite result. |
| Relevant 10-file thread-pool run                                             | 118 passed, 4 failed, 0 skipped; 8 files passed and 2 failed.                                                        |
| Isolated permission revocation                                               | 1 passed / 15 excluded by name filter.                                                                               |
| Isolated changing Availability                                               | 1 timeout / 19 excluded by filter.                                                                                   |
| Isolated External Redirect creation                                          | 1 timeout / 19 excluded by filter.                                                                                   |
| Isolated template-free creation                                              | 1 timeout / 15 excluded by filter.                                                                                   |
| Original HEAD External Redirect creation/component comparison                | 1 timeout / 16 excluded by filter. Temporary baseline copies removed.                                                |

The relevant run named:
`react/test/ServiceLocationMap.test.jsx`, `react/test/ServiceLocationInput.test.jsx`,
`react/test/IssueCreation.test.jsx`, `react/test/IssueConfiguration.test.jsx`,
`react/test/IssueHandling.test.jsx`, `react/test/IssueDiscovery.test.jsx`,
`react/test/ReportIssuePage.test.jsx`, `react/test/ReportIssueApiMode.test.jsx`,
`react/test/IntakeUxRefinement.test.jsx`, `react/test/ResidentIntakeDataAccess.test.js`.
Its four failures were template-free create and permission revocation in
IssueConfiguration, and External Redirect creation and changing Availability in
IssueCreation. Two were five-second timeouts and two missing-control failures.
Isolated reruns prove permission revocation passes independently; the other three
exceed five seconds independently. The original HEAD external-redirect case also
exceeds five seconds, confirming at least that timeout is not introduced here.
Do not describe the broader invocation as passing or assume every failure has
been proven pre-existing. Reruns are supplemental, not additional distinct tests.

All 8 ServiceLocationMap and 15 ServiceLocationInput tests passed in the relevant
run. All newly added geographic-default, restricted-source-review and requester
edit checks passed there. Coverage includes map initialization, root StrictMode,
remount, stale callbacks, resize, context restoration, timeout recovery, renderer
retry, coordinate retention, fallback search/manual input and independent device
geolocation.

`node ../node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir`
passed (353 modules); large chunk and plugin timing warnings remain. The emitted
worker and lazy map bundles were present. No deployment ran.

`node ../server/node_modules/prettier/bin/prettier.cjs --check <all ten changed files>`
passed after an earlier check flagged the final map-test edit and it was formatted.
`git diff --check` passed (Git emits informational LF/CRLF conversion warnings).
There is no configured frontend lint script. Backend/DB suites were not run:
no backend files changed and no database access was needed. Historical request
preservation is supported by unchanged backend mutation paths, not a newly run
DB comparison.

Browser: original and repaired components initialized with same-origin workers
and synthetic GeoJSON. Search selection and section unmount/remount retained the
fictional (0,0) coordinates and marker. The repaired visible map measured
800 x 360 CSS pixels. No resident submission or device permission request ran.
The local prototype /report uses the legacy text field; therefore these were
synthetic component checks, not authenticated API-mode /report UAT. A temporary
intermediate JSX edit caused a Vite parse error and consequent lazy-import error;
it was corrected before the successful build. The temporary server also warned
that parent-node_modules icon fonts lay outside its default allow-list; no server
security setting was weakened. All temporary harness and baseline files were
removed, and the temporary server stopped.

## Accepted file scope (pre-staging status)

```text
 M react/src/admin/IssueConfiguration.jsx
 M react/src/admin/IssueCreationSource.jsx
 M react/src/residentIntake/ServiceLocationInput.jsx
 M react/src/residentIntake/ServiceLocationMap.jsx
 M react/src/residentIntake/serviceLocation.css
 M react/test/IssueConfiguration.test.jsx
 M react/test/IssueCreation.test.jsx
 M react/test/ServiceLocationInput.test.jsx
 M react/test/ServiceLocationMap.test.jsx
?? docs/features/intake-location-regression-repair.md
```

## Human UAT: PASSED (2026-10-06)

The user confirmed acceptance on the repaired frontend served from this Codex
worktree at http://localhost:5173 with the existing local API/Entra environment.
The launch uses a temporary Vite cache outside OneDrive; no tracked configuration
or source was changed to launch UAT, and backend CORS was not changed.

Confirmed by the user:

- No meaningless Geographic Eligibility required-selection error when
  unrestricted is the sole supported option.
- No Geographic Restriction defaults correctly for new Issue creation.
- Service Location Required / Optional / Not Used remains available.
- Requester identification / anonymous options remain available.
- Repaired map presentation and recovery passed manual UAT.

The accepted validation record remains **118 passed / 4 failed**, including all
**23 map/location tests passed**. Remaining independently failing cases are
five-second timeouts; one reproduced against original HEAD. The original combined
run included two timeout and two missing-control failures, and permission
revocation subsequently passed in isolation, as preserved above. Human acceptance
does not rewrite any of those four failures as passes. Production build,
formatting, and git diff --check passed; no frontend lint script exists.

Scope verification: no backend files changed, no migration added, no historical
request data changed by the repair, and no Claude tenancy files touched. No data
migration or historical rewrite was performed; a fresh DB fingerprint comparison
was not run or claimed. Real geographic-policy functionality remains out of scope.

The original intermittent browser trigger remains unproven. This accepted repair
addresses verified lifecycle/recovery weaknesses without claiming elimination of
all browser/WebGL failures. The user authorized staging only the ten accepted
files, one focused commit, and push to codex/intake-location-regression-repair.
No unrelated commit is amended. No merge to main, rebase, worktree repair,
provisioning, or deployment is authorized. Stop after push for reconciliation
with the advanced main branch.

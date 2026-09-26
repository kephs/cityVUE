# F056.5 — Post-UAT refinement evidence

Status: Implementation and automated validation complete locally; authenticated browser checks recorded below. Prepared for the authorized third local commit. No push, deployment or F057.

## Checkpoint and approved scope

Started on clean `main` at `1d9cbd6d65249d421f0c751efd3b4ba348d7217b`, parent `5c58d9edbb3fda2fbbccd84c3e54791e53451c60`, local `origin/main` `498d6fc88dfd34cddab9be2481d1fda971d6eb21`, two ahead / zero behind. Both existing F056.5 commits must remain unchanged; completion requires a third commit.

The initial no-migration gate correctly stopped work: Migration 35 rejects Availability changes in PostgreSQL. The user subsequently approved the narrow forward migration and the API-authorization/database-integrity boundary in [ADR-022](../architecture/decisions/ADR-022-governed-issue-availability.md). This approval supersedes the original no-migration expectation only for governed Availability.

## Availability

Stable `service_definition.availability` is now carried through the existing atomic PATCH. Configure edits remain local until Save; Handling is never silently changed. A conflicting redirect remains visible with an explicit resolution message. Core revision includes Availability; action, policy and assignment retain independent revisions. Availability alone leaves the catalog pointer unchanged. Scope and F032 authorization remain server-owned.

Migration 37 requires transaction-bound append-only configuration audit evidence; a bare update cannot change Availability. Audit insertion verifies the current locked Issue and stamps the transaction. The Issue guard checks exact before/after metadata. Deferred completion checks prevent orphan evidence and require matching action history when appropriate. Retained transitions block down migration. No old migration file changes.

Historical integrity is tested by comparing complete synthetic rows for Service Requests, answer snapshots/options, locations, requester/contact state, tracking credentials and operational activity. PUBLIC and INTERNAL fixtures include nonempty answers and locations, with PUBLIC tracking. No values from private development data are included in reports. Availability changes affect future intake eligibility; existing request audience and version references govern historical reads.

## Priority inspection and result

`urgent` remains valid in catalog-version and Service Request database checks, catalog/API DTOs, Admin creation validation, operational priority filtering/sorting and legacy behavior. Removing it globally would break compatibility. No current development Issue uses Urgent: nine Issues comprise three High, one Low and five Medium at inspection.

Add Issue offers Low/Medium/High. Copying an Urgent source clears the new draft's priority and explicitly requires a supported choice; it does not modify the source. Configure previously had no Priority editor/API mutation. It now displays the current priority, including Urgent, without introducing a new priority-writing contract. Existing values are not silently changed when saving other fields. Operational Service Request priority remains unchanged.

## Create validation diagnosis

The historical UAT draft was unavailable, so its exact failed term cannot be established. The implemented disabling predicate was `!valid || !dirty || busy || error.blocked || targetError || targetsLoading`. `valid` combined question validity, nonempty safe bounded name/description, integer Display Order, Category, Availability, Priority, Location policy, Geographic Eligibility, source-loading state, selected/reviewed source version when copying, handoff validation and redirect capability. Requester Policy/Assignment defaults were not independent required-selection predicates; assignment lookup failure/loading still blocked submission.

An otherwise complete draft missing Geographic Eligibility is reproduced as one confirmed failure mode, not asserted to be the user's historical cause. Ordinary incomplete Create is now actionable: submission is withheld, actual errors are listed, inline messages are associated and the first invalid control receives focus/scroll. Handoff/source fields do not generate errors when inapplicable. Retained invalid questions remain visible for correction because the server validates copied configuration even for redirect creation. Stale-source responses retain the separate review workflow, rather than being mislabeled as ordinary required fields. Server validation remains authoritative; mutation-in-flight and required lookup loading prevent duplicate/premature submission.

## Confirmation

Extracted the existing native `<dialog>` confirmation into a reusable component. Source replacement and source reset no longer use `window.confirm`. Keep receives initial focus; Escape/backdrop cancel; browser modal behavior makes the underlying drawer inert. Focus returns to the invoking control. Existing theme tokens and bounded scrolling retain mobile/short-height usability.

Other native confirmations remain scoped and unchanged: Category-change protection and link-navigation dirty-draft protection. Browser beforeunload also remains. Existing close/refresh/lifecycle decisions continue to use the extracted confirmation component.

## Validation results

- Backend unit: **305 passed**.
- API E2E: **40 passed**, including real-HTTP success/error logging sanitization.
- PostgreSQL: **410 passed, zero skipped**, including all governed Availability proofs.
- Full React: **680 passed** across 48 files. The final focused configuration/creation/discovery/dialog set passed 50 tests.
- Shared application tests: **64 passed**. Total automated tests: **1,499 passed**.
- Backend production build, TypeScript checks/test compilation, ESLint and server Prettier: passed.
- React production build: passed. Existing large-chunk advisory and calendarDate module-type test warning remain; no dependency or package-mode change was made.
- Whitespace and private-value review: passed before commit. Documentation links checked.

The initial broad test invocation loaded unrelated development flags and failed isolated Entra configuration checks. Corrected E2E runs without those flags; database runs load only `TEST_DATABASE_URL` from ignored configuration. Tests use installed Node CLIs equivalent to package scripts because npm is absent from PATH.

### Disposable PostgreSQL proofs

The suite proves bare SQL rejection; incorrect prior/target state, replayed/cross-Organization and orphan audit rejection; database overriding a supplied transaction stamp; stale revision rejection; no-op preservation; exactly one core advance without catalog publication; F032 permission/scope rejection; explicit final matrix validation; combined rollback under injected configuration-audit, action-history and action-audit failures; all intake Availability transitions for Active and Inactive Issues; historical PUBLIC/INTERNAL snapshots; future-intake admission; competing writers and intake/configuration locking; unused migration up/down/reapply; and safe down refusal after retained transitions. These are local disposable PostgreSQL checks, not production claims.

### Local migration and data integrity

Migration 37 was applied only to personal localhost `reqro_dev` using the established migration runner after disposable proofs passed. There are **37 applied / 0 pending** migrations. Migration 35 is unchanged. Migration application preserved all 54 application-table snapshots; the two migration bookkeeping tables are excluded from application-data comparisons.

Authenticated browser UAT deliberately changed Fictional External Permit Handoff from External Only / External Redirect to Internal Only / Reqro Intake, then restored External Only / External Redirect and its exact original handoff fields through another governed Save. Both accepted transitions remain in append-only history; they must not be erased. No new Issue or Service Request was created during browser UAT. Other test drafts were discarded.

Final application-table digest reconciliation found exactly four changed tables: `service_definition` (still nine Issues), `issue_configuration_audit` (17 to 19), `issue_action_history` (6 to 8) and `issue_action_audit` (6 to 8). All other 50 application tables match the pre-UAT snapshot exactly. The database retains eight Active / one Inactive Issue, 15 catalog versions, 13 requests, 16 answers and six tracking credentials. Policy, Assignment, permissions, grants, provisioning, historical audience/channel/attribution/version references, answers, locations and tracking remain unchanged. No unexplained application-data mutation was found.

### Authenticated browser and accessibility checks

Normal personal staff sign-in was used; no authentication bypass or permission change. The invalid redirect/Availability draft retained its Handling and explained the required resolution; explicit compatible Handling and Availability saved together and reload showed the accepted state. Current Priority was displayed as Medium. Add Issue authoring offered Low/Medium/High, and an incomplete draft showed actionable field errors and focus rather than an unexplained disabled Create button. Valid atomic creation, copied-Urgent handling and stale-source behavior also have automated regression coverage; the exact historical UAT draft remains unreconstructable.

Validation summary, Configure conflict and source confirmation were checked at 1440×900, 1280×800, 1024×768, 768×1024, 390×844 and 1024×480 in light and dark modes. No horizontal dialog/summary overflow was observed; wrapping and scroll access remain usable. Screenshots were visually inspected in-session, with no capture files retained. The browser was restored to light mode and its original viewport.

The replacement dialog title is **Replace Copied Configuration?**, with message **Choosing another Issue will replace the copied settings and any changes you have made to them.** Actions are **Keep Current Configuration** and **Replace Configuration**. Keep receives focus. Live keyboard testing verified forward focus wrapping, Escape closing only the confirmation, and focus returning to Refresh source configuration. Component tests additionally cover reverse wrapping, backdrop cancellation, parent-event isolation and focus restoration. A discovered nested-form implicit-submit issue was fixed with explicit button types; a discovered Tab/Escape propagation issue was fixed and retested after refreshing stale browser code. This is accessibility-oriented validation, not WCAG certification.

### Logging, scope and cleanup

Privacy evidence is the passing sanitizer and real-HTTP logging tests plus review of all changed runtime paths: no new logger/console calls, request-payload logging, contact/answer/tracking output, identity/token output or redirect-content logging was introduced. The developer-launched API console is not attached to this task, so direct live-console inspection is **not claimed**. The optional manual console check was requested separately and had no response at report time; it is not substituted for automated evidence.

Temporary integrity hashes were removed after reconciliation. No private rows, credentials, HAR/API captures, dumps or screenshots are included in the change. Permanent regression tests contain synthetic fixtures only. No new permissions, grants, dependencies, cloud changes, push, deployment or F057 work.

## Handoff

The third local commit uses `fix(admin): refine issue configuration UAT`, with parent `1d9cbd6d65249d421f0c751efd3b4ba348d7217b`. The earlier two accepted commits remain unchanged. The final response records its resulting hash and Git verification. Current personal development migration rollback is intentionally blocked by the two retained governed transitions; future changes require a forward migration rather than deleting history. Any synchronization or deployment needs a separate explicit instruction.

# F056.2C — Implementation and validation record

Status: implementation and validation complete locally. The user confirmed responsive/light-dark, keyboard/focus and accessibility-oriented UAT PASS, after their earlier firsthand live API-log PASS. Starting checkpoint and required parent: `6e419c64dd4a63f5a1c4b57e5605d3565c0f8701`, synchronized main with a clean tree. This increment authorizes one local commit, `feat(intake): add extended dynamic question types`. No push, deployment, grants, tracking operations or F057. The final task response records the resulting full hash and post-commit Git state; this committed record cannot contain its own hash.

## Design and compatibility

See the [feature specification](F056-2C-extended-dynamic-question-types.md), [ADR-020](../architecture/decisions/ADR-020-extended-question-answer-storage.md) and [security review](F056-2C-security-review.md). Inspection found five executable question types, version-owned immutable questions/options, scalar typed Answer columns, historical prompt/type/order/choice-label snapshots, captured-version foreign keys and scalar-equals conditions. The database reserved multi_select/date/timestamp/attachment_reference, but no historical question or answer used the three new types. Information was absent. No historical reinterpretation was needed.

The approved narrow normalized relation and one DATE column resolve §§7 and 304–313 without broader redesign. Information retains the existing prompt field and 200 Unicode-character limit. There is no second form engine, JSON Schema, JSON answer blob, new permission or endpoint. The existing answer DTO and protected projection admit additive extensions; the existing wizard already distinguishes zero schema rows from Information-only rows.

| Admin label           | Persisted type | Resident control            | Response representation | Answer row?                            |
| --------------------- | -------------- | --------------------------- | ----------------------- | -------------------------------------- |
| Short text            | short_text     | Text input                  | value: string           | When answered                          |
| Long text             | long_text      | Textarea                    | value: string           | When answered                          |
| Number                | number         | Number input                | value: number           | When answered                          |
| Yes / No              | yes_no         | Labeled radios              | value: boolean          | When answered, including false         |
| Single choice         | single_select  | Select                      | value: option key       | When answered                          |
| Multiple choice — new | multi_select   | Checkbox group              | optionKeys: string[]    | One logical row for nonempty selection |
| Date — new            | date           | Native date input           | value: YYYY-MM-DD       | When answered                          |
| Information — new     | information    | Plain explanatory paragraph | No response entry       | Never                                  |

### Multi-select

The browser submits `{questionId, optionKeys: [...]}`; supplying scalar value as well is rejected. Existing semantic option keys are interpreted within the authoritative question/version, not as global option ownership. The domain rejects malformed, duplicate, unknown and out-of-question selections. Required means at least one; optional omission or an empty array is absence. Bounds remain 25 questions, 25 options per choice and 200 options per schema, with existing aggregate request/schema limits.

One Answer owns `answer_selected_option` rows. Composite foreign keys bind Organization, Answer and question, and the configured option. Existing Answer relationships bind the captured request version. The primary key `(answer_id, option_key)` rejects duplicates and supports protected-read lookup. A database trigger snapshots the immutable option label/order. There is no comma-separated label storage or destructive cascade.

An immutable parent selected_option_count of 1–25 and deferred constraints on parent/child INSERT require exactly that many selections at commit. UPDATE, DELETE and TRUNCATE are prohibited; subsequent append cannot satisfy the committed count. Both attempted concurrent appends fail. Parent and children are bulk-inserted within the existing request transaction. Canonical ordering is historical display_order, then option_key. Neither click order, incoming array order nor later current-schema order controls historical display.

### Date

Transport is canonical ten-character YYYY-MM-DD; storage is PostgreSQL DATE, years 0001–9999. Backend parsing checks numeric calendar components, month lengths and Gregorian leap rules. It rejects impossible dates, year zero, locale strings, timestamps, offsets, whitespace/newlines and non-string types. Optional empty input becomes absence, never an empty row. Required absence fails.

Protected reads use PostgreSQL `to_char(date_value, 'YYYY-MM-DD')` before the driver can turn a DATE into a JavaScript instant. Review and staff share `calendarDate.js`, which formats components without constructing a Date or applying a timezone. Child-process tests in differing timezone environments produce the same calendar wording. Native date-control presentation depends on browser locale; the API representation does not. Configurable min/max and localization remain deferred.

### Information

Information is plain text in label/prompt, at most 200 Unicode characters after trim. It has no help, Required, options, validation metadata, response, acknowledgement or hidden completion flag. Forged response entries are rejected even when empty. Database type/identity constraints also prevent disguising an Information response as another answer type.

It appears only as explanatory intake content, including an Information-only Additional information step. It is omitted from Review answers and staff Submitted information; immutable catalog history retains prior text. React renders markup-like content literally. Information is separate from F019 notices and F032 handoff messaging; no staff-only subtype or rich text was added.

## Authoring, intake and historical display

The existing Admin builder adds Multiple choice, Date and Information. Choice options retain identity on edits. Unsaved single/multiple choice transitions retain options; Date clears options; Information additionally clears help/Required. Published semantic type remains locked. The existing numeric Change order, explicit Save/Cancel, validation, expected core revision, 409 conflict, no-op, transactional publication and safe audit remain authoritative. Failed required Admin audit rolls back the version, children, Issue core revision and audit.

The native flow is Issue → Details → Additional information → Review → Submit. Zero schema rows skip Additional information; Information-only schemas keep it without requiring a response. Mixed schemas preserve configured order and inherited scalar visibility. Review shows a semantic list of selected labels and a human date; Back/Edit retains unsent values in React memory. Issue change clears incompatible answers. No answer localStorage was introduced.

Browser UAT found the pre-existing progress layout hard-coded to three columns. The scoped CSS now allocates one equal-width column per actual step, removing the fourth-step connector overflow. The observed 1280 px document scroll width fell from 1320 to its 1265 px client width. This is a directly required four-step responsive correction.

Both supported staff pages continue using the same shared SubmittedInformation component and protected path. Its new renderer uses historical selectedLabels and dateValue; existing displayValue remains for compatibility. Information has no Answer and is not synthesized. Existing loading/error/retry, denied-state hiding, request/auth-context clearing and stale-response handling are retained.

Conditions: the original four immutable definitions remain; publishing the UAT version copies one inherited condition, giving five retained definitions. Existing equals semantics can target any new dependent. Multi-select and Information cannot control conditions. There is no new condition builder or raw JSON editor.

Intake Template copying uses F056's new version-specific question/option row identities and preserves normal semantic keys within their owning configuration. Multi-select schema/options/order, Date schema/order and Information text/order copy independently. No submitted answers or request history copy; later template publications do not propagate.

Disposable historical evidence creates a request captured at version N, publishes changed labels/order/prompts at N+1, and verifies protected responses still equal the N snapshot. Old question IDs submitted with N+1 are rejected; stale N creation returns 409 atomically. The live Issue moves from version 2 to 3, but no live request with new answers was needed; historical new-type request evidence is explicitly disposable, not claimed as live data.

## Security and atomicity

Current active Issue, captured/current version, availability, handling, requester policy, location eligibility, participation and default-assignment eligibility remain checked by the shared authoritative creation command. Resident PUBLIC, trusted development PUBLIC, staff-assisted PUBLIC/API and authorized INTERNAL use the same answer semantics within their existing authorization/context rules. Browser channel/Organization claims establish no authority.

| Parent access | answers.read | Multi-select/Date disclosed? |
| ------------- | ------------ | ---------------------------- |
| No            | No           | No                           |
| No            | Yes          | No                           |
| Yes           | No           | No                           |
| Yes           | Yes          | Yes, after audit commit      |

Admin configuration read, Issue write, Contact and analytics permissions do not imply answer access. Organization and persisted INTERNAL boundaries remain authoritative. Audit failure withholds answers; allowed and denied protected responses retain no-store. Ordinary legacy and unified detail responses have no answers; no supported alternate disclosure path was added. Zero default answers.read grants and the one intentional development grant are unchanged.

| Failure                             | Request committed? | New answers committed? |
| ----------------------------------- | ------------------ | ---------------------- |
| Invalid Multi-select                | No                 | No                     |
| Invalid Date                        | No                 | No                     |
| Selected-option persistence failure | No                 | No                     |
| Date persistence failure            | No                 | No                     |
| Stale schema                        | No                 | No                     |
| Inactive Issue                      | No                 | No                     |
| Availability rejects context        | No                 | No                     |
| External Redirect handling          | No                 | No                     |

The same transaction owns Contact, Requester linkage, Service Location, assignment, Activity, answers/selections and evidence finalization. Injected new-type failures leave no partial state; evidence stays staged. F046 finalized-evidence retry returns the original receipt after later schema publication, without duplicated answers or selections. No live data was corrupted for failure testing.

External Redirect still branches to F032 handoff with no Multi-select, Date or Information schema/control and no request/data forwarding. The live Fictional External Permit Handoff showed its established message, hostname, Go Back and explicit Continue only; no external navigation was needed. Regression tests preserve fresh Continue revalidation, stale handoff, no silent destination substitution, HTTPS/literal-address validation and three-permission legacy/modern action governance. No handling or redirect-history changes were made in development.

| Surface                                            | Multi-select/Date answers   | Information content                      |
| -------------------------------------------------- | --------------------------- | ---------------------------------------- |
| Authorized staff with parent access + answers.read | Protected historical values | Not a submitted answer                   |
| Staff without answers.read                         | Hidden                      | No answer-existence/content substitution |
| Admin Issue configuration                          | No submitted answers        | Authorized schema only                   |
| Eligible resident intake catalog                   | No submitted answers        | Current intake schema only               |
| Requester Tracking                                 | Excluded                    | No additional disclosure                 |
| Public Recent Issues / maps                        | Excluded                    | Excluded                                 |
| F047 Live Search                                   | Not searchable/projected    | Not searched                             |
| F056.1 Issue Search                                | Not searchable/projected    | Not searched                             |
| Analytics                                          | Excluded                    | Not analytics data                       |
| Notifications                                      | Excluded                    | Not automatically included               |
| AI                                                 | Not sent                    | Not sent                                 |
| Export                                             | Not exported                | Not exported                             |
| Normal logs                                        | No values/full payload      | No full content/schema unnecessarily     |

No answer populates Contact, establishes F050 Requester identity, becomes Service Location/Participation or changes routing, assignment, priority or status. F052 health remains bounded and unchanged: new invalid authoring is rejected by strict domain/database constraints; no repair or answer-reading diagnostic was added.

## Integrity matrices

| Multi-select scenario                              | Result                                                   |
| -------------------------------------------------- | -------------------------------------------------------- |
| Multiple configured selections                     | Accepted, canonical order                                |
| Required, no selection                             | Rejected                                                 |
| Optional, no selection                             | Absence, no Answer                                       |
| Duplicate/unknown key                              | Rejected                                                 |
| Foreign question/version/Organization relationship | Rejected by authoritative membership/composite relations |
| Post-submission add/update/delete/truncate         | Rejected, including concurrent append                    |

| Date scenario                        | Result             |
| ------------------------------------ | ------------------ |
| Valid calendar/leap date             | Accepted           |
| Impossible date, invalid month/year  | Rejected           |
| Datetime/offset/locale/non-string    | Rejected           |
| Required omitted                     | Rejected           |
| Optional omitted/empty               | Absence            |
| Historical read / differing timezone | Same calendar date |
| Submitted update/delete              | Rejected           |

| Information scenario                       | Result                                  |
| ------------------------------------------ | --------------------------------------- |
| Reqro Intake / Information-only schema     | Explanatory Additional information step |
| Required/options/help/validation injection | Rejected                                |
| Submitted response, including empty        | Rejected                                |
| Review / staff answers                     | Omitted, no fake answer                 |
| Historical catalog                         | Preserved                               |
| External Redirect                          | Suppressed                              |

## Migration and accepted development state

Migration [20261006000000-extend-dynamic-question-types.ts](../../server/migrations/20261006000000-extend-dynamic-question-types.ts) adds the normalized relation, nullable typed columns, composite uniqueness/FKs, type checks, identity/option capture, immutability and deferred completeness. Existing scalar storage stays compatible. Indexes are the selected-option primary key and parent composite unique key required by the relationship; no speculative history index was added.

Disposable apply → rollback → reapply passed while retaining original answers and grants. Rollback refuses any retained new-type schema/answer/selection history, including Information-only history; it never silently deletes meaningful data. Development was verified as localhost:5432, loopback server, reqro_dev / reqro_dev_user, development profile. Its migration succeeded, 35 → 36 applied, zero pending. Before live authoring, original-column hashes showed only the migration ledger changed.

| Resource                            | Before                    | After | Reason                                                 |
| ----------------------------------- | ------------------------- | ----- | ------------------------------------------------------ |
| Applied migrations                  | 35                        | 36    | Compatible extension; 0 pending                        |
| Issues                              | 8 active, 0 inactive      | Same  | No Issue creation/state change                         |
| Availability                        | 7 dual, 1 external-only   | Same  | No availability mutation                               |
| Catalog versions                    | 12                        | 13    | One deliberate Admin Save                              |
| Questions                           | 25                        | 31    | Three cloned existing + three new definitions          |
| Options                             | 27                        | 30    | Three new Multi-select options                         |
| Conditions                          | 4                         | 5     | One inherited condition copied into new version        |
| Answers                             | 16                        | 16    | No live request created                                |
| Selected-option rows                | Table absent              | 0     | Disposable persistence evidence only                   |
| Service Requests                    | 13                        | 13    | All existing requests preserved                        |
| Redirect history                    | 5                         | 5     | No redirect mutation                                   |
| Issue configuration audits          | 14                        | 15    | One legitimate schema publication                      |
| Protected answer-read audits        | 3                         | 3     | No new live protected read                             |
| Participation analytics-read audits | 53                        | 53    | Analytics pages closed                                 |
| Role-permission rows                | 40                        | 40    | No grants changed                                      |
| answers.read                        | 0 default / 1 development | Same  | No provisioning                                        |
| Participation Areas                 | 5 active                  | Same  | No mutation                                            |
| Participation collection            | Enabled, revision 3       | Same  | No mutation; threshold 5                               |
| Tracking                            | 1 active / 5 revoked      | Same  | No operation or credential-value inspection            |
| Branding                            | REQRO_DEFAULT, revision 3 | Same  | Approved wording/assets unchanged; no trademark symbol |

Read-only original-column fingerprints verify all 12 original versions, 25 questions, 27 options, four conditions, 16 answers, 13 requests (including SR-202609-000013), five redirect-history rows, three protected-read audits and 14 original configuration audits remain unchanged. All other pre-existing table fingerprints match except the migration ledger and the expected stable Issue pointer/core update. Hash comparisons exclude the newly added nullable Answer columns, then verify their null values separately. No private values or dumps are retained.

Fictional Sidewalk Marker retains six current questions in version 3, core revision 8, action revision 1, active, display order 3. The existing three definitions/condition remain, followed by one required Multiple choice, one required Date and one display-only Information block; new orders are 4, 5 and 7. The published history is intentional development demonstration data, not cleanup debt. No fictional live request was created and no protected-read audit added.

Fictional External Permit Handoff remains active, core 5/action 6, version 1, order 0, External-only/External Redirect. Participation preserves Fictional North-East Area and West Demo District, their revisions/orders and audits. No reconciliation deletes, rewrites or manual cleanup occurred.

## Validation evidence

| Final check                                                        | Result                                                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Backend unit, compiled directory, node --test --test-concurrency=1 | 305 passed                                                                                           |
| API E2E, compiled directory, node --test --test-concurrency=1      | 40 passed                                                                                            |
| PostgreSQL integration, disposable TEST_DATABASE_URL               | 382 passed; zero skips                                                                               |
| Shared, eight root manifest files                                  | 64 passed                                                                                            |
| React, Vitest --config vitest.config.mjs --maxWorkers=1            | 623 passed, 45 files                                                                                 |
| Total, five final suites once                                      | 1,414 passed                                                                                         |
| TypeScript / test compilation                                      | PASS                                                                                                 |
| Backend ESLint                                                     | PASS                                                                                                 |
| Frontend lint                                                      | No configured script                                                                                 |
| Formatting, relevant changed files                                 | PASS (full backend format:check and changed frontend/Markdown; compact existing CSS style preserved) |
| Backend production build                                           | PASS                                                                                                 |
| Frontend production build                                          | PASS                                                                                                 |
| Whitespace / documentation links / private-value review            | PASS                                                                                                 |

The initial heavily concurrent runs hit one startup subprocess timeout in unit tests and one Vitest worker-start timeout. Sequential/isolated full reruns passed; no assertions, production behavior or timeout limits were weakened. Final counts above do not add earlier runs. Vite retains the existing >500 kB chunk warning and emitted a plugin-timing advisory. Two date-timezone test subprocesses emit Node's existing module-type warning; they pass without a package-type change.

New coverage is in [extended-question-checks.ts](../../server/test/database/extended-question-checks.ts), [extended-question.domain.test.ts](../../server/test/unit/extended-question.domain.test.ts) and [ExtendedQuestions.test.jsx](../../react/test/ExtendedQuestions.test.jsx). Existing tests changed only where the intentional new authorable types supersede old unsupported-type expectations. API-with-PostgreSQL tests are counted in the PostgreSQL suite, not twice as E2E.

Maximum-size evidence exercises 25 questions and 200 options through Admin publication, catalog read, request creation and protected read. Schema/option loading is batched; validation uses bounded in-memory collections; Answer and selection persistence use bulk INSERTs. Protected read uses one answer query plus at most two typed batch queries, never per-question queries. The explain check with sequential scans disabled proves the existing selected-option primary-key path is usable; it does not claim a production planner choice. The final maximum-size sequence took 187 ms in the disposable development fixture. Development timings are diagnostic observations, not performance SLAs or production benchmarks. Disposable schemas/files are cleaned by fixture teardown.

Live automated UAT used the existing normal Entra Admin session for the one Save and the actual resident API catalog for drafts. It verified required errors, multiple selection/deselection, native Date picker, plain Information, canonical Review, Back/Edit retention and unchanged F032 handoff. A clearly labeled temporary synthetic browser fixture used the real staff and resident components for historical display/Information-only layout without API writes or read audits. It is not authenticated disclosure evidence; real protected authorization/persistence is covered by disposable API tests.

| Width, both themes | Admin three editors | Resident Additional information / Review | Staff Submitted information fixture |
| ------------------ | ------------------- | ---------------------------------------- | ----------------------------------- |
| 1440               | PASS                | PASS                                     | PASS                                |
| 1280               | PASS                | PASS                                     | PASS                                |
| 1024               | PASS                | PASS                                     | PASS                                |
| 768                | PASS                | PASS                                     | PASS                                |
| 390                | PASS                | PASS                                     | PASS                                |

The automation viewport override reported success but remained 1280 px; it was reset. The user confirmed the complete five-width, light/dark, keyboard/focus and accessibility-oriented matrix PASS. Manual checks cover labels/group-required wording, checkbox Space/Tab behavior, Date label/help/error, Information reading order, semantic Review/list/definition list, visible focus, light/dark contrast, long-text wrapping, Change order and Save/Cancel reachability. This validation is accessibility-oriented and is not a WCAG certification.

Live API-log privacy: PASS — the user personally inspected the live API logs and confirmed the required exclusions. Automated normal HTTP log assertions passed for new values, option identities, Information/schema markers and actor token. No raw logs belong in this report.

## Regression and delivery scope

| Regression | Result / preserved boundary                                                |
| ---------- | -------------------------------------------------------------------------- |
| F032       | PASS — governed explicit handoff, no data forwarding                       |
| F045       | PASS — service-location validation/eligibility                             |
| F046       | PASS — attachment atomicity and finalized retry                            |
| F047       | PASS — bounded authorized Live Search, no answers                          |
| F048       | PASS — current eligible default assignment                                 |
| F049       | PASS — requester policy and anonymity                                      |
| F050       | PASS — trusted Requester identity remains independent                      |
| F051       | PASS — participation/privacy separation                                    |
| F052       | PASS — Admin read/health boundaries                                        |
| F053       | PASS — independent collection resource/revision/audit                      |
| F054       | PASS — branding/Admin shell                                                |
| F055       | PASS — Participation Setup, area identity and single-resource order        |
| F056       | PASS — template creation, independent revisions and atomic configuration   |
| F056.1     | PASS — search/filter/pagination/detail bounds                              |
| F056.2A    | PASS — original types/conditions/history/answer authorization              |
| F056.2B    | PASS — availability/context, action authority/history/no-op/stale handling |

Changed application areas: backend authoring/catalog/typed submission/protected projection and database types; one migration; frontend FollowUpQuestions, DynamicQuestion, Review/canonical submission, SubmittedInformation, shared AnswerValue/calendarDate and progress CSS. Test additions above, one database-suite registration and two intentional old-expectation updates. Documentation adds this report, security review, feature specification and ADR020, amends ADR018 explicitly and updates architecture/context/roadmap/indexes. No dependency, lockfile, authentication, provider, permission bundle, runtime configuration, cloud or branding asset changes.

Commit automation inspection found no configured hooksPath, active hooks or commit-triggered automation; only Git sample hooks. Package scripts require explicit migration/provisioning/deployment invocations. A local commit performs none of those operations. Temporary test logs and disposable evidence files are removed. The temporary react/f056-2c-uat.html and react/f056-2c-uat.jsx files were inspected and removed after UAT. Final read-only database fingerprints matched the accepted post-UAT state in all 56 tables; no additional application mutation occurred during the manual gates. No force, history rewrite, amend, tag, release, push or deployment is authorized/performed.

Deferred: condition authoring and Multi-select controllers; configurable Date min/max, time/datetime, file/location/email/phone/URL/specialized question types; Information rich text, Markdown, links/embeds or acknowledgement; groups/pages, reusable question library, localization, defaults and Other + text; answer correction/search/analytics/export/notifications/AI; answer-based routing, assignment, priority/status; workflow/SLA; F057 permissions management. No production-readiness or WCAG certification claim. Next step after the local commit is user review; synchronization needs separate authorization.

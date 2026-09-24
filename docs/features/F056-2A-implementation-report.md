# F056.2A — Implementation and validation report

Checkpoint: `1a9f36740608d601566cc452936bc2ed3666a9cc`, `main`. Scope: Dynamic Question Management & Protected Responses only. Implementation and required validation passed; prepared for local commit. No push or deployment is authorized.

## Implementation and compatibility

F056.2A extends the existing normalized question/option/typed-answer architecture. Admin Follow-up questions supports Add, Edit, help, Required/Optional, supported types, choice options, numeric Change order, Remove, inherited-condition indication, local validation, deliberate Save and Cancel. Read-only Admin receives a view without mutation controls. Unsaved changes are identified; refresh/navigation warns before discarding. Save uses all four existing expected revisions; 409 requires reloading authoritative state rather than automatic replay. New conditional authoring and general adjacent ordering remain deferred.

The shared resident renderer uses labeled controls, associated help/errors and required semantics. The flow is Issue → Details → Additional information → Review when questions exist; zero-question Issues skip Additional information. Yes/no uses radios; single choice retains the existing select. Review uses human labels, supports Back/Edit and preserves draft answers in memory. Plain React text rendering preserves line breaks without interpreting HTML. Stale-version recovery clears obsolete answers/evidence and reloads the selected Issue for review.

The approved compatibility migration removes the answer query/projection from ordinary `GET /api/v1/service-requests/:id`. Legacy `/issues/:issueId` no longer assumes `details.answers`. Both legacy and unified staff detail use the dedicated protected path. Ordinary details remain available without answer permission; withheld answers have no count/prompt/existence placeholder. The local legacy detail feature flag is disabled, so its live route correctly displays its existing development-configuration gate; automated page/API tests cover its migrated behavior.

### Types and limits

| Admin label   | Persisted type | Resident control | Response                              |
| ------------- | -------------- | ---------------- | ------------------------------------- |
| Short text    | short_text     | Text input       | Typed text                            |
| Long text     | long_text      | Textarea         | Typed text with line breaks           |
| Number        | number         | Number input     | Finite numeric value                  |
| Yes / No      | yes_no         | Radio group      | Boolean; false is valid               |
| Single choice | single_select  | Select           | Valid option key and historical label |

All five are implemented. Multi-select, date and information blocks are deferred to F056.2C.

| Bound                        | Implemented limit                                      |
| ---------------------------- | ------------------------------------------------------ |
| Questions per version        | 25                                                     |
| Options per choice           | 2–25                                                   |
| Options per schema           | 200                                                    |
| Prompt / help / option label | 200 / 500 / 100 Unicode code points                    |
| Short / long answer          | 300 / 2,000 Unicode code points                        |
| Number                       | ±1,000,000,000; at most six decimal places; zero valid |
| Schema / answers aggregate   | 64 KiB / 32 KiB UTF-8 JSON                             |
| Whole HTTP request parser    | Existing 100 KiB limit                                 |

Trimmed text is validated. New authoring/submission bounds never truncate historical content. Question and option orders must be unique in their respective scopes. Published type changes are refused; removal produces absence in a new version, not deletion of old rows.

### Conditions, publication and atomicity

All three pre-existing JSON equals conditions remain unchanged. Runtime evaluates the existing controlling semantic key and value. Admin shows inherited behavior and blocks removing its controller, changing its type or removing a referenced choice. Cloning preserves condition/validation metadata from the server; browser-authored conditions are not accepted.

Replacement versions are built as drafts, populated in bulk and published within the Issue Save transaction. Existing independent core/action/policy/assignment revisions are compared before change. Meaningful schema change advances core revision and creates one metadata-only configuration audit. Same-value Save creates neither revision, version nor audit. Concurrent same-revision writes yield one success and one 409. Failed validation/publication/audit rolls back all writes. Database triggers serialize child mutation with publication and reject published child insertion/update/delete/reparenting.

Request creation locks/checks the current stable Issue inside its transaction. Stale published version, inactive Issue and external_redirect return 409; current requester policy, default assignment, location and participation validation remain authoritative. Invalid/unknown/duplicate/hidden/incorrectly typed answers are rejected before persistent creation. Answer, Contact, location, assignment, reference and activity writes share the transaction. Injected answer persistence failure leaves no partial request. F046 finalized-evidence retries preserve the original receipt despite later version, availability, redirect, policy and assignment changes; this is not general-purpose idempotency.

### Answer persistence and disclosure

Existing typed columns remain: text, number, boolean, selected option key and display snapshot. An answer retains its request, question key/identity, historical prompt/type/order and choice label. The migration derives `catalog_version_id` from the existing parent request, checks existing relationships, and adds Organization/request/version, Organization/question/version and Organization/question/option foreign keys. Existing one-logical-answer uniqueness remains. UPDATE, DELETE and TRUNCATE are rejected for submitted answers; no cascade deletion is introduced.

`GET /api/v1/staff/service-requests/:id/answers` returns only historical display fields. It does not join current schema to substitute wording. The parent scope query enforces the existing SQL-authorized PUBLIC/INTERNAL union and locks the parent/context. A successful transaction inserts `request_answer_read_audit` before its promise resolves. Audit failure returns a safe failure without answers. Audit contains only ID, Organization, request, staff, correlation, action and timestamp; no values, prompts, payloads, counts or Contact. Both success and denial use no-store.

| Parent accessible? | answers.read? | Answers visible? |
| ------------------ | ------------- | ---------------- |
| No                 | No            | No               |
| No                 | Yes           | No               |
| Yes                | No            | No               |
| Yes                | Yes           | Yes              |

Foreign Organization is denied without existence disclosure. INTERNAL additionally requires existing INTERNAL authorization and scope. Admin configuration/Issue write, Contact and analytics permissions are independent. The new permission alone grants neither parent access nor Admin, Contact, analytics or tracking access. Fresh/default roles have zero grants. The CLI permits explicit selection only; no broad bundle was expanded.

Submitted information is loaded deliberately in memory. Historical prompts and choice labels, Yes/No, numeric display and long-text line breaks are preserved. An authorized empty response gets a safe empty state; a denial removes the section. Request/authentication changes abort outstanding reads and suppress stale responses. Permission loss clears content on the next authoritative read; no claim of retroactive erasure is made.

| Surface                                  | Submitted answers exposed?         |
| ---------------------------------------- | ---------------------------------- |
| Authorized parent + answers.read         | Yes, dedicated response            |
| Staff without answers.read               | No                                 |
| Ordinary legacy/unified details          | No                                 |
| Admin Issue configuration                | No submitted answers               |
| Public Recent Issues, maps and lists     | No new disclosure                  |
| Requester Tracking                       | No                                 |
| F047 Live Search / F056.1 Issue Search   | No                                 |
| Analytics / notifications / AI / exports | No                                 |
| Normal logs                              | No values; user privacy check PASS |

Answers do not populate Contact, establish Requester identity, become Service Location or Participation Area, determine assignment/routing or change priority/status. Legacy prototype mapping also stops flattening structured answers into its persisted description. Incidental sensitive text in independently submitted description remains a pre-existing risk, not automatic answer publication or redaction.

## Live development evidence

The user closed analytics pages before UAT. Normal personal Entra authentication was used; no token copying, fallback principal or verifier bypass. Pre-grant parent detail returned 200 and protected answers returned 403; the user explicitly confirmed both. F036 dry-run and confirm selected only `service_request.answers.read`, preserving Public Works / Streets and Community Services / Parks scope and every other grant. Post-grant protected read returned 200 and committed its audit.

Existing fictional request `SR-202609-000013` was used for staff display; no new request was needed. It still captures Damaged Street Sign version 1 and its original question/option snapshots while the current Issue is version 4. No answer values are included here.

Damaged Street Sign was selected for authoring UAT because it has no inherited conditions. Three deliberate Saves were retained:

1. Add an optional fictional single-choice question through the normal Admin UI: version/core revision 2.
2. Controlled authenticated edit of prompt/help, Required, numeric order and an option label; remove an unused option: version/core revision 3. Semantic keys retained. Same-value Save did nothing; stale Save returned 409.
3. Remove the temporary question through the normal Admin UI: version/core revision 4. Current original question/options are restored semantically; historical versions remain.

The resident UI displayed the edited order, required state, help and options; missing required answers blocked Review. Review displayed human choice labels. Its draft was not submitted. A deliberately invalid answer API submission returned 400 and persisted no request. Valid submission and injected-failure tests used disposable PostgreSQL fixtures instead of retaining unnecessary development requests.

User reported PASS for Admin builder, Additional information/Review and staff Submitted information at 1440, 1280, 1024, 768 and 390 px in light/dark themes: wrapping, long text/options, errors, actions, keyboard/focus and no horizontal scrolling. Automated tests separately cover labels/help/required radio semantics, safe text, denied state and stale response handling. This is development accessibility evidence, not WCAG certification.

User reported PASS for live API log privacy after schema Save, invalid submission, denied and successful answer reads; no logs were pasted. Normal logs excluded protected payloads, unnecessary schema/prompts/options, Contact, provider subjects, tokens, tracking credentials/digests and private attachment paths.

### Database comparison

| Record                       |  Before |   After |
| ---------------------------- | ------: | ------: |
| Applied migrations / pending |  33 / 0 |  34 / 0 |
| Tables                       |      52 |      53 |
| Permissions / role grants    | 29 / 39 | 30 / 40 |
| Stable Issues, all active    |       7 |       7 |
| Catalog versions             |       8 |      11 |
| Questions / options          | 17 / 13 | 22 / 27 |
| Conditional definitions      |       3 |       3 |
| Submitted answers / requests | 16 / 13 | 16 / 13 |
| Issue configuration audits   |       7 |      10 |
| Protected answer-read audits |       0 |       2 |

Read-only hashes of all original non-secret columns, excluding specifically identified new version/child/audit/grant rows, preserve original answers, versions, questions, options, request rows and related data. The remaining changed tables are expected migration/permission metadata, provisioning role ownership metadata and the stable Issue current pointer/core revision/timestamp. No other unexplained mutation was observed. Answer version/key mismatches remain zero.

Preserved: Contact 8, Requesters 1, requester-history audits 3, Service Locations 13, assignments 18, Activity 105, operational Activity 68, attachments 3/audits 48/batches 3, tracking rows 6, areas 5 active/0 inactive and audits 9, collection enabled revision 3 and audits 2, analytics-read audits 53, privacy threshold 5, branding Reqro/default revision 3, policy rows/audits 7/3, default assignment rows/audits 2/3, all staff identities and scope memberships. `Fictional North-East Area` remains intentional user-created development data between earlier checkpoints, unchanged here; `West Demo District` remains active revision 8/order 3.

### Migration and performance

`20261004000000-protect-dynamic-questions-answers.ts` performs precondition checks, derived-version backfill, composite constraints, immutable child/answer/audit triggers and zero-grant permission registration. Disposable apply → rollback → reapply passed before development application. Rollback refuses retained schema/read audits or grants; no destructive development rollback was attempted. Development target was verified as localhost:5432 / reqro_dev / reqro_dev_user under the development profile. No seed ran.

Admin schema loading uses two bulk child queries, not one per question/option. Publication uses bulk question/option inserts. Resident schema/answer validation use the existing bulk catalog read; answers persist in one creation transaction. Protected answer read uses one scoped parent query, one historical answer query and one audit insert, plus transaction/authentication overhead. A development EXPLAIN selected `answer_request_order_idx` with incremental sort. Composite unique indexes support the new foreign keys. No speculative search index or N+1 answer/option lookup was added. Maximum 25-question publication/submission/historical-read fixtures run in disposable PostgreSQL; observed subsecond sequence timing is test evidence, not a production benchmark.

## Automated validation and review

Final results: 269 backend unit, 40 API E2E, 312 PostgreSQL (zero skips), 64 shared and 590 React tests. After the initial full PostgreSQL run, its changed 266-test audience/integration suite passed again with aggregate-limit and finalized-evidence/configuration coverage. The full React suite passed with explicit unified-page coverage. TypeScript, backend ESLint, formatting and both builds passed. No frontend lint script is configured. Vite retains its existing warning for chunks above 500 KiB.

Commands use the existing package-script CLIs directly because npm/tsx execution was unavailable in this desktop runtime: TypeScript test/build configs, Node test runner for compiled unit/E2E/database tests, Vitest with the repository config and one worker, ESLint and Prettier, and Vite production build. The migration/provisioning commands use the same compiled repository CLIs and approved ignored environment files. Test DB configuration remains isolated from personal development configuration.

Prior-feature regression suites cover F032 redirect rejection, F045 location, F046 attachments/finalized retry, F047 search, F048 assignment, F049 policy, F050 trusted Requester, F051 participation/privacy, F052 Admin auth, F053 collection, F054 branding, F055 Participation Setup, F056 configuration and F056.1 discovery. These are automated regression results, not claims of separately repeating every historical live UAT scenario.

### Threat review and residual limitations

Organization and parent-scope SQL plus independent permission checks mitigate IDOR and permission confusion. Version/option FKs and authoritative schema validation reject forged relationships/types/options, missing required and hidden answers; bounds limit oversized payloads. Current-version checks prevent stale submission and redirect bypass. Published-child locking prevents publication races; immutable historical rows prevent ordinary correction/deletion. Transactional audits prevent unaudited disclosure or partial successful mutations. React text rendering mitigates stored markup execution. Narrow projections, no-store, memory-only state and sanitized errors/logging limit unintended disclosure.

Database owner/privileged maintenance can change schema; these are not protections against the database administrator. No production benchmark, WCAG certification, automated PII redaction or production readiness is claimed. Current-schema edits cannot erase already disclosed browser data. The existing legacy detail enablement gate remains unchanged. General answer correction/retention workflows need separate approval.

No F056.2B availability/context, modern redirect administration/history/domain governance; no F056.2C multi-select/date/information/new conditions/branching/file/location types; no answer correction/tracking/analytics/search/export/notification/AI use; no workflow/SLA or F057 administration. No synchronization, push or deployment is performed.

### Changed areas

Backend: Admin question domain and Issue publication; request creation/detail/protected-read controller/service; permission manifest; migration; idempotent development seed adaptation. Frontend: Admin builder, shared DynamicQuestion renderer, Additional information/Review, legacy consumer and shared SubmittedInformation panel. Tests: authoring/migration/concurrency/authorization/atomicity, legacy/unified consumers, shared prototype privacy and provisioning. Documentation: feature, report, ADR-018 and index/architecture/roadmap/protocol references. No dependency upgrade.

### Final checks

Validation commands follow the repository manifests:

```text
node server/node_modules/typescript/bin/tsc -p server/tsconfig.test.json
node --test                                      (server/dist-test/test/unit)
node --test --test-concurrency=1                 (server/dist-test/test/e2e)
node --test                                      (server/dist-test/test/database; TEST_DATABASE_URL only)
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs --maxWorkers=1
node server/node_modules/typescript/bin/tsc -p server/tsconfig.build.json
node node_modules/eslint/bin/eslint.js .          (server)
node server/node_modules/prettier/bin/prettier.cjs --check <changed files>
node node_modules/vite/bin/vite.js build react --outDir ../dist-react --emptyOutDir
git diff --check
```

The shared suite used the eight explicit test files from the root `test` script. Migration status/up and F036 dry-run/confirm used the compiled repository CLI with approved ignored development configuration, without displaying private inputs.

Private-value scanning of changed files and relative Markdown links passed. Temporary browser harness removed. User responsive/accessibility and logging gates passed. All §404 security/integrity questions were assessed against the implementation and evidence above: expected authorization, immutable history, no default grants, current-version validation and exclusions hold; no later feature or deployment began. Final Git verification is reported with the local commit; synchronization remains prohibited.

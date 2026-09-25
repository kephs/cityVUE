# F056.2C — Extended Dynamic Question Types

Status: implementation and validation complete locally from synchronized `6e419c64dd4a63f5a1c4b57e5605d3565c0f8701`, main. All specified validation and live UAT gates passed. Local commit only; no push, deployment or F057.

## Inspection and compatible extensions

The accepted development baseline matches every pre-existing table fingerprint: 35 migrations, 8 active Issues, 12 versions, 25 questions, 27 options, 4 conditions, 16 answers, 13 requests, 5 redirect-history records and 3 protected-read audits. No historical question/answer uses multi_select, date or information. At inspection, the database reserved multi_select/date but neither was authorable or executable; Information was absent from the constraint.

Existing answers have scalar text, numeric, boolean and option-key columns, historical prompt/type/order/choice-label snapshots, captured-version composite foreign keys, one answer per request/question and immutable update/delete/truncate guards. Options belong to immutable version-specific questions and carry stable semantic option keys. Existing conditions use scalar equals. The protected DTO supplies question metadata and displayValue only after parent authorization, answers.read and an audit commit.

Resolved design gates §§304–313:

- Add `answer_selected_option(organization_id, answer_id, question_id, option_key, option_label, display_order)`. Primary key `(answer_id, option_key)` rejects duplicates. Composite foreign keys bind the parent answer/question and configured option in the same Organization. Existing answer/question/request version relationships transitively enforce captured-version membership. No cascade deletes. A trigger captures label/order from the immutable option definition.
- Add nullable `selected_option_count` to Answer, constrained to 1–25 only for multi_select. Deferred constraints on both answer and selection insertion require exactly that many children at commit. Immutable parent/children prohibit later update/delete; appending a child after submission fails the count constraint. Optional empty selections create no parent. This avoids a mutable seal or transaction identifier and leaves existing rows untouched.
- Add nullable PostgreSQL `date_value DATE` for date answers only, with canonical YYYY-MM-DD transport. Calendar parsing rejects invalid dates without converting to an instant. A shared frontend formatter serves Review and staff display; backend validation remains authoritative.
- Information uses the existing prompt/label field and 200 Unicode-character limit, no help, Required, options, validation or response. No new content field or rich text. Immutable schema history retains it; Review and protected answers omit it.
- Existing DTO `{questionId, value}` remains for scalar answers, including canonical Date. Multi-select adds mutually exclusive `{questionId, optionKeys: string[]}` using existing semantic keys. Information has no DTO entry. Protected projection adds selectedLabels/dateValue; no second endpoint.
- No historical multi-select controller exists. Do not introduce controller semantics. Existing scalar conditions can target any new dependent through the existing generic visibility evaluator. No condition authoring.
- Additional information already skips only when schema rows are absent, so Information-only schemas need no wizard redesign.

## Scope and preservation

Author exactly Multi-select, Date and Information in addition to the five F056.2A types. Preserve opaque semantic keys during edits, new immutable child identities during publication, inherited conditions, type-change protection, schema/answer bounds, atomic request creation, protected disclosure and F056.2B availability/handling authority. Canonical multi-select order is historical option order then option key, never click order. Template copies remain independent.

External Redirect executes no Dynamic Questions. Answers remain excluded from ordinary legacy detail, public views, tracking, search, analytics, notifications, AI, export and normal logs, and never populate Contact, Requester, Location, Participation or operational routing/workflow fields. No grant changes.

## Validation and live UAT

Disposable migration apply/rollback/reapply and populated rollback guard passed, along with typed validation, relational integrity, immutability, transaction failure, historical rendering, protected authorization, API compatibility, current-state and prior-feature regressions. All five protocol suites passed: 305 unit, 40 API E2E, 382 PostgreSQL, 64 shared and 623 React tests. Development migration 36 is applied with zero pending. The user personally inspected live API logs and confirmed PASS. The user also confirmed all five responsive widths in light/dark themes, keyboard/focus and accessibility-oriented UAT PASS; this is not a WCAG certification. See the [implementation report](F056-2C-implementation-report.md) and [security review](F056-2C-security-review.md) for evidence and limitations.

Live UAT retained three new-type definitions on Fictional Sidewalk Marker through one deliberate versioned Admin Save. Disposable tests proved request persistence, so no live request or protected-read audit was added. All original history, the fictional External Permit Handoff, grants, tracking, branding and Participation remain preserved. The implementation report enumerates the legitimate additions. Temporary UAT fixtures were removed.

## Deferred

Conditional authoring, multi-select controllers, date bounds, time/datetime, file/location/specialized identity/URL questions, rich text/Markdown/links/embeds, acknowledgements, groups/pages, reusable question library, localization/default answers/Other-text, answer correction/search/analytics/export/notifications/AI, answer-driven routing/assignment/priority/status, workflow/SLA and F057.

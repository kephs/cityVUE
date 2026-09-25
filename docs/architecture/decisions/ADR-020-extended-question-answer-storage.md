# ADR-020 — Extended question answer storage

Status: F056.2C compatible design authorized by the feature specification; implementation and local validation complete.

## Context

[ADR-018](ADR-018-dynamic-questions-protected-answers.md) deliberately limited authoring to five types. The next approved increment adds multi_select, date and information while retaining the existing version-owned model, scalar answer contract, immutable history and independently protected answer endpoint. Inspection found no historical reserved-type rows requiring reinterpretation.

## Decision

Multi-select uses the existing stable option keys in a separate `optionKeys` array, mutually exclusive with scalar `value`. One logical Answer owns normalized `answer_selected_option` rows. Composite foreign keys bind selections to the parent Answer's Organization and question; existing Answer/question/request relationships bind the captured catalog version. No comma-separated labels or JSON answer blob. Each child captures its historical label and order from the authoritative option. Display sorts by that order and then option key.

The parent records a bounded immutable selected count (1–25). Deferred checks on parent and child insertion require exactly that many children at commit. Because neither parent nor children can be updated/deleted/truncated, subsequent additions cannot satisfy the committed count. This also prevents committing an incomplete multi-select answer. Optional zero selections produce no Answer. Answer and all selected rows are inserted in bulk inside the existing request transaction, with no independently committed child write.

Date uses `YYYY-MM-DD`, strict component/leap-year validation, years 0001–9999 and PostgreSQL DATE. No timezone, timestamp or locale string is accepted. Protected reads format the database DATE to canonical text in SQL before the PostgreSQL driver can convert it to a JavaScript instant. Review and staff use one frontend calendar formatter that builds human wording from numeric calendar components; it never constructs a Date. Optional empty Date is absence.

Information is plain text in the existing 200-character prompt field. It has no help, required state, options, validation or answer. It remains an immutable schema row, is displayed in Additional information (including an Information-only form) and is omitted from answer Review and staff Submitted information. Existing scalar equals conditions can target the new types; multi-select/Information controllers and new rule authoring remain unsupported.

Published semantic types cannot change in place. Unsaved choice-type changes can preserve options; switching to Date clears options; switching to Information also clears help/Required. Template copying retains F056's new version-specific question/option row identities and independent configuration, without copying any submitted answers. A stable semantic key is interpreted within its owning question/version, never across Organizations or Issues by itself.

## Security and consequences

No new permission, route or grant. Parent request authorization plus answers.read, audit-before-disclosure, no-store and absence from ordinary legacy detail continue unchanged. Protected DTO additions are `selectedLabels` and `dateValue`; the existing `displayValue` remains. Other public, search, tracking, analytics, notification, AI and export projections do not acquire answers. Information is authorized catalog configuration, not a separate notice/handoff channel. External Redirect suppresses the complete schema.

The migration changes no existing application values and refuses to reinterpret existing reserved-type rows. Rollback refuses when any new-type schema history or response is retained, including Information-only history. No destructive cascade or answer correction is introduced. Authorized database owners can deliberately disable database protections; production least-privilege roles and operational governance remain separate requirements.

Calendar formatting is currently English, consistent with this UI; localization and date bounds remain deferred. Already disclosed protected browser content cannot be retroactively erased. This decision makes no production performance, accessibility certification or deployment claim. Evidence is recorded in [F056.2C](../../features/F056-2C-extended-dynamic-question-types.md).

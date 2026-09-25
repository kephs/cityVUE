# ADR-018 — Immutable Dynamic Questions and protected submitted answers

Status: Accepted design, explicitly approved for F056.2A on 2026-09-24. Local implementation evidence is recorded separately in the [F056.2A report](../../features/F056-2A-implementation-report.md).

## Context

Reqro already stores version-owned questions/options and typed answer snapshots. F056 administrative edits must extend this model without rewriting submitted requests. The former legacy detail response disclosed answers under ordinary request-read authorization. The user explicitly approved removing that disclosure as an intentional security compatibility change.

## Decision

- Author only short text, long text, number, yes/no and single choice. Preserve inherited equals conditions; do not add rule authoring. Rewording keeps semantic keys; each publication creates new version/child identities. Existing question types cannot change in place. New keys are server-generated and opaque.
- Build replacement children under a draft version and publish within the existing atomic Issue transaction. Child triggers lock parent versions against publication and reject modification once published. Draft construction is internal, not a second public draft API. Preserve F056 independent resource revisions and audit rollback.
- New request submissions must use the current active, internal-intake version, checked within the creation transaction. Return 409 for obsolete configuration; require deliberate review. A finalized F046 evidence retry returns the original successful receipt before current configuration validation, within its existing capability/expiry contract.
- Persist normalized typed answers and historical prompt/type/choice-label snapshots. Add captured-version composite relationships and option membership foreign keys. Submitted answers and protected-read audits are immutable. No destructive cascade or answer correction is introduced.
- Remove answers from ordinary legacy detail. Both staff detail consumers use `GET /api/v1/staff/service-requests/:id/answers`. Independently require current parent request authorization, Organization/audience/scope and `service_request.answers.read`.
- Commit a metadata-only read audit before disclosure. Audit failure withholds answers. Protected success and denial responses use `Cache-Control: no-store`. UI state is memory-only, clears on request/authentication changes, and ignores aborted or stale responses.
- Register the permission with zero grants and no broad bundle inclusion. A deliberate personal-development grant follows user-confirmed authenticated pre-grant 403. Admin, Contact and analytics permissions confer no answer access or parent scope.

## Consequences and privacy

F056.2C amendment (2026-09-24): [ADR-020](ADR-020-extended-question-answer-storage.md) extends the authorable type set with multi-select, Date and Information. The five-type limit above records the F056.2A checkpoint; the history, authorization and disclosure decisions remain authoritative.

Ordinary request readers retain their other authorized details but no longer receive submitted answers or answer-existence metadata. Existing clients must migrate to the protected path. Historical requests retain their original definitions after edits/removals. Rollback refuses to discard retained schema-change audits, answer-read audits or the explicit grant; rollback/reapply is tested before such use in disposable schemas.

Bounds limit new authoring and submissions, not historical preservation. Free text can contain sensitive information; authorization is not automatic classification/redaction. Already disclosed browser content cannot be retroactively erased. No answer publication to tracking, search, analytics, AI, exports or notifications is authorized. Production privacy, retention, correction and deployment remain separate decisions.

This extends [ADR-017](ADR-017-atomic-issue-configuration.md) and the [audience authorization decision](ADR-006-public-internal-staff-authorization.md); it does not supersede their independent resource/scope rules.

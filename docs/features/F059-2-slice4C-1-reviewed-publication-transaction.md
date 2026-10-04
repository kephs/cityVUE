# F059.2 Slice 4C-1 — Reviewed publication transaction

Status: implemented; stopped for human security/architecture review. This slice
adds the internal reviewed-publication mutation only. There is no HTTP publication
route, Admin UI, Migration 44, development migration, or permission provisioning.

## Operation

`ResidentPublicationService.publish` accepts only trusted publisher context, an
immutable review-request ID, an expected resource revision, and a correlation ID.
Organization, target revision, reviewer, decision, publication baseline, purpose,
classification, policy version, classifier version, and authorization context are
resolved from PostgreSQL.

The publisher is re-resolved under the existing authorization barrier and requires
`admin.configuration.read` plus `resident_experience.publish`; consequential
publication additionally requires `resident_experience.contact.manage`. Edit
authority is not required. Reviewer and publisher are compared by stable internal
staff identity; equality returns a conflict. Existing contributor-lineage separation
and current reviewer authority checks remain active.

## Atomic transaction

The service follows the established lock order: Organization/access authority,
Resident Experience resource, review request, then review decision. It rechecks the
resource and authorization revisions, draft and published pointers, exact target,
classification, latest-request status, approval outcome, 24-hour expiry, single-use
consumption, current reviewer/publisher authority, and contributor separation after
locking. A first publication retains a null baseline and is consequential. Historical
republication requires a fresh historical request and approval.

It inserts one immutable `published` event referencing the exact request and decision,
then advances the published pointer and resource revision exactly once in the same
transaction. Migration 43's foreign keys, unique consumption/transition indexes,
publication trigger, and deferred commit-time checks enforce event/pointer agreement.
Any stale, unauthorized, separated, expired, superseded, consumed, cross-context, or
trigger failure rolls back the event and pointer together.

No public reader or DTO changed. Existing repeatable-read public reads continue to
observe either the previous committed revision or the new committed revision.

## Validation

- Focused review/publication PostgreSQL suite: **44 passed / 0 failed / 0 skipped**.
- Full backend units: **455 passed / 1 failed**. The one failure is the known
  pre-existing `logging-sanitization.test.js` timestamp-regex defect where the
  epoch-millisecond `time` field matches the `911` alternative; the test was not
  changed.
- Full API E2E isolated rerun: **68 passed / 0 failed / 0 skipped**. The initial
  inherited-Entra configuration run was **48 passed / 3 failed**, retained as
  historical evidence.
- Full disposable PostgreSQL isolated rerun: **656 passed / 0 failed / 0 cancelled /
  0 skipped**. The initial inherited-Entra run was **254 passed / 4 failed /
  1 cancelled**, retained as historical evidence.
- Shared tests: **64 passed**.
- Backend typecheck, test compilation, production build, changed-file lint,
  formatting, and `git diff --check`: passed.

All PostgreSQL runs used only the loopback `reqro_f0592_test` / `reqro_test_user`
gate and isolated schemas. `reqro_dev` was not accessed or modified. Migration 43
was not changed or applied to development. Slice 4C-2 remains deferred.

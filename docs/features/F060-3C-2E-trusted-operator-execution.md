# F060.3C-2e — Trusted production operator execution contract (ADR-028)

Baseline `1751922c77039d0c41380f5e861f22d666025008`.

**Status: implemented; security architecture review approved 2026-10-09; ADR-028 Accepted. Nothing is deployed and nothing is provisioned.** This slice implements the **provider-neutral Reqro side** of the production operator execution boundary. It creates no cloud resource, no identity-provider group, no privileged-identity-management policy, no CI workflow, no service principal, no OIDC federation, no secret, no production database user and no grant change. It adds no migration — the migration count stays at 49 — and modifies no database privilege.

## What was wrong

The production operator command's actor was a human-editable environment value. `REQRO_OPERATOR_IDENTITY` was read directly from the environment, shape-checked, and written to `tenant_domain_audit.operator_identity`, `requested_by` and `approved_by`. The command's own comment said correctly that this is attribution and never authentication — but it means every downstream control, including the independent-approval requirement and the `requested_by <> approved_by` constraint, was anchored to a string the acting human supplied.

Three further gaps: no bound on how long an elevation stayed usable; no record of which code ran; and no record that an invocation was *attempted*, since `tenant_domain_audit` exists only when the mutation reaches the database.

## The two channels

| Trusted execution metadata — infrastructure injected | Human-selectable operation inputs |
| --- | --- |
| `REQRO_OPERATOR_IAM_TENANT_ID` | the verb (argument) |
| `REQRO_OPERATOR_IAM_SUBJECT` | the mode, `--dry-run` or `--confirm` (argument) |
| `REQRO_OPERATOR_IAM_PERMISSIONS` | the approved operation, for `approve` (argument) |
| `REQRO_OPERATOR_ELEVATION_REQUEST_ID` | `REQRO_OPERATOR_ORGANIZATION_ID` |
| `REQRO_OPERATOR_ELEVATION_GRANTED_AT` | `REQRO_OPERATOR_HOSTNAME` |
| `REQRO_OPERATOR_ELEVATION_EXPIRES_AT` | `REQRO_OPERATOR_ROLE` |
| `REQRO_OPERATOR_RUNNER_IDENTITY` | `REQRO_OPERATOR_EXPECTED_REVISION` |
| `REQRO_OPERATOR_RUNNER_PLATFORM` | `REQRO_OPERATOR_APPROVAL_ID` |
| `REQRO_OPERATOR_JOB_RUN_ID` | |
| `REQRO_OPERATOR_COMMIT_SHA` | |
| `REQRO_OPERATOR_IMAGE_DIGEST` | |

Eleven trusted variables, each independently required in a serving environment, plus `REQRO_OPERATOR_TRUSTED_RUNNER` and `REQRO_OPERATOR_AUDIT_SINK`. `REQRO_OPERATOR_REASON`, `REQRO_OPERATOR_CORRELATION_ID`, `REQRO_OPERATOR_REQUESTER_IDENTITY` and the challenge/DNS tuning values remain human-supplied with their existing validation; they describe the request, never the actor.

The resolved context carries thirteen trusted fields. `identityIssuer` and `identitySubject` are derived from the normalized identity rather than read separately, so no second channel can disagree with it; `invocationId` is generated locally, because a value whose only job is to correlate this process's own audit records gains nothing from being injected.

**Disjointness is proven, not asserted.** `assertChannelsDisjoint` is exported and tested, and a second test enumerates every environment key the command itself reads — by scanning its source for `process.env.X`, `process.env['X']`, `requiredValue('X'` and `refusedValue('X'` — and asserts the intersection with the trusted channel is empty. That enumeration replaced an earlier plain substring scan, which correctly flagged the command's own `--help` text for naming the trusted variables. Documenting them is not reading them, so the test was narrowed to the property that matters rather than the help text being stripped.

## Identity

`iam:<issuer-or-tenant-id>/<hyphenated-subject>`. For Entra the subject is the immutable `oid`; a UPN, mail address or display name is refused as a subject and recorded only as secondary context.

**The hyphenated form is a database requirement, not a style choice.** Migration 47 applies, to all three identity columns:

```
~ '^(iam|oidc|dev):[A-Za-z0-9][A-Za-z0-9._@/+-]{1,180}$'
!~ '[A-Za-z0-9]{32,}'
```

A bare 32-hex GUID is a 32-character alphanumeric run, so `iam:<tenant>/<bare-oid>` would be **rejected by the database**. The hyphenated composition is 77 characters with a longest alphanumeric run of 12, comfortably inside both rules. The test proves this against the migration source: both pattern strings are asserted present in `20261017000000-add-tenant-domain-operator-controls.ts`, asserted to be applied to exactly three columns, and then used to build the matchers — so a change to the migration fails the test instead of silently diverging from it.

**Arbitrary OIDC `sub` values are deliberately not claimed to be supported.** An opaque base64url subject is a long alphanumeric run and is refused with `identity_unsupported` at the boundary rather than written and rejected by a constraint. Both the Entra adapter (hyphenated-GUID check) and the provider-neutral core (composed-value check) refuse it, so a future adapter that forgets the GUID check still cannot produce an unwritable identity.

Identity is an adapter boundary: `TrustedIdentityAdapter` is injectable, `entraExecutionClaims` is the only shipped implementation, and a second provider is a function rather than an edit to the operator path. No token is validated here — verifying an OIDC assertion is the runner's and the provider's job, and the module says so rather than implying otherwise.

## Permissions — the five approved conceptual permissions, on two axes

| Permission | Authorizes |
| --- | --- |
| `tenant-domain.request` | the six non-approve verbs |
| `tenant-domain.approve` | `approve`, and nothing else |
| `tenant-domain.execute` | no verb; the distinct authority `--confirm` requires |
| `deployment.migrate` | no tenant-domain verb and no commit |
| `emergency.breakglass` | nothing — unimplemented, and refused if presented |

*Verb authority* (`request`, `approve`) says which operation; *execution authority* (`execute`) says whether it may be committed rather than planned. So planning, approving and applying are three separately grantable authorities, none implying another.

| Grant held | Permits |
| --- | --- |
| `request` | the six verbs, `--dry-run` only |
| `approve` | `approve`, `--dry-run` only |
| `execute` | nothing |
| `deployment.migrate` | nothing |
| `request` + `execute` | the six verbs in both modes |
| `approve` + `execute` | `approve` in both modes |
| `deployment.migrate` + `execute` | nothing |

That table is asserted behaviourally through `assertPermitted` and `assertExecutionPermitted` for all seven verbs in both modes, as a whole-map equality so a missing *and* a surplus permission both fail. `approve` has no dry-run at the command level, so `approve` without `execute` authorizes nothing the command can actually invoke.

**`request` and `approve` are intended to be mutually exclusive IAM assignments**; `execute` may coexist with either. This is a grant-assignment rule enforced where grants are assigned. The code deliberately does **not** refuse an elevation carrying both, because that would be a new authorization semantic and the authoritative control already exists: Migration 47's `requested_by <> approved_by` and the operations layer's refusal to consume a self-approved approval, both asserted against their sources in the test.

**`tenant-domain.request` never authorizes `approve`.** Proven three ways: by list membership, by `assertPermitted` refusing `approve` under a `request` grant while accepting all six verbs it does cover (so the denial is specific rather than a blanket denial passing vacuously), and structurally — the command's check is `assertPermitted(execution, verb)` and a test asserts it is never made against `approvedVerb`. Recording an approval *for* `activate` is the `approve` verb and requires `tenant-domain.approve`.

Holding both permissions is still not self-approval: **Migration 47's `requested_by <> approved_by` enforcement and the refusal to consume an approval whose approver is the acting operator remain the authoritative control.** The permission split is independent defence in depth over the same property; neither is load-bearing alone.

`deployment.migrate` is tested to confer no verb and to fail the commit gate, so the F060.3C-2d migration role's authority can never be reused as control-plane change authority. `emergency.breakglass` is **unimplemented**: presenting it is refused outright rather than silently conferring nothing, because an operator acting on a false belief about their powers must be told the capability does not exist. A test additionally audits that the term appears in the execution module only as the permission-model entry, the exported constant and the refusal, that the command never mentions it, and that neither module implements a bypass.

A permission naming a verb the command does not implement would be dead configuration, so a test resolves the `OPERATIONS` list from the command's own source, asserts all seven verbs, and asserts the permission matrix covers exactly that set — no unknown verb, and no operation unreachable through any permission. An unknown permission in `REQRO_OPERATOR_IAM_PERMISSIONS` is refused rather than dropped, because silently dropping one would read as "no authority" instead of as a misconfiguration.

## Elevation

Granted in the past within one minute of clock skew, not expired, and at most **60 minutes** wide. An over-wide window is refused, not trimmed. Tested at the boundary: exactly 60 minutes is accepted, 61 is refused, and expired, inverted, future and malformed windows each produce `elevation_invalid` through a per-case verdict map asserted as a whole.

The recommended job timeout is **15 minutes**, asserted in code as a constant below the ceiling and documented in the runbook. A process cannot bound its own wall clock, so this is the runner's assertion, not Reqro's — stated rather than implied.

## Provenance

A full 40-character lower-case commit SHA and a `sha256:` + 64 hex image digest, both required. Six refusal cases are tested as a verdict map: a branch name, a 7-character SHA, an upper-case SHA, a bare tag, a tag reference and a truncated digest.

The commit SHA is baked into the image as a build argument, because the commit an image was built from is a property of the image. The digest is **not** baked and cannot be: an image cannot know its own digest before it is built and pushed. The runner injects it from the registry reference it actually pulled, which is also the only value that proves what ran. A test asserts the digest is not baked.

## Invocation audit

`OperatorAuditSink` is a two-method provider-neutral interface. A start record is established before anything is attempted; an outcome record carries the closed failure code — never a message — for success, refusal and failure alike.

**Serving fails closed.** `REQRO_OPERATOR_AUDIT_SINK` must name a permitted adapter; absent, `memory`, `none` and an unknown name are all refused with `audit_unavailable`. If the start record cannot be written the invocation is refused and **no database pool is ever built**, asserted by source ordering: resolution → permission check → audit start → pool. A lost *outcome* record is reported on stderr and swallowed, so an audit failure never replaces the real failure.

Records are assembled field by field in `startRecord`; nothing is spread in from the environment or a configuration object. `assertAuditPayloadSafe` re-checks the assembled object, walking nested objects and arrays with cycle protection, refusing fifteen forbidden key substrings and three credential-shaped value patterns (URI userinfo, bearer header, PEM block). Seven refusal cases are tested as a verdict map, and the start record is additionally asserted to contain no occurrence of `DATABASE_URL`, `postgresql://`, `password`, `Bearer ` or `PRIVATE KEY`.

**Honest limitation:** the only implemented adapter writes JSON lines to the process's error stream, so durability is entirely the runner's log pipeline. That is **not** immutable off-host retention and is not claimed to be. **Immutable off-host retention remains an open infrastructure blocker**, and production remains blocked until a real, independently administered, off-host, immutable and retention-controlled sink exists. Satisfying it later is a new `OperatorAuditSink` rather than a change to the operator path.

## Runner trust

The runner asserts `REQRO_OPERATOR_RUNNER_IDENTITY`; infrastructure declares `REQRO_OPERATOR_TRUSTED_RUNNER`; the default adapter asserts they agree, and the assertion is injectable.

**Stated strength, not implied strength.** Both values arrive through the same environment, so this is a consistency check rather than an authentication of the runner. It catches the artifact executed outside its intended job definition, a job copied between deployments, and a misconfigured runner. It does not catch a runner whose environment an attacker already controls, because then the attacker controls both sides of the comparison. Closing that requires a signed workload assertion from the platform, which is provider-specific and out of scope.

Provider neutrality is asserted against the source: a test strips comments from `operator-execution.ts` and `operator-audit.ts` and fails if executable code names GitHub, Actions, Azure, DevOps, GitLab, Jenkins, CircleCI, Buildkite, AWS or GCP. The same check runs over the container definition for runner and registry vendors.

## Container build definition

`server/deploy/operator/Dockerfile`, built from the `server` context. Multi-stage, running **`node dist/database/tenant-domain-operator-cli.js`** — the compiled artifact, not working-tree `tsx`. `USER node`, no `EXPOSE`, no entry-point shell wrapper that could rewrite arguments or inject an identity, and no credential, secret, token or `DATABASE_URL` default anywhere in the file. The database credential arrives at run time from the deployment secret manager. Asserted by test: the entry point, the absence of `tsx`, the non-root user, the absence of `EXPOSE`, a line-by-line credential scan, that the commit SHA is baked and the digest is not, and that no runner or registry vendor is named.

It selects no CI system and no registry; that remains a separate authorized decision.

## No workstation path

None was added. A serving invocation that cannot produce complete trusted context is refused with a closed code before a pool exists. There is no flag, no environment value and no partial mode, and the gated `test` target — which has no IAM, elevation or runner and returns a null context — may never name a non-test database, which `resolveOperatorTarget` already enforced.

## Files added

| File | Purpose |
| --- | --- |
| `server/src/config/operator-identity.ts` | Provider-neutral identity adapter boundary; Entra adapter; normalization proven against the Migration 47 grammar |
| `server/src/config/operator-execution.ts` | Trusted execution contract; the five conceptual permissions on two axes with `assertPermitted` (verb) and `assertExecutionPermitted` (commit); JIT elevation; provenance; runner assertion adapter; channel disjointness |
| `server/src/config/operator-audit.ts` | Provider-neutral invocation audit interface, stream and in-memory adapters, allowlist payload assembly and safety assertion |
| `server/deploy/operator/Dockerfile` | Provider-neutral one-shot operator job image |
| `server/test/unit/tenant-domain-operator-execution.test.ts` | 31 subtests covering the above |
| `docs/architecture/decisions/ADR-028-trusted-production-operator-execution.md` | The decision record |
| `docs/operations/TENANT_DOMAIN_OPERATOR_RUNBOOK.md` | Operator runbook |
| `docs/features/F060-3C-2E-trusted-operator-execution.md` | This document |

## Files changed

| File | Change |
| --- | --- |
| `server/src/config/operator-environment.ts` | Seven codes added to the closed failure set: `execution_context_missing`, `elevation_invalid`, `runner_untrusted`, `provenance_invalid`, `permission_denied`, `identity_override_rejected`, `audit_unavailable` |
| `server/src/database/tenant-domain-operator-cli.ts` | Resolves trusted execution, authorizes the verb, derives the actor, establishes and closes the invocation audit record; header and `--help` updated |
| `docs/security/SECURITY_FRAMEWORK.md` | One status paragraph |
| `docs/architecture/decisions/README.md` | ADR-028 index entry |

## Validation record

| Suite | Result |
| --- | --- |
| `tenant-domain-operator-execution` (new) | 38/38, nothing skipped |
| Operator CLI + 2c-1 boundary + execution | 71/71, then 78/78 after the permission rework |
| PostgreSQL 17 operator role (`tenant-domain-operator-role.integration`) | **28/28**, 27 subtests, nothing skipped |
| Backend units, serial | 704/704, nothing skipped, three runs |
| Root shared | 64/64 |
| typecheck / lint / build / test compile / prettier / `git diff --check` | pass |

The PG17 operator-role suite was rerun after the CLI and configuration changes rather than assumed to pass because no SQL or grant changed. It returned the historical 28/28 with **no privilege added and no database boundary weakened**; the suite builds its own disposable PostgreSQL 17 container, so it needed no `.env.test.local`.

Not executed: `tenant-domain-operator-cli.integration` and `tenant-domain-operator-controls.integration`, which require the gated `server/.env.test.local` and the shared disposable application database. The application DB suite and API E2E were also not rerun. These are **not executed**, not passed.

One parallel full-unit invocation failed 2/704 (`configured development compiler initializes the complete Nest application`, `migration, seed and API startup configuration failures never echo credentials or CA paths`), both with exit code `null`, i.e. timeouts under parallel load. Because `operator-environment.ts` is in the Nest application graph through `runtime-connection.ts`, this was not dismissed on structural grounds: the suite was rerun serially three times, 704/704 each time. The failed parallel invocation is recorded as a real failed invocation.

Earlier runs of the new suite: 29/2, then 31/0, then 35/3 after the permission rework. All failures were my own and are recorded rather than smoothed over. The first was the substring channel scan false-positiving on the command's `--help` text, described above. The second was a source-ordering assertion using `indexOf` on bare identifiers, which found the import block at the top of the file and compared nothing useful; it now matches call sites (`await beginAuditedInvocation(`, `resolveTrustedExecution({`) and asserts each was found before comparing positions.

The three failures in the permission rework were all test-authoring errors: two doc-wording assertions used plain substrings that the comments wrap across lines, so they failed on a line break rather than on absent wording, and the break-glass structural scan flagged the exported `BREAKGLASS_PERMISSION` constant as a violation of itself. The first two became whitespace-tolerant patterns; the third became a precise occurrence audit. The two wording assertions also revealed genuine documentation gaps, which were fixed rather than asserted around: the runbook had no runner-trust strength statement at all, and the canonical retention sentence was not literal in every document.

A placeholder test was written and then removed before any run, rather than left in place with a skip reason — a skipped test that claims coverage it does not provide is worse than no test.

Remaining validation is recorded in the completion report for this slice.

## Source-provenance reconciliation

The session-start `git status` snapshot listed `server/src/config/operator-identity.ts` as an untracked file, which I initially reported as a pre-existing file overwritten without inspection. **That report was wrong, and the record is corrected here.** The file never existed before this slice:

- The session transcript contains exactly one mutation of that path: a `Write` at `2026-10-09T03:40:29.018Z`, 8118 bytes. There is no earlier `Write` or `Edit` to it anywhere.
- The harness file-history entry for that write records `"backupFileName": null, "version": 1` — no prior version existed to back up. The same file later shows `"backupFileName": "1bb0ebc9f805f52f@v2", "version": 2`, so backups are recorded when there is something to back up; no `@v1` artifact exists.
- The `compact_boundary` that produced the status snapshot is timestamped `03:43:12.228Z` — roughly three minutes **after** the write. Its `session_context` is the only one in the whole session that mentions the file; the preceding boundary's untracked list named only `server/test/helpers/operator-role-cluster.ts`.
- Independently, `Write` refuses to overwrite an existing file that has not been read in-session. The file was never read, and the write succeeded, so no file was there.
- A filesystem search across all thirteen worktrees, the `.local-uat` worktree and the sibling repository copies found no other source copy. The `dist/` and `dist-test/` copies are outputs of this session's own build, confirmed by their exported symbols and by mtimes later than the source write.
- The retained `@v2` backup is byte-identical to the current file (`md5 879456d3…`), so nothing else modified it either.

No content was lost and no product-owner acceptance is required. The underlying cause of the mistaken report is that the snapshot is labelled as the state at "the start of the conversation", which is the start of the resumed context window rather than the start of the work.

## Known limitations

1. **Immutable off-host audit retention does not exist.** The stream adapter's durability is the runner's log pipeline.
2. **Runner trust is a consistency check**, not an authentication of the runner.
3. **Reqro authenticates nobody.** The trust root remains infrastructure IAM, exactly as ADR-027 decision 10 states.
4. **The 15-minute job timeout is not enforced by Reqro** and cannot be; it is the runner's assertion.
5. **No infrastructure exists.** No IAM group, PIM policy, runner, workflow, federation, secret, registry, image, production database user or grant.
6. **The gated `test` target has no trusted execution context** and keeps the F060.3C-2b attribution path, so these controls are proven by unit assertion rather than by an end-to-end production run — which is the correct state, because no production exists to run against.

## Status

**Trusted production operator execution contract implemented on the Reqro side; pending security review.** The outstanding blockers are infrastructure and remain outstanding: per-human IAM with just-in-time elevation, runner selection and configuration, secret-manager integration, immutable off-host audit retention, production database provisioning, and domain, DNS, TLS and edge configuration. **Production deployment remains unauthorized.**

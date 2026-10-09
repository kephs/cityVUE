# Tenant-domain operator runbook

ADR-028 / ADR-027 / ADR-025. Covers the production-capable tenant-domain operator command, `server/src/database/tenant-domain-operator-cli.ts`.

> **This runbook does not authorize production execution.** No deployment, identity-provider group, privileged-identity-management policy, job runner, secret, registry, image, production database user or grant exists. Every prerequisite in [Before any of this works](#before-any-of-this-works) is outstanding. The procedures below are the reviewed intent, written so that configuring the infrastructure is a matter of satisfying a stated contract rather than inferring one.

## What this command is for

Registering, verifying, activating, deactivating and revoking a customer resident hostname in the tenant-domain registry that ADR-025 hostname resolution reads. It is a **one-shot job**: one verb, then exit. The exit code is the job's.

It reaches no resident, service-request, attachment, tracking, Resident Experience, access or notification data. There is no raw-SQL path, no listing or discovery verb, no Organization lifecycle mutation, and no break-glass of any kind.

## Before any of this works

All of the following are **outstanding infrastructure prerequisites**, each separately gated:

1. Per-human IAM identities in the deployment's identity provider, with just-in-time elevation (maximum 60-minute windows).
2. Group or role assignments carrying the approved permissions. **`tenant-domain.request` and `tenant-domain.approve` are mutually exclusive assignments** — no human may hold both — and `tenant-domain.execute` may coexist with either but must be granted deliberately rather than bundled. Reqro does not refuse an elevation carrying both verb permissions; the database refuses self-approval regardless, so this rule is yours to enforce in IAM.
3. An Azure DevOps organization and project with the three operator pipeline definitions, plus the Azure Pipelines GitHub App service connection for checkout. ADR-029 selects Azure DevOps as the control plane and a one-shot Azure Container Instance in the private VNet as the execution substrate; neither exists.
4. Secret-manager injection of `DATABASE_URL` for the operator database role.
5. An operator image built from `server/deploy/operator/Dockerfile`, pushed, and referenced **by digest**.
6. A log destination with immutable off-host retention. The shipped audit adapter writes to the job's stderr; its durability is the runner's pipeline, which is **not** immutable retention. **Immutable off-host retention remains an open infrastructure blocker**, and production remains blocked until a real, independently administered, off-host, immutable and retention-controlled sink exists.
7. The production database, the four separated roles from F060.3C-2d, and the operator grant artifact applied.
8. Domain, DNS, TLS and edge configuration for the hostname being registered.

## Who supplies what

The command refuses a serving invocation unless infrastructure supplies **all eleven** trusted values, plus the trusted-runner declaration and the audit adapter name. A human supplies none of them.

### Infrastructure-injected (trusted) — the runner sets these

| Variable | Value |
| --- | --- |
| `REQRO_OPERATOR_IAM_TENANT_ID` | The IdP tenant/issuer identifier. Entra: the tenant GUID, **hyphenated**. |
| `REQRO_OPERATOR_IAM_SUBJECT` | The acting human's **immutable** subject. Entra: the `oid` claim, **hyphenated**. Never a UPN, mail address or display name. |
| `REQRO_OPERATOR_IAM_PERMISSIONS` | Comma-separated permissions from the active elevation, drawn from `tenant-domain.request`, `tenant-domain.approve`, `tenant-domain.execute`, `deployment.migrate`. Never `emergency.breakglass`, which is unimplemented and refused. |
| `REQRO_OPERATOR_ELEVATION_REQUEST_ID` | The JIT activation request identifier. |
| `REQRO_OPERATOR_ELEVATION_GRANTED_AT` | ISO-8601 instant. |
| `REQRO_OPERATOR_ELEVATION_EXPIRES_AT` | ISO-8601 instant, at most 60 minutes after the grant. |
| `REQRO_OPERATOR_RUNNER_IDENTITY` | The runner's assertion of its own identity. |
| `REQRO_OPERATOR_RUNNER_PLATFORM` | Lower-case platform label, for the audit record. |
| `REQRO_OPERATOR_JOB_RUN_ID` | The job execution identifier. |
| `REQRO_OPERATOR_COMMIT_SHA` | Full 40-character commit SHA. Baked by the image build. |
| `REQRO_OPERATOR_IMAGE_DIGEST` | `sha256:` + 64 hex, from the reference the runner actually pulled. |
| `REQRO_OPERATOR_TRUSTED_RUNNER` | The runner identity this deployment trusts. |
| `REQRO_OPERATOR_AUDIT_SINK` | `stream`. |
| `REQRO_DEPLOYMENT_ENVIRONMENT` | `staging` or `production`. |
| `REQRO_DEPLOYMENT_SCHEMA` | The application schema. Defaults to `public`. Not a CLI flag, deliberately. |
| `DATABASE_URL` | From the secret manager. **Never** in an argument, a log, a workspace file or an audit record. |

Also infrastructure-owned and pre-existing: `REQRO_OPERATOR_DATABASE`, `REQRO_OPERATOR_DATABASE_USER`, `NODE_ENV=production`, `CITYVUE_DEPLOYMENT_PROFILE=client`, `TENANT_RESOLUTION_STRATEGY=registry`.

**Do not make any trusted variable editable in the job definition's input form.** The whole control is that the actor is not a human choice. `REQRO_OPERATOR_IDENTITY` is **refused** in a serving environment — including when it matches the derived identity.

### Human-supplied — the operator sets these

| Variable / argument | Value |
| --- | --- |
| verb (argument) | `register`, `issue-challenge`, `verify`, `activate`, `deactivate`, `revoke`, `approve` |
| mode (argument) | `--dry-run` or `--confirm` |
| approved operation (argument, `approve` only) | `activate` or `revoke`, named before the mode |
| `REQRO_OPERATOR_ENVIRONMENT` | Must equal `REQRO_DEPLOYMENT_ENVIRONMENT`. |
| `REQRO_OPERATOR_ORGANIZATION_ID` | The Organization UUID. |
| `REQRO_OPERATOR_HOSTNAME` | The hostname. |
| `REQRO_OPERATOR_ROLE` | `register` only. |
| `REQRO_OPERATOR_EXPECTED_REVISION` | Every verb except `register`. |
| `REQRO_OPERATOR_APPROVAL_ID` | `activate` and `revoke`. Optional when planning, mandatory to confirm. |
| ~~`REQRO_OPERATOR_REQUESTER_IDENTITY`~~ | **No longer accepted in a serving environment** (ADR-029). The requester is read from the trusted request artifact; supplying this is refused. It remains the input for the gated `test` target only. |
| `REQRO_OPERATOR_REASON` | Why. Recorded. |
| `REQRO_OPERATOR_CORRELATION_ID` | A UUID tying the steps of one change together. |
| `REQRO_OPERATOR_CHALLENGE_LIFETIME_DAYS` | `issue-challenge`, optional. |
| `REQRO_OPERATOR_DNS_TIMEOUT_MS`, `REQRO_OPERATOR_DNS_TRIES` | `verify`, optional. |

## Job configuration requirements

- **Timeout: 15 minutes.** Set it on the job. Reqro cannot enforce its own wall clock. It is deliberately far below the 60-minute elevation ceiling so a job cannot outlive the elevation that authorized it.
- **Image by digest, never by tag.** The command refuses `latest`, any tag reference, and any short SHA.
- **No credential in argv.** There is no `--database-url` flag and credentials are never accepted as arguments.
- **No `.env` generation.** Inject environment directly; do not have the job write a secret-bearing file into the workspace.
- One verb per job run. Do not batch.

## Procedure: onboarding a hostname

Activation requires an **independent approval by a different person**. Steps 1–3 are the requester's; step 4 is a second operator's; step 5 is the requester's again.

Keep one `REQRO_OPERATOR_CORRELATION_ID` for all five steps.

### 1. Register — requires `tenant-domain.request`, plus `tenant-domain.execute` to confirm

```
register --dry-run
register --confirm
```

Registration is always unverified and inactive. `REQRO_OPERATOR_EXPECTED_REVISION` is not used. Record the revision from the output.

### 2. Issue the DNS challenge

```
issue-challenge --confirm
```

Hand the emitted challenge record to whoever administers the customer's DNS. Then wait for publication; do not loop the job.

### 3. Verify

```
verify --dry-run
verify --confirm
```

**Verification never activates.** It only records that the DNS proof was observed.

### 4. Approve — requires `tenant-domain.approve` and `tenant-domain.execute`, and a different human

```
approve activate --confirm
```

`REQRO_OPERATOR_REQUESTER_IDENTITY` names the requester. The approver is the **injected** identity of whoever runs this job; it is never an input. The database refuses an approval naming one identity for both roles.

Before approving, review the requester's pre-approval plan from step 5's dry run: it reports `commitEligibility=pending_approval`, which means everything checkable without an approval passed and **it is not evidence the mutation would commit**.

Record the approval UUID.

### 5. Activate

```
activate --dry-run     # with REQRO_OPERATOR_APPROVAL_ID set → commitEligibility=validated
activate --confirm
```

A dry run *with* the approval runs the real transaction, every constraint and the approval context check, then rolls back without consuming the approval. That is the strongest pre-commit evidence available.

## Procedure: taking a hostname out of service

```
deactivate --dry-run
deactivate --confirm
```

Requires `tenant-domain.request`, plus `tenant-domain.execute` to confirm. This is the incident-response action and needs **no independent approval**, so an on-call responder holding request and execute authority can stop serving a hostname without holding approval authority.

## Procedure: revoking verification

Revocation requires prior deactivation and an independent approval.

```
deactivate --confirm
approve revoke --confirm        # second person
revoke --dry-run                # with the approval → validated
revoke --confirm
```

## Why an approved change cannot be applied twice

Three independent controls, none of which you need to remember:

1. **The approval is single-use.** Consuming it writes its ID into the audit row, and a partial unique index makes a second consumption a database error. Two concurrent attempts cannot both commit.
2. **The expected revision must still be current.** A committed change advances the revision, so re-running the same request reports `revision_stale`. Re-read and re-plan.
3. **State preconditions.** Activation requires a verified, inactive binding; revocation requires prior deactivation.

Approvals also expire 24 hours after they are recorded, and the request artifact has its own shorter ceiling.

**You cannot forge a request.** The approval job downloads the artifact from the pinned request run of the infrastructure-owned request pipeline; the artifact's content and digest are not inputs you can edit, and changing any field in it is refused. If you need to approve something different, ask the requester to re-plan it.

## Reading the output

One JSON object on stdout. `commitEligibility` is the field that matters:

| Value | Meaning |
| --- | --- |
| `pending_approval` | A plan only. **Not** evidence the mutation would commit. |
| `validated` | The real transaction ran every constraint and was rolled back. |
| `committed` | Applied. |

Audit records go to **stderr** as JSON lines, two per invocation: `phase: "start"` before anything is attempted, and `phase: "outcome"` with `succeeded`, `refused` or `failed` plus the closed code. They share an `invocationId`.

**A start record with no outcome partner means the job died mid-flight.** Investigate; do not assume nothing happened. The database audit trail is authoritative for what actually changed.

## Failure codes

One sanitized failure line on stderr with a closed `code` and no message, SQL, connection string or registry data.

### Trusted-execution refusals — the invocation never reached the database

| Code | Meaning | First thing to check |
| --- | --- | --- |
| `execution_context_missing` | A trusted variable or the trusted-runner declaration is absent or malformed. | The job definition's environment block. All eleven, plus `REQRO_OPERATOR_TRUSTED_RUNNER`. |
| `identity_override_rejected` | `REQRO_OPERATOR_IDENTITY` was set in a serving environment. | Remove it. The actor is not a human input. |
| `attribution_invalid` | The IAM claims are absent, malformed or unsupported. | The subject must be a **hyphenated** GUID, not a UPN and not a bare 32-hex GUID. |
| `elevation_invalid` | Expired, inverted, future, malformed, or wider than 60 minutes. | Re-request JIT activation. If the window is over-wide, fix the IAM policy — it is refused, not trimmed. |
| `runner_untrusted` | The asserting runner is not the declared trusted runner, or a label is malformed. | Whether the job ran from the intended definition and deployment. **This is a consistency check, not an authentication of the runner** — see below. |
| `provenance_invalid` | Commit SHA or image digest is not immutable. | Reference the image by digest. A branch, tag or short SHA is not provenance. |
| `permission_denied` | The elevation does not authorize this verb, does not authorize committing, names an unknown permission, or presents `emergency.breakglass`. | For `approve`, the acting human needs `tenant-domain.approve`; `tenant-domain.request` never authorizes it. For any `--confirm`, they also need `tenant-domain.execute`. `emergency.breakglass` is unimplemented and is always refused. |
| `audit_unavailable` | The audit adapter is unconfigured, not permitted in serving, or the start record could not be written. | `REQRO_OPERATOR_AUDIT_SINK=stream`. Execution is refused deliberately; do not work around it. |

### Operation refusals

| Code | Meaning |
| --- | --- |
| `environment_mismatch` | Requested environment, deployment marker and runtime disagree. |
| `database_mismatch` | The live connection is not the declared target. |
| `approval_missing` / `approval_expired` / `approval_context_mismatch` | The independent approval is absent, stale or authorizes something else. |
| `self_approval` | One identity for both roles. |
| `revision_stale` | The registry moved. Re-read and retry from the dry run. |
| `verification_unavailable` | DNS verification could not be performed. |
| `database_unavailable` | The operator database could not be reached, or an unclassified database refusal. |
| `operation_invalid` | A malformed or misplaced operation input. |

## What the runner check does and does not prove

`REQRO_OPERATOR_RUNNER_IDENTITY` is the runner's assertion about itself; `REQRO_OPERATOR_TRUSTED_RUNNER` is the deployment's declaration of which runner it trusts. Reqro asserts the two agree.

**This is a consistency check, not an authentication of the runner.** Both values arrive through the same environment, so two matching values do not prove the runner is trustworthy. Do not read a passing check as evidence of a trusted execution platform.

What it reliably catches: the operator artifact executed outside its intended job definition, a job definition copied between deployments, and a misconfigured runner.

What it cannot catch: a runner whose environment an attacker already controls — at that point the attacker controls both sides of the comparison.

Real runner trust will come from the protected execution platform and a workload identity the platform itself signs, not from this comparison. The assertion is an injectable adapter so that can replace it without changing the operator path.

## Things not to do

- **Do not run this from a workstation.** There is no workstation path and none will be added. A serving invocation without complete trusted context is refused.
- **Do not make a trusted field an editable job input** to make a run convenient.
- **Do not grant one person both `tenant-domain.request` and `tenant-domain.approve`** expecting it to be harmless. The database still refuses self-approval, but the grant defeats the intent of the split.
- **Do not bundle `tenant-domain.execute` into every role.** Separating it is what lets a change be planned and reviewed by people who cannot apply it.
- **Do not grant `emergency.breakglass`.** It is unimplemented, nothing can honour it, and an invocation presenting it is refused.
- **Do not reuse `deployment.migrate` as operator authority.** It confers no tenant-domain verb and no commit, by design.
- **Do not treat a `pending_approval` plan as approval to proceed.**
- **Do not widen the elevation window** to avoid re-requesting it.
- **Do not run the image by tag.**
- **Do not disable the audit adapter** to get past `audit_unavailable`.

## Local and test execution

The gated `test` target has no IAM, elevation, runner or audit context: `resolveTrustedExecution` returns null and the F060.3C-2b attribution path applies, with `REQRO_OPERATOR_IDENTITY` read as before. That target may only name a test database and a test role, enforced by `resolveOperatorTarget`.

For ordinary local work use the separate development command (`npm run dev:tenant-domain`), which keeps its own local-database pin.

## Related

- [ADR-028 — Trusted production operator execution](../architecture/decisions/ADR-028-trusted-production-operator-execution.md)
- [ADR-027 — Platform operator bootstrap and recovery](../architecture/decisions/ADR-027-platform-operator-bootstrap-recovery.md)
- [F060.3C-2e — Trusted production operator execution](../features/F060-3C-2E-trusted-operator-execution.md)
- [F060.3C-2b — Production operator CLI](../features/F060-3C-2B-production-operator-cli.md)
- [F060.3C-2d — Database role separation](../features/F060-3C-2D-database-role-separation.md)
- [CityVUE security framework](../security/SECURITY_FRAMEWORK.md)

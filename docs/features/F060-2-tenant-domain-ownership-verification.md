# F060.2 — Tenant-domain ownership verification (ADR-025 Slice 1b-A)

Status: **security review PASSED.** Approved for one source-control checkpoint
on `claude/tenant-domain-verification`, parent
`e560d28c5477c6570d42eaff5455bd6eeeca307d`. Not merged to `main`, not deployed.
Migration 46 has **not** been applied to `reqro_dev`. Slice 1b-B is not
authorized and is not started.

## Authorization and baseline

Implemented under the ADR-025 Slice 1b-A authorization, following the approved
security design assessment. Fresh branch `claude/tenant-domain-verification`
created from `origin/main` at
`e560d28c5477c6570d42eaff5455bd6eeeca307d`, clean index and working tree.
Forty-five migrations existed before this work; `20261016000000` was re-checked
as the next free ordinal immediately before authoring.

No dependency changes. `node:dns` and `node:crypto` are built in.

## Accepted lifecycle

```text
register → unverified + inactive
         → issue-challenge  → pending + inactive
         → verify (DNS)     → verified + inactive
         → activate         → verified + active
```

Verification and activation remain separate. **A successful DNS check never
activates a hostname.**

## Migration 46 — `20261016000000-add-tenant-domain-verification.ts`

### `tenant_domain` additions

`verification_expires_at` and `verification_token_id`, plus three named
constraints:

| Constraint | Effect |
| ---------- | ------ |
| `tenant_domain_hostname_verifiable` | `length(hostname) <= 239`. `_reqro-verify.` costs 14 of DNS's 253 octets, so a longer hostname could be registered but never verified. The migration refuses to apply if such a row already exists |
| `tenant_domain_challenge_window` | A challenge window exists exactly while a challenge does: both columns null when `unverified`, both present when `pending` or `verified` |
| `tenant_domain_challenge_bounds` | Expiry is after the request instant and at most 30 days beyond it |

Expiry is **database-backed, not caller-supplied**: the trigger assigns
`verification_requested_at = clock_timestamp()` on every challenge issuance
and re-checks the bounds against that value, so no caller can backdate or
widen a window. A new immutable helper,
`tenant_domain_challenge_live(requested, expires, instant)`, mirrors the
`resident_review_unexpired` pattern already used for review approvals.

The `guard_tenant_domain` trigger gains:

- `pending → verified` requires an unchanged token, challenge, request instant
  and expiry, non-null evidence, **and a live window** — an expired challenge
  raises `Tenant domain challenge has expired`.
- A `pending → pending` **replacement** branch, which requires a genuinely new
  token and challenge value, re-anchors the request instant and re-checks the
  bounds. The previous challenge stops working the moment this commits.
- Insert still refuses any binding that arrives with a challenge already set.

### `tenant_domain_verification_attempt`

Append-only evidence for **every** attempt, including failures that change no
registry state. These cannot live in `tenant_domain_audit`: that table is
keyed `unique(tenant_domain_id, revision)` and its trigger requires each row to
mirror committed state, so an attempt that bumps no revision has nowhere to go
there.

Captured: binding, token identifier, record name, expected challenge hash,
observed matching-value hash when applicable, observed value count,
database-assigned observation instant, resolver mode, authoritative NS
**names**, agreement count, degraded-single-NS flag, TXT TTL, DNSSEC
observation, result category, operator actor, correlation id, policy version
and the binding revision observed against.

Deliberately **not** stored: raw DNS response payloads, resolver IP addresses,
raw tokens duplicated into evidence, and anything customer-personal.

Database-enforced integrity: a `before insert` trigger requires the row to
match the committed binding and refuses any `record_name` not equal to
`'_reqro-verify.' || hostname`, so evidence cannot be attributed to a name the
registry never queried. `check((dnssec->>'validated')='false')` makes a claim
of cryptographic DNSSEC validation **unstorable** in this slice. Update,
delete and truncate all raise.

### Rollback

`down()` refuses when any attempt evidence exists or any binding has left
`unverified`/become active, drops the table, columns and constraints, and
restores the Migration 45 trigger body verbatim. Apply → rollback → reapply is
proven on the disposable database. No prior migration is edited.

### Explicitly deferred from Migration 46

`platform_delegation`; scheduled re-verification fields with no executor;
automatic grace-period deactivation machinery; hostname release/reassignment
state. Each remains a separate future decision.

## DNS challenge implementation

`server/src/tenancy/tenant-domain-challenge.ts` — pure, no I/O.

| Element | Value |
| ------- | ----- |
| Record name | `_reqro-verify.<canonical-hostname>` |
| TXT value | `reqro-site-verification=v1.<token>` |
| Token | 256 bits from `crypto.randomBytes(32)`, base64url, unpadded, 43 chars |

The record name is built from the already-canonical stored hostname and
nothing else, so an auditor can reproduce it from the row alone. It is **never
passed through `normalizeHostname`** — the normalizer rejects underscores by
design, and the challenge name intentionally sits outside the stored hostname
grammar. A test asserts exactly that, including the rejection reason.

The token is **stable for the lifetime of a verified binding and is not
consumed on success**. It is single-binding, single-purpose and bound to the
exact hostname; a token published under another name proves nothing. Rotation
before verification replaces it immediately. **Rotation of a verified binding
is not permitted in this slice** — `issue-challenge` refuses a verified
binding and directs the operator to revoke first.

Challenge lifetime defaults to 14 days, is configurable, and is clamped to a
hard maximum of 30 both in code and independently in the database.

## Authoritative resolver and quorum behavior

`server/src/tenancy/tenant-domain-verifier.ts`, behind an injectable `DnsPort`
so the quorum rules are testable without a network.

Queries go to the zone's **authoritative name servers**, not a recursive
resolver, so a stale cache cannot satisfy a challenge. The production port
walks up from the queried name to the closest delegation point, resolves those
name servers, and asks each directly. It stops while at least two labels
remain, so a missing delegation reports `zone_undetermined` rather than
escalating to a TLD's servers. Timeout and retries are bounded
(`TENANT_DOMAIN_DNS_TIMEOUT_MS`, default 3000; `TENANT_DOMAIN_DNS_TRIES`,
default 2). DNS only — no HTTP fetch — so the ADR-019 outbound-fetch surface
stays out of scope.

Quorum, applied in order:

1. **Disagreement fails closed.** If any reachable server answers without the
   expected value while another has it, the result is `disagreement`. A zone
   mid-change is not proof of control.
2. **Two or more NS records require two agreeing servers.** If only one can be
   reached, the result is `insufficient_quorum` — it **never** silently
   degrades to one-server proof.
3. **A genuinely single-NS zone** verifies on that one server, recorded
   explicitly with `agreementCount = 1` and `degradedSingleNs = true`.

Duplicate NS names are collapsed before counting, so one server cannot
masquerade as two-server agreement. Name-server count is bounded at 8.

### DNSSEC

Node's standard resolver cannot request RRSIG/DNSKEY records and performs no
signature validation, so in this slice DNSSEC is **not observable** and
`validated` is always `false`. No security decision depends on it, and the
database refuses to store a row claiming otherwise. The `DnssecObservation`
shape exists so a future validating resolver can populate it without a schema
change. No new DNS dependency was added.

## CLI operations

`npm run dev:tenant-domain` gains `issue-challenge`, `verify`, `activate` and
`revoke` alongside `list`, `register` and `deactivate`. Preserved unchanged:
`--dry-run`/`--confirm`, mandatory expected-revision concurrency control,
operator attribution, audit evidence, and the development-profile plus
approved-local-database gates. Failures still print one generic message and
echo no registry state.

No HTTP or Admin API. No tenant self-service.

- `issue-challenge` returns the exact record name, type and value to publish,
  plus the expiry. Refuses a verified binding.
- `verify` performs the DNS check and records an attempt whether or not it
  succeeds. Requires `TENANT_DOMAIN_CORRELATION_ID`.
- `activate` **fails unless the binding is currently verified**.
- `revoke` **requires prior deactivation**; the two are never combined, so an
  availability decision is always made and attributed on its own.

The DNS lookup happens **outside** the database transaction, so a slow or
hostile name server cannot hold a row lock. The binding is then re-read under
lock and its token re-checked, so an observation made against a challenge
replaced mid-flight can never be applied.

## Evidence and audit behavior

State transitions continue through the immutable `tenant_domain_audit` with
its existing deferred constraint, now carrying `verification_requested`,
`verified`, `activated`, `deactivated` and `verification_revoked`. Attempt
evidence — successes and failures alike — goes to the new append-only table.

A **failed** verification therefore produces an attempt row and nothing else:
no revision bump, no audit row, no change in resolvability. A **successful**
one produces the attempt, the state transition and the audit row atomically.

## Runtime boundary

**Unchanged.** `bootstrap.ts`, `app.module.ts`, Resident Experience,
`staff-access.guard.ts`, request TenantContext, trusted-proxy handling, CORS,
throttler, frontend API base and notifications are all untouched.
`assertServableTenantStrategy` still refuses the `registry` strategy, and
`TenancyModule` is still not imported. The registry remains unservable and
fail-closed at application startup.

DNS verification is operator-triggered only and is unreachable from any
resident request path.

## Validation record

Every invocation that occurred is recorded. Where a suite was rerun, the
earlier result is preserved rather than replaced: a clean rerun is
supplemental evidence, not a correction of a failed invocation.

### Focused units

| Suite | Result |
| ----- | ------ |
| Challenge and verifier units | **28/28 passed** |
| All tenancy units (challenge, verifier, normalizer, resolver, Slice 0) | **63/63 passed** |

### Focused disposable PostgreSQL — Migration 46

| Invocation | Enumerated | Passed | Failed |
| ---------- | ---------- | ------ | ------ |
| 1 | 17 | 9 | **8** |
| 2 | 17 | **17** | 0 |

**Invocation 1 is not superseded, and its failure was genuine.** The database
controls worked; the implementation was wrong.

- **Defect.** `verifyTenantDomain` recorded `binding_revision` as the
  *post*-transition revision (`binding.revision + 1`) while inserting the
  attempt row *before* the `tenant_domain` update. The
  `guard_tenant_domain_attempt` trigger correctly refused it with
  `Verification attempt must record the committed binding state`. Six further
  subtests cascaded from the same cause, because they verify as a setup step.
- **Correction.** The attempt now records `binding.revision` — the revision
  the observation was actually made against — in both outcomes. `agreement_count`
  likewise records what was observed rather than being zeroed on failure.
- **A second failure was a defect in the test, not the code.** The expiry
  subtest tried to shrink a challenge window with an unaudited raw `UPDATE`,
  which the trigger rightly refused: a window cannot be shrunk in place, since
  `pending → pending` only accepts a genuinely new token. The test was
  rewritten to issue a replacement challenge with a one-second window through
  a properly audited transition and let it lapse.

**No assertion was weakened, no timeout increased, no test disabled and no
expected behavior changed to obtain a pass.**

| Regression | Result |
| ---------- | ------ |
| Migration 45 registry suite, unchanged by this slice | **14/14 passed** |

### Full serial disposable PostgreSQL suite

Run with `--test-concurrency=1` against `reqro_f0592_test` as
`reqro_test_user`, per the open TEST-MAINT item.

| Invocation | Enumerated | Passed | Failed | Skipped |
| ---------- | ---------- | ------ | ------ | ------- |
| 1 | 299 | 294 | **5** | 0 |
| 2 | 695 | **695** | 0 | 0 |

**Invocation 1 is not superseded.** Its five failures were traced to an
inherited `CITYVUE_ENABLE_EXTERNAL_IDENTITY` in the executing shell without
the complete Entra configuration the suites expect — the same ambient
condition recorded in F060.1. Two failed directly with
`Invalid server configuration: external identity opt-in requires complete
Entra configuration`; the remaining three (`F048`, `F049`, `F050` in
`request-audience.integration.test.js`) were `parentAlreadyFinished` cascades
from the aborted file. All five are in pre-existing files that this slice does
not touch. The lower enumerated total in invocation 1 reflects that abort
truncating subtest enumeration.

Invocation 2 removed only that unrelated ambient variable from the child
environment; no source, assertion or test changed. Its 695 reconciles with the
678 recorded for F060.1 plus the 17 this slice adds, so no pre-existing
coverage regressed.

### Backend units and API E2E

| Suite | Invocation 1 | Later |
| ----- | ------------ | ----- |
| Backend unit suite | **549/549 passed** | — |
| API E2E | 48 passed / **3 failed**, aborting before full enumeration (51 counted) | **68/68 passed** |

The E2E failures share the root cause above: the suites clear `ENTRA_*` but
not the ambient opt-in. The rerun removed only that variable.

### Other checks

| Check | Result |
| ----- | ------ |
| Backend typecheck | passed |
| Test compilation | passed |
| Backend build | passed |
| Lint | passed |
| Shared tests | **64/64** |
| `git diff --check` | passed |
| Formatting, changed files | passed |

Five changed files required formatting and were formatted **individually**.
Repo-wide `npm run format` was deliberately not run: it rewrites the whole
tree to LF on this `core.autocrlf=true` checkout. Unrelated files were not
normalized.

### Environment note

Database validation used operator-supplied credentials for the disposable
database, held in a gitignored `server/.env.test.local`, read by a scratch
runner that split each line on the first `=` only and injected the values
solely into child process environments, with captured output redacted. The
runner verified host, database and user before connecting. That file was never
tracked and has been removed. No automated test or CLI run touched
`reqro_dev`, and Migration 46 was never applied to it.

## Known limitations

1. **Re-verification is manual.** No scheduler exists in the platform, so
   periodic re-confirmation and automatic deactivation after grace are
   deferred along with the availability review they need.
2. **Platform fallback verification is unimplemented.** `platform_delegation`
   is architecturally accepted but absent from schema and code.
3. **Hostname reassignment remains impossible.** Hostnames are globally
   unique, immutable and never deleted, so a domain cannot legitimately move
   between Organizations. Recorded as a future explicitly reviewed feature.
4. **No production operator path.** The CLI is gated to the approved local
   development database, so verification is exercisable only against
   development and disposable databases — the same gap ADR-027 records for
   bootstrap and recovery.
5. **DNSSEC is unobservable** with the current resolver, as described above.
6. A compromised customer DNS account is indistinguishable from legitimate
   control. Now recorded explicitly in ADR-025.

## ADR-025 amendment

The five authorized security clarifications were added as an
`#### Accepted clarifications` block under the existing
`### DNS, TLS and domain ownership` section: what a `TXT` check proves and
does not prove; the compromised-DNS-account limitation; verification and
activation as separate controls; customer `TXT` versus deferred platform
fallback; and deferred automated re-verification/deactivation. ADR status
remains **Accepted** and no unrelated decision was rewritten.

### Second stale statement reported, not edited

ADR-025's "Implementation state" paragraph still says *"No tenant-domain
registry, hostname normalizer, forwarded-header policy, request TenantContext
or service/repository Organization refactor exists."* The registry and
normalizer now exist (F060.1), so that sentence is **stale**. It was **not**
edited here, because this authorization covers only the five listed
clarifications. It needs a separate explicit factual amendment, in the same
way the `TEST_DATABASE_URL` sentence was handled.

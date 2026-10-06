# F060.1 — Tenant-domain registry foundation (ADR-025 Slice 1a)

Status: **architecture/security review PASSED.** Approved for one source-control
checkpoint on `claude/tenant-domain-resolution`, parent
`2df0fbe7828bd6a7a80d5a39e86cefc38e4c244c`. Not merged to `main`, not deployed.
Migration 45 has **not** been applied to `reqro_dev`. Slice 1b is not
authorized and is not started.

## Authorization and baseline

Implemented under the ADR-025 Slice 1a implementation authorization. Verified
baseline: branch `claude/tenant-domain-resolution` in the
`cityVUE-claude-tenant-resolution` worktree, HEAD
`2df0fbe7828bd6a7a80d5a39e86cefc38e4c244c`, clean index and working tree.
Forty-four migrations existed before this work; `20261015000000` was re-checked
as the next free ordinal immediately before authoring.

The authorization permits exactly one `server/package.json` change — the
tenant-domain operator CLI script — and **no dependency changes**. Both hold.

Slice 1a is a **foundation slice only**. It does not make the registry
strategy servable. Everything listed under "Deferred to Slice 1b" below is
untouched.

## What this slice adds

A persistence and domain foundation for [ADR-025](../architecture/decisions/ADR-025-trusted-production-organization-resolution.md)
hostname-based anonymous Organization resolution:

- Migration 45, adding `tenant_domain` and `tenant_domain_audit`.
- A pure hostname normalizer.
- A tenant-domain repository, a tenant resolver service and a tenancy module.
- A guarded operator CLI for registry registration, listing and deactivation.

Nothing in this slice is reachable from an HTTP request.

## Migration 45 — `20261015000000-add-tenant-domain-registry.ts`

### `tenant_domain`

UUID primary key, `organization_id` referencing `organization(id)`, the
canonical normalized `hostname`, a `role` of `public_canonical`,
`public_alias` or `platform_fallback`, a `verification_state` of
`unverified`, `pending` or `verified`, an `active` flag, verification
metadata (`verification_method`, `verification_challenge`,
`verification_requested_at`, `verified_at`, `verification_evidence`), a
`revision` and timestamps. It also carries `unique(organization_id, id)`, the
repository's composite-Organization foreign-key convention, which the audit
table targets.

Controls enforced in the database, not only in application code:

| Requirement | Control |
| ----------- | ------- |
| Hostname globally unique | `unique` on `hostname` |
| Exact matching only, no wildcards | A canonical-form `check` constraint: lower case, LDH labels of 1–63 octets each starting and ending alphanumeric, total length 1–253. A wildcard, port, trailing dot, underscore, empty label, uppercase letter or comma-joined value cannot be stored at all |
| No IP-literal records | `check(hostname !~ '(^\|[.])[0-9]+$')` — a numeric rightmost label is refused |
| At most one `public_canonical` per Organization | Partial unique index on `organization_id where role='public_canonical'` |
| Inactive or unverified binding cannot resolve | `check(not active or verification_state='verified')`, plus the resolver's own predicate |
| Verified state implies recorded evidence | Per-state `check` constraints requiring method, challenge, request time and evidence to be present exactly when the state demands them |
| No default domain data, no production hostname seed | The migration inserts nothing |

A `before insert or update or delete` trigger enforces the rest: a binding must
be created unverified and inactive at revision 1; `id`, `organization_id`,
`hostname` and `created_at` are immutable; `revision` must advance by exactly
one; verification may only move `unverified → pending → verified`, with the
`pending → verified` step requiring the previously issued challenge and
non-null evidence; recorded evidence is immutable once verified; only a
verified binding may be activated. **There is no transition that marks a
hostname verified without evidence**, including by direct SQL.

Bindings are **deactivated, never deleted**: `delete` and `truncate` both
raise, so audit evidence can never be orphaned.

### `tenant_domain_audit`

Append-only operator-change evidence following the repository's existing audit
conventions ([ADR-023](../architecture/decisions/ADR-023-administrative-access-management-controlled-delegation.md)):
composite `foreign key(organization_id, tenant_domain_id)`, prior/new values
for role, verification state and active flag, a `check` tying `registered` to
revision 1 with null priors and every other action to `revision = prior + 1`,
and `before update or delete or truncate` triggers that raise.

Audit is **mandatory, not best effort**. A deferred constraint trigger on
`tenant_domain` requires a matching audit row written in the same transaction,
so a binding that changed without operator evidence fails at commit. A
complementary `before insert` trigger on the audit table requires each row to
match the committed binding state, so the two cannot drift.

### Rollback

`down()` locks both tables and refuses when any audit evidence exists or any
binding is active or has left the `unverified` state:
`Retained tenant domain evidence prevents rollback`. Because every mutation
requires audit evidence, in practice rollback succeeds only on a genuinely
empty registry. Apply → rollback → reapply is proven on the disposable
database. No prior migration is edited.

## Hostname normalizer — `server/src/tenancy/tenant-hostname.ts`

A pure function with no I/O, no configuration and no registry access. It
returns either the single canonical hostname or a rejection reason. Order
matters and is deliberate:

1. Reject non-string, empty, and input longer than 1024 characters.
2. Reject control characters (`U+0000`–`U+001F`, `U+007F`).
3. Reject comma-joined or repeated `Host` values — never merged, never split.
4. Reject underscores and `*`, so no wildcard record can ever be expressed.
5. Reject `[`/`]` as an IP literal, then reject whitespace, `/`, `\`, `?`,
   `#`, `@`, `%`, quotes and other characters that cannot appear in a host.
   **`%` is refused before the IDNA layer**, which would otherwise
   percent-decode `%65xample.gov` into `example.gov`.
6. Strip a valid port (1–65535); any remaining colon is an unbracketed IPv6
   literal and is rejected, as is a malformed port.
7. Strip exactly one trailing dot. A second one leaves an empty label, which
   fails validation.
8. Convert with Node's platform-standard `domainToASCII` (UTS#46): case
   folding, Unicode mapping and punycode A-label conversion. Already-encoded
   A-labels pass through unchanged, so normalization is idempotent.
9. Enforce DNS limits: total ≤ 253 octets, each label ≤ 63 octets, LDH only,
   no leading or trailing hyphen.
10. Reject a numeric rightmost label.

**IP-literal handling is explicit: every form is rejected.** An address
literal cannot hold DNS `TXT` ownership evidence, so it can never satisfy
ADR-025 verification. Bracketed and bare IPv6, dotted IPv4, and the shorthand
forms the URL layer expands (`127.1` → `127.0.0.1`) are all refused. Two
controls can reach that outcome — the numeric-label rule, and `domainToASCII`
itself returning empty for a malformed address such as `example.123` — and
the tests record which applies where.

## Repository and resolver

`TenantDomainRepository.findResolvable` performs the only lookup: exact
equality on an already-normalized hostname, joined to `organization`, with
`active`, `verification_state = 'verified'` and `organization.status =
'active'` applied **in SQL**, so an unusable row never reaches application
code. It reads up to two rows so ambiguity is detectable rather than silently
resolved.

`TenantResolverService.resolve` normalizes, looks up, and returns a
`ResolvedTenant` only when exactly one binding comes back. Every other
outcome returns `null` with no reason code, no partial context and no
fallback, so unknown, malformed, inactive, unverified, ambiguous and suspended
cases are indistinguishable and the resolver cannot become a
tenant-enumeration oracle.

The resolver reads **no configuration**. It holds no reference to the
development Organization setting, so the development strategy cannot leak into
registry resolution and a registry miss cannot degrade into a default tenant. A
test asserts this against the emitted modules.

`TenancyModule` is deliberately **not** imported by `AppModule`.

## Operator CLI — `npm run dev:tenant-domain`

The single authorized `server/package.json` addition. Operations: `list`,
`register` and `deactivate`, with `--dry-run` or `--confirm`. Registration,
verification, activation, canonical promotion and revocation are
platform-operator capabilities over a globally shared hostname namespace, so
this functionality is **not** exposed through any HTTP or Admin API.

Gates, following the existing `access-administrator-cli.ts` pattern:
`NODE_ENV=development`, `CITYVUE_DEPLOYMENT_PROFILE=development`, explicit
`TENANT_DOMAIN_OPERATOR_CONFIRM=true`, and the approved local database
(`localhost`, `reqro_dev`, `reqro_dev_user`). Selection comes from the
environment, never from arguments. Failures print one generic message and
echo no registry state, because the namespace is global across customers.

`register` always produces an **unverified, inactive** binding, which cannot
resolve. A dry run runs every check, forces the deferred audit constraint, and
rolls back. `deactivate` is revision-checked and can only ever remove a
hostname from resolution.

**There is no verify or activate operation.** No production domain can be
created, and nothing becomes servable.

## Did DNS verification fit safely in Slice 1a? No — reported as a gap

Registration is implemented in the unverified/inactive state and verification
is **not** implemented, as the authorization directs when proper ownership
verification would materially enlarge the slice.

A `resolveTxt` call is small, but the security-relevant decisions around it are
not decided by ADR-025 and must not be invented here:

1. **Challenge record name, token format, entropy and lifetime** are
   undefined. These set the replay window and the forgery cost.
2. **Resolver trust.** ADR-025 does not say whether verification must be
   DNSSEC-validated or which resolver is authoritative. A plain `resolveTxt`
   from an operator workstation trusts the local stub resolver, which is a
   weaker control than a reviewed design would accept.
3. **Re-verification and expiry.** Whether verification decays, and how a
   stale mapping for a domain a customer no longer controls is detected — a
   top-ranked residual risk in ADR-025 — is undecided.
4. **Activation policy.** Whether verification implies activation, and who
   performs canonical promotion, is undecided.

What this slice does instead is make the gap structural rather than
procedural: the schema models the full lifecycle, and the trigger refuses any
path into `verified` that is not a `pending → verified` transition carrying
the issued challenge and recorded evidence. Because no code path issues a
challenge, `verified` is unreachable through application code. A hostname
cannot become servable because an operator typed it, and no
"trust me" switch exists to be misused later.

**Slice 1b must decide items 1–4 before verification is implemented.**

## Deferred to Slice 1b — untouched

HTTP request `TenantContext`; `bootstrap.ts` production registry activation;
`app.module.ts` request wiring; Resident Experience services;
`staff-access.guard.ts`; the other Organization consumers; throttler tenant
dimensions; per-tenant CORS; frontend API-base conversion; and trusted-proxy /
`X-Forwarded-Host` runtime handling. Trusted-proxy configuration belongs with
Slice 1b because Slice 1a consumes no request-host information; Express's
default behavior is unchanged.

## Security invariants preserved

Unknown hostnames fail closed. Duplicate and ambiguous hostnames are
impossible at the database level and fail closed in the resolver anyway. There
is no query, body, header or browser Organization selector. There is no
production-to-development fallback and no development fallback of any kind. No
wildcard client-domain matching is expressible. Staff Organization remains
identity-derived and is not touched. The hostname is a lookup key, not an
authorization credential. No shared-SaaS tenancy is introduced; under
deployment-per-tenant the registry simply holds one approved Organization.

No permission keys, no default grants, no role/bundle/delegation changes and no
Resident Experience schema changes.

## Runtime behavior

**Unchanged.** `assertServableTenantStrategy` in `bootstrap.ts` is untouched and
still refuses to serve under the `registry` strategy. `TenancyModule` is not
imported. Migration 45 adds two new tables and alters none, and has not been
applied to any development database. The only `server/package.json` change is
one script.

## Validation record

Every invocation that occurred is recorded. Where a suite was rerun, the
earlier result is preserved rather than replaced: a clean rerun is
supplemental evidence, not a correction of a failed invocation.

### Focused

| Suite | Result |
| ----- | ------ |
| Tenancy units (normalizer, resolver, existing Slice 0 tests) | **35/35 passed** |
| Migration 45 on disposable PostgreSQL | **14/14 passed** |

### Full disposable PostgreSQL suite

Run serially with `--test-concurrency=1` against `reqro_f0592_test` as
`reqro_test_user`, per the open TEST-MAINT item.

| Invocation | Enumerated | Passed | Failed | Skipped |
| ---------- | ---------- | ------ | ------ | ------- |
| 1 | 282 | 277 | **5** | 0 |
| 2 | 678 | **678** | 0 | 0 |

**Invocation 1 is not superseded.** Its five failures were traced to an
inherited `CITYVUE_ENABLE_EXTERNAL_IDENTITY` in the executing shell without
the complete Entra configuration the suites expect. Two failures raised
`Invalid server configuration: external identity opt-in requires complete
Entra configuration` from pre-existing environment validation in
app-constructing tests; the remaining three (`F048`, `F049`, `F050` in
`request-audience.integration.test.js`) were `parentAlreadyFinished` cascades
from the aborted file, not independent defects. The lower enumerated total in
invocation 1 reflects that abort truncating subtest enumeration.

Invocation 2 removed only that unrelated ambient variable from the child
environment. No source, assertion, timeout or test was changed, and nothing
was disabled. Its 678 reconciles with the recorded 664-test baseline plus the
14 tests this slice adds, so no pre-existing coverage regressed.

### Backend units

| Invocation | Result |
| ---------- | ------ |
| 1 | **520/521 — one failure** |
| 2–5 | 521/521 |

The first invocation's failing test was **not captured** and is therefore
recorded as an unidentified failure, not as a pass. Four subsequent clean
full-suite runs are supplemental evidence only; the first invocation stands as
a failure in this record.

### API E2E

| Invocation | Result |
| ---------- | ------ |
| 1 | 48 passed / **3 failed**, aborting before full enumeration (51 counted) |
| 2 | **68/68 passed** |

Same root cause as the database suite: the inherited external-identity opt-in
without complete Entra configuration. The suites clear `ENTRA_*` but not that
variable. Invocation 2 removed only that variable.

### Other checks

| Check | Result |
| ----- | ------ |
| Backend typecheck | passed |
| Test compilation | passed |
| Backend build | passed |
| Lint | passed |
| Shared tests | **64/64** |
| `git diff --check` | passed |
| Formatting, Slice 1a files | passed |

Repo-wide `prettier --check` reports 386 files, including many this slice
never touched, as unformatted. This is a **pre-existing CRLF/LF condition** on
a Windows checkout with `core.autocrlf=true` against Prettier's
`endOfLine: "lf"` default, not a product of this work. Unrelated files were
deliberately **not** normalized. `npm run format` rewrites the whole tree to
LF and should not be run on this worktree; git treats the result as no content
change, but it makes the working tree diverge from checkout state.

### Environment note

Database validation required operator-supplied credentials for the disposable
database. They were held in a gitignored `server/.env.test.local`, read by a
scratch runner that split each line on the first `=` only and passed the
values solely into child process environments, with captured output redacted.
That file was never tracked and has been removed. No automated test or CLI
run touched `reqro_dev`, and Migration 45 was never applied to it.

## Known limitations

1. Ownership verification is unimplemented, as recorded above.
2. The resolver has no caching or registry-unavailability policy; ADR-025
   requires that resolution failures are never cached, which a cache design in
   Slice 1b must honor.
3. `tenant_domain_audit.actor` is a free-text operator reference, not a
   `staff_identity` foreign key, because platform-operator identity is not
   modeled. Tying operator actions to a principal is a Slice 1b or
   ADR-027-adjacent concern.
4. The CLI is gated to `reqro_dev`, but Migration 45 is not applied there under
   this authorization, so the CLI has not been exercised end to end outside
   the disposable test database.

## ADR-025 factual amendment required — reported, not edited

ADR-025 states under "Evidence required before implementing the resolver" that
the required database coverage _"cannot currently be executed because
`TEST_DATABASE_URL` is not configured in this environment."_ That sentence is
**stale**: `docs/ROADMAP.md` now records the disposable database
`reqro_f0592_test` and role `reqro_test_user` as available and validated, and
both exist locally.

Per the implementation authorization this sentence has **not** been edited as
part of this work. It needs a separate, explicit factual amendment.

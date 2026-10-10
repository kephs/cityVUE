# F062.2B — Connector metadata persistence foundation

Baseline `880cf42373384997c34db27efa15def34ae58439` (authoritative `main`, carrying [F062.1 integration contracts](F062-1-integration-contracts-foundation.md) and the [F062.2A persistence readiness assessment](F062-2A-transactional-outbox-persistence-readiness.md)).

> **NO external integration traffic is enabled by F062.2B.**

**Status: implemented, pending review.** This slice adds two PostgreSQL tables, their guards, a data-access layer and tests. It adds **no outbox, no delivery attempt table, no inbox, no external-reference table, no reconciliation table, no worker, no queue or broker, no HTTP client, no webhook, no vendor adapter, no credential, no secret, no cloud resource and no deployment change.** No ADR number is allocated. **Production deployment remains unauthorized.**

A connector row is a _declaration_ that a destination exists and what it can do. Nothing reads it to dispatch anything, because no dispatch code exists anywhere in the repository.

## Migration

**Ordinal 50 — `server/migrations/20261020000000-add-integration-connector-registry.ts`.** Migration count moves 49 → 50. Only the connector metadata and audit migration from F062.2A's bounded plan; the outbox and attempt migrations are not created.

Follows the established conventions measured in F062.2A §1: raw SQL through kysely's `sql` tag, an `/** Ordinal N. ... */` header naming the governing decision, `set local lock_timeout = '5s'` with an explicit `lock table`, `clock_timestamp()` rather than `now()`, `varchar` + `check (x in (...))` rather than PostgreSQL enum types, and a `down()` that refuses rather than discarding evidence.

**The migration grants nothing and alters no existing table**, asserted by test. `deploy/database/runtime-role.sql` is untouched — see [Grant disposition](#grant-disposition).

## Schema

### `integration_connector`

Root integration table, so it references `organization(id)` directly and exposes `unique (organization_id, id)` for children.

| Column                                                | Type                                             | Notes                                                                                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                                  | `uuid pk default gen_random_uuid()`              | immutable                                                                                                                                             |
| `organization_id`                                     | `uuid not null references organization(id)`      | immutable                                                                                                                                             |
| `connector_key`                                       | `varchar(64) not null`                           | `check (~ '^[a-z][a-z0-9-]{2,62}$')`, matching F062.1's `CONNECTOR_ID` grammar. `unique (organization_id, connector_key)` — **never globally unique** |
| `connector_kind`                                      | `varchar(40) not null check (in 4 values)`       | A **capability profile**, never a vendor product: `loopback`, `work_management`, `asset_management`, `service_request_exchange`. Immutable            |
| `lifecycle_state`                                     | `varchar(12) not null default 'configured'`      | exactly F062.1 `connectorLifecycleStates`                                                                                                             |
| `configuration_revision`                              | `integer not null default 1 check (> 0)`         | the **semantic pin**; advances only on a behaviour-relevant change                                                                                    |
| `record_revision`                                     | `integer not null default 1 check (> 0)`         | the **mutation-concurrency token**; advances on every accepted change. `check (configuration_revision <= record_revision)`                            |
| `operations`                                          | `text[] not null default '{}'`                   | `cardinality between 0 and 5`, `<@` the closed F062.1 operation set, non-repeating (guard)                                                            |
| `supports_idempotency_key` … `reports_terminal_state` | `boolean not null default false`                 | one column per F062.1 capability field                                                                                                                |
| `supports_ordering`                                   | `varchar(14) not null default 'none'`            | `none` / `per_aggregate`                                                                                                                              |
| `side_effect_risk`                                    | `varchar(12) not null default 'irreversible'`    | the four F062.1 risks                                                                                                                                 |
| `credential_reference`                                | `varchar(200)`                                   | **non-secret metadata by contract** (see [Credential reference](#credential-reference)); bounded by grammar as defence-in-depth                       |
| `created_at` / `updated_at`                           | `timestamptz not null default clock_timestamp()` | `created_at` immutable                                                                                                                                |
| `disabled_at`                                         | `timestamptz`                                    | set on entering `disabled`, **never cleared** on re-enable, so operational history survives                                                           |
| `retired_at`                                          | `timestamptz`                                    | biconditional with `lifecycle_state = 'retired'`, and immutable once set                                                                              |

**The defaults are F062.1's `NO_CAPABILITIES`, including `side_effect_risk = 'irreversible'`.** A destination supports nothing and is assumed consequential until it declares otherwise, so a half-configured connector fails safe rather than appearing permissive.

### `integration_connector_audit`

Per-mutation history, keyed by `record_revision`, carrying a full capability snapshot plus `configuration_revision`, `prior_record_revision`, `prior_configuration_revision`, `prior_lifecycle_state`, `change_category`, `revision_advanced`, `actor`, `correlation_id`, `changed_at` and `mutation_txid`.

`unique (organization_id, integration_connector_id, record_revision)` makes **one audit row per accepted mutation** structural. `record_revision` replaced a separately computed audit sequence deliberately: two independent counters would have to be kept in agreement, and the connector row already holds an authoritative one.

It answers one question precisely: **what configuration and capabilities were authoritative at revision N.** F062.2A §9.2 depends on that read — resolving a past ambiguous delivery must use the capabilities that governed _that_ dispatch, not whatever the connector declares now.

`credential_reference_present boolean` records **presence only**. The reference value is deliberately not copied into history: "was a credential configured at revision N" is answerable without retaining anything identifying which one.

## Tenant isolation

Structural, not procedural. Each property is a schema constraint, proven by test.

| Property                                     | Mechanism                                                                                                                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization ownership on every row          | `organization_id uuid not null`, made immutable by the guard                                                                                                                                                                                                                    |
| Cross-tenant reference inexpressible         | `foreign key (organization_id, integration_connector_id) references integration_connector(organization_id, id)` — the _pair_ is the referent, so Organization B cannot reference A's connector: the row would have to carry A's `organization_id`, at which point it is A's row |
| `connector_key` unique per Organization only | `unique (organization_id, connector_key)`. The same key in a different Organization is **permitted and tested**, because a global key namespace is precisely the cross-tenant coupling F062 Part 6 forbids                                                                      |
| No global fallback                           | `integration_connector_id` on the audit is `not null`; there is no default connector row, no catch-all and no nullable owner                                                                                                                                                    |
| No connector ID forgery across Organizations | every repository read and write carries `organization_id`; a scoped predicate cannot reach another tenant's row                                                                                                                                                                 |
| No cross-tenant existence disclosure         | `connector_unknown` covers both "no such connector" and "belongs to another Organization" — there is deliberately no distinct code, asserted by test                                                                                                                            |

## Lifecycle

Exactly F062.1's five states. No state is invented. Transitions are a closed whitelist, declared as data in `connectorLifecycleTransitions` and enforced again by the database guard:

| From         | To                                |
| ------------ | --------------------------------- |
| `configured` | `active`, `disabled`, `retired`   |
| `active`     | `degraded`, `disabled`, `retired` |
| `degraded`   | `active`, `disabled`, `retired`   |
| `disabled`   | `active`, `retired`               |
| `retired`    | — **terminal**                    |

- **`retired → active` is refused**, as required: a decommissioned integration must not quietly resume and flush a months-old backlog.
- **Nothing returns to `configured`.** A connector that has been live is not newly configured again.
- **`disabled → degraded` is not a transition.** Re-enabling goes to `active`; "working slowly" is reached from working, not from stopped.
- Disabling is reversible because it represents an outage, not a decision to discard — matching F062.1 `mayEnqueue`, where only `retired` refuses enqueue.

Both layers matter: the database is the boundary, and the application check exists so a caller receives `lifecycle_transition_unsupported` rather than a generic constraint failure.

## Capabilities

**Explicit columns, one per F062.1 `ConnectorCapabilities` field — not free-form JSON.** Every value is validated by a native constraint, with no parse step between the schema and its meaning, and the audit snapshot mirrors the same columns. The representation is validated, versionable (per `configuration_revision`), auditable (full snapshot per revision), deterministic (no serialisation order) and free of vendor assumptions.

**Deliberately no inferred couplings.** Nothing concludes that `supportsUpdate` implies the `updateRequest` operation, or that `reportsTerminalState` requires a webhook. F062.1 declares no such relationship, and inventing one in persistence would make this layer the author of contract semantics it does not own.

## Revision model

**Two counters with different jobs, because one counter cannot do both.**

| Field                    | Advances                                                                                       | Role                                                                                                                                               |
| ------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `configuration_revision` | only on a behaviour-relevant change — `lifecycle_state` or any of the twelve capability fields | The **semantic pin** a future outbox intent records (F062.2A §9.2). Historical ambiguity and retry analysis pins _this_, never the record revision |
| `record_revision`        | **every** accepted mutation, without exception, including a credential rotation                | The **optimistic-concurrency token**. Every mutation primitive requires an `expectedRecordRevision`                                                |

Both advance by **exactly one**; the guard refuses a skip, and refuses any update that does not advance `record_revision`.

**Why the second counter is necessary, and why the obvious alternative was rejected.** A credential rotation deliberately does not advance `configuration_revision`. With that revision also serving as the concurrency token, two concurrent rotations starting from the same value would _both_ satisfy `where configuration_revision = :expected` — the first commits without changing it, the second's predicate still matches, and the later write silently overwrites the earlier. That is a lost update, and it was a real defect in the first implementation of this slice.

The fix is a second counter, **not** making rotation configuration-significant. Promoting rotation to a semantic change would buy concurrency control by corrupting the meaning of the pin: every in-flight pinned revision would point at a superseded row, and operators would be told behaviour changed when it did not.

**Revision-significance is computed in one place** in the guard, and every boolean capability is independently asserted significant by test, so none can change without advancing the configuration revision. Rotation is still audited, as a **non-advancing** row sharing the current configuration revision, because changing which credential a destination uses is operationally significant even when semantically inert.

That split is what `revision_advanced` and the partial unique index exist for:

```sql
create unique index integration_connector_audit_revision
  on integration_connector_audit(organization_id, integration_connector_id, configuration_revision)
  where revision_advanced;
```

**Exactly one authoritative snapshot per configuration revision**, with rotation rows excluded. `capabilitiesAtRevision()` reads only `revision_advanced` rows, so a rotation can never be mistaken for the semantics of a revision — proven by a test in which four mutations produce exactly two semantic snapshots.

**Connector identity is immutable**: `id`, `organization_id`, `connector_key`, `connector_kind` and `created_at` cannot change. Rotation therefore never changes connector identity, and nothing in flight is invalidated. A semantic change and a rotation in one statement is refused, so the two cannot be conflated.

## Audit and history split

The migration carries this as a SQL `comment on table`, so it travels with the schema:

| Record                                        | Answers                                                             |
| --------------------------------------------- | ------------------------------------------------------------------- |
| `integration_connector_audit`                 | **What** connector configuration, capabilities and revision existed |
| Reqro's authoritative operator/security audit | **Who** authorized and performed the administrative change          |

`actor` and `correlation_id` are carried for **traceability only**. They are not authorization evidence, and this table must not be treated as having authorized anything.

**A reported gap, not a silent one.** The repository has no general-purpose operator/security audit table — each domain has its own `*_audit` (14 of them), and `tenant_domain_audit` serves as both for tenant domains. So there is today no separate authoritative record of who approved a connector change. Omitting `actor` entirely would have meant a connector could change with no attribution at all, which is worse; carrying it while refusing to call it authorization is the honest position. **The administrative surface that produces real authorization evidence — approval, independent review, dry-run/confirm — does not exist yet and is out of scope here.** It is listed under [Remaining work](#remaining-work).

**Audit evidence is mandatory, not best effort.** A `deferrable initially deferred` constraint trigger verifies at commit that a matching audit row exists in the same `txid_current()`. A connector change without evidence **aborts the transaction** — proven by test for both an update and an unaudited registration.

## Immutability

| Object              | Protection                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Audit rows          | `before update or delete` row trigger and `before truncate` statement trigger both raise `'Integration connector audit is append-only'` |
| Connector rows      | DELETE and TRUNCATE raise `'Integration connectors are retired, never deleted'`                                                         |
| Connector identity  | guard refuses any change to `id`, `organization_id`, `connector_key`, `connector_kind`, `created_at`                                    |
| Retirement evidence | `retired_at` cannot be altered or cleared                                                                                               |

There is **no generic UPDATE or DELETE path for historical audit rows**. Future retention or purge remains separately governed, as F062.2A §17.1 specifies: it is a privileged, audited operation under a distinct authority, never reachable by the application role.

## Repository operations

`server/src/integration/persistence/connector-metadata.repository.ts`. Repository/service primitives only — **no HTTP controller and no route**, since nothing in the existing architecture requires one for connector metadata.

| Operation                   | Behaviour                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `register`                  | Validates, Organization-shared-locks, refuses a duplicate key within the Organization, inserts at revision 1 in `configured`, writes `registered` audit evidence in the same transaction |
| `findById` / `findByKey`    | Organization-scoped reads. Both return `null` for "not found" and "another Organization's" alike                                                                                         |
| `listForOrganization`       | Scoped listing. **No global discovery**; F062 requires none                                                                                                                              |
| `changeLifecycle`           | `expectedRecordRevision`, transition whitelist, **both revisions + 1**, `lifecycle_changed` evidence                                                                                     |
| `updateCapabilities`        | `expectedRecordRevision`, contract validation, **both revisions + 1**, `capabilities_changed` evidence                                                                                   |
| `rotateCredentialReference` | `expectedRecordRevision`, grammar validation, **record revision + 1, configuration revision unchanged**, `credential_reference_rotated` evidence                                         |
| `listRevisions`             | Full mutation history, newest first by `record_revision`                                                                                                                                 |
| `capabilitiesAtRevision`    | Exact revision lookup over `revision_advanced` rows — the F062.2A §9.2 read                                                                                                              |

**Separation of concerns.** `connector-metadata.ts` holds the domain contract, validation and vocabulary and depends on no database type, Kysely or Nest — asserted by test — so validation is testable without a database. The repository holds data access only.

**Deliberately not re-exported from `src/integration/index.ts`.** F062.1's boundary suite resolves the module graph from that entry point and asserts the external import set is **exactly empty**; persistence necessarily imports Kysely and Nest. Keeping it out of the entry point preserves that proof rather than widening its allowlist, and the dependency runs one way: persistence imports the contracts, and no contract module imports persistence. Both directions are asserted by test, and F062.1's suite still passes **39/39 unchanged**.

## Concurrency

Optimistic, consistent with ADR-024 and the `tenant_domain` precedent, and **never last-write-wins**:

1. `organization` is `FOR SHARE`-locked first (ADR-024's barrier ordering, unchanged).
2. The connector row is `FOR UPDATE`-locked.
3. The caller's `expectedRecordRevision` is compared, and the `UPDATE` additionally carries `where record_revision = :expected`.

**`record_revision` is the only concurrency token.** `configuration_revision` is never used as one, which is what makes a semantically inert rotation safe against a concurrent writer.

A stale token is refused with the bounded `revision_stale` code — the same code whether the caller was mistaken or a concurrent writer won, so no caller can distinguish them and retry blindly.

Four database tests prove the behaviour against real PostgreSQL rather than asserting it:

| Proof                                                                          | Result                                                                                                                                                                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** Two credential rotations from the same record revision, run in parallel | **Exactly one applies**; the loser matches zero rows and writes no audit row; the surviving value is the winner's; `record_revision` reaches 2, not 3; a retry on the stale token is still refused |
| **B.** A rotation racing a semantic lifecycle update, run in parallel          | **Exactly one applies**; whichever loses leaks nothing — neither the credential reference nor the lifecycle change is present if that side lost; `record_revision` advances once                   |
| **C.** Rotation alone                                                          | `record_revision` + 1, `configuration_revision` **unchanged**                                                                                                                                      |
| **D.** Semantic change alone                                                   | **both** revisions + 1                                                                                                                                                                             |
| **E.** Four mutations                                                          | four ordered unique record revisions with correct `prior_record_revision` chaining, two semantic snapshots, and a duplicate record revision refused by constraint                                  |

The guard also refuses any mutation that does not advance `record_revision`, so the lost-update window is closed at the database rather than in the repository.

`FOR SHARE` on `organization` needs UPDATE privilege on at least one column of that table, which the runtime already holds; **no new privilege and no SECURITY DEFINER helper is introduced.**

## Fail-closed refusals

A closed vocabulary of ten codes: `connector_unknown`, `connector_key_invalid`, `connector_key_duplicate`, `connector_kind_invalid`, `capability_contract_invalid`, `credential_reference_invalid`, `lifecycle_transition_unsupported`, `revision_stale`, `organization_unavailable`, `change_not_permitted`.

No message names another Organization's data, and there is no code meaning "belongs to another tenant" — asserted by test.

## Privacy

Every persisted column is operational or configurational. Classification: **ID** (opaque identifier), **VOC** (closed vocabulary), **NUM**, **TS**, **BOOL**, **REF** (non-secret locator).

| Table                         | Columns                                                                                                               | Class                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `integration_connector`       | `id`, `organization_id`                                                                                               | ID                                        |
|                               | `connector_key`, `connector_kind`, `lifecycle_state`, `supports_ordering`, `side_effect_risk`, `operations`           | VOC                                       |
|                               | the ten capability booleans                                                                                           | BOOL                                      |
|                               | `configuration_revision`, `record_revision`                                                                           | NUM                                       |
|                               | `credential_reference`                                                                                                | **REF**                                   |
|                               | `created_at`, `updated_at`, `disabled_at`, `retired_at`                                                               | TS                                        |
| `integration_connector_audit` | identifiers, `correlation_id`                                                                                         | ID                                        |
|                               | `change_category`, plus the mirrored vocabulary and capability columns                                                | VOC / BOOL                                |
|                               | `record_revision`, `prior_record_revision`, `configuration_revision`, `prior_configuration_revision`, `mutation_txid` | NUM                                       |
|                               | `credential_reference_present`                                                                                        | BOOL — **presence, not value**            |
|                               | `actor`                                                                                                               | bounded operator label, traceability only |
|                               | `changed_at`                                                                                                          | TS                                        |

**Not persisted anywhere, and refused by constraint or structurally absent:** resident PII of any kind, names, email, phone, addresses, authorization headers, API keys, client secrets, access or refresh tokens, passwords, OAuth material, tracking credentials, raw vendor error text, vendor payload bodies and any free-text field.

### Credential reference

**The security contract is that `credential_reference` is non-secret metadata by contract — not by detection.** F062.2B:

- **never resolves it;**
- **never interprets it as credential material;**
- **never reads a secret;**
- **never performs authentication.**

The bounded grammar — matching `^[A-Za-z0-9][A-Za-z0-9._/-]{2,199}$` and not matching `[A-Za-z0-9+/=]{32,}` — is **defence-in-depth against accidental misuse, not a secret detector.** No constraint or regular expression can decide whether a string is secret, and nothing in this slice claims otherwise. What the grammar does is bound the field to a short, opaque, URL-free, whitespace-free token, so an obvious accidental paste is refused at the boundary rather than stored. That is useful, and it is all it is.

**The future secret-management architecture owns the reference namespace and the rules for resolving it.** Until it exists, this column is an opaque label this slice stores and never uses.

A source test additionally asserts the slice's executable code references no `process.env`, `apiKey`, `clientSecret`, `accessToken`, `refreshToken`, `password`, `authorization` or `bearer`.

## Grant disposition

**No grant file was modified. `deploy/database/runtime-role.sql` and `operator-role.sql` are untouched**, matching every other migration in this repository, which grants nothing.

Consequence, stated plainly: **`reqro_runtime` currently holds no privilege on either new table**, because the repository's bootstrap issues no default privileges — a new table is unreachable until granted deliberately. The repository layer is therefore schema-proven but not yet runtime-reachable, which is the correct fail-closed default and is why this slice proves schema and repository behaviour first.

Database integration tests are unaffected: they connect as the test owner and build a disposable schema, so they exercise real constraints without depending on runtime grants. The `database-role-separation` suite confirms the **canonical runtime privilege matrix is unchanged** — the new tables correctly do not appear in it.

**The exact grant change required before any runtime use, reported for review and deliberately not applied:**

```sql
-- deploy/database/runtime-role.sql, under "Append-and-read -- SELECT, INSERT"
grant select, insert on :"schema".integration_connector_audit to :"runtime";

-- under "Mutable application state -- SELECT, INSERT, UPDATE"
grant select, insert, update on :"schema".integration_connector to :"runtime";
```

`UPDATE` on `integration_connector` is needed both for revision advancement and because `FOR UPDATE` requires UPDATE privilege on the locked table (measured in Migration 49). No `DELETE` on either table, and `insert`-only on the audit — the established evidence pattern. **No worker role is created in this slice**, and F062.2A §19.1's worker-identity decision remains open and still gates F062.2D.

## Tests

### Database integration — `test/database/integration-connector.integration.test.ts`, **18/18 passing**

Written as direct SQL rather than through the repository, so a passing result cannot depend on application code.

| Proof                                                                                                                         | Result |
| ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| Create, read, Organization-scoped lookup                                                                                      | pass   |
| Duplicate `connector_key` in one Organization refused                                                                         | pass   |
| Same key in a different Organization permitted                                                                                | pass   |
| Forged cross-tenant audit reference refused by the database                                                                   | pass   |
| Lifecycle vocabulary closed; invalid state refused                                                                            | pass   |
| `retired → active` refused; nothing returns to `configured`; `disabled → degraded` refused                                    | pass   |
| Capability validation: unknown risk, unknown ordering, unknown operation, repeated operation, invalid key                     | pass   |
| Credential-shaped values refused; locator accepted; audit stores presence only                                                | pass   |
| Both revisions start at 1; a semantic change advances both by exactly one; skipping refused; a stale token matches zero rows  | pass   |
| **Two parallel rotations from the same record revision: exactly one applies, no silent overwrite**                            | pass   |
| **A rotation racing a semantic update: exactly one applies, neither leaks**                                                   | pass   |
| **Rotation advances only `record_revision`; a semantic change advances both**                                                 | pass   |
| **One unique ordered `record_revision` per accepted mutation; duplicate refused by constraint**                               | pass   |
| An update that does not advance `record_revision` is refused outright                                                         | pass   |
| Change without matching audit evidence **aborts at commit** (update and registration)                                         | pass   |
| Revision N keeps its own capabilities after revision N+1 changes them                                                         | pass   |
| Audit rows immutable to UPDATE, DELETE and TRUNCATE; connector not deletable                                                  | pass   |
| Rotation audited without advancing the revision; rotation + revision bump refused                                             | pass   |
| No-op update refused; identity change refused                                                                                 | pass   |
| **SQL lifecycle `CHECK` equals F062.1 `connectorLifecycleStates`**, read from `pg_constraint`                                 | pass   |
| Migration apply → rollback refused while evidence exists → evidence removed via privileged path → rollback → reapply → usable | pass   |

### Unit and source boundary — `test/unit/connector-metadata.test.ts`, **23/23 passing**

Lifecycle/capability/risk parity with F062.1; transition table covers exactly F062.1's states; `retired` terminal; `INITIAL_CAPABILITIES` is `NO_CAPABILITIES` itself; capability column mapping covers every contract field with none missed; round-trip without loss; every boolean capability independently configuration-significant; **every change category advances the record revision without exception, and exactly one category advances the record revision without advancing the configuration revision**; key grammar, kind, capability, credential-grammar and refusal-vocabulary validation.

Source assertions over executable code (comments and string literals stripped, so a stated prohibition does not flag itself): **no vendor or destination product name** (14 checked, including BlueDAG, Impresa, MGO and Microsoft); **no network client or transport**; **no secret or token access**; **no worker, scheduler or `SKIP LOCKED`**; **the migration creates exactly the two connector tables** and mentions no outbox, attempt, inbox, external-reference or reconciliation table; **the migration grants nothing and alters no existing table**; persistence unreachable from the contracts entry point and the dependency one-way; the domain module free of database dependencies.

### Regression

| Suite                                                      | Result                                                                                                                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full backend unit suite**                                | **868/870 to 869/870 across runs** — 0 skipped. The 1 to 2 failures are the two pre-existing spawn-timeout tests below, and which of them trips varies by host load |
| F062.1 `integration-contracts` + `integration-boundary`    | **39/39 unchanged**                                                                                                                                                 |
| F061 telemetry / tracing / tracing-boundary                | 25/25                                                                                                                                                               |
| `database-role-separation`                                 | **17/17** — canonical grant matrix unchanged                                                                                                                        |
| `runtime-reference-locks`                                  | 16/16                                                                                                                                                               |
| `tenant-domain-operator-role`                              | 28/28                                                                                                                                                               |
| `access-foundation` / `access-discovery` / `access-reader` | 31/31, 4/4, 15/15                                                                                                                                                   |
| typecheck / full lint / build / test compile               | pass                                                                                                                                                                |

**Three existing suites required an inventory update.** `database-role-separation`, `runtime-reference-locks` and `tenant-domain-operator-role` count the compiled migration files and assert the total; adding a migration legitimately changes it from 47 to 48, and the first also names the total in its title (49 → 50). Those three assertions were updated and nothing else in them was touched. The failure was a single root cause: the count assertion throws _before_ any migration is applied, so eleven downstream assertions in `database-role-separation` cascaded from it and all passed once the count was corrected. Six other suites filter to migrations earlier than `20261018000000` and are unaffected by design.

**Two unit tests fail for a pre-existing environment reason.** `development-startup`'s "configured development compiler initializes the complete Nest application" and `logging-sanitization`'s "migration, seed and API startup configuration failures never echo credentials or CA paths" both end in `spawnSync ETIMEDOUT` against fixed 60-second and 10-second budgets. **Attribution was tested, not assumed:** a worktree at `origin/main` `880cf42`, sharing the same `node_modules` on the same host, fails the same two tests across repeated runs; and the compiled `main.js` module graph is still exactly **187 modules with no F062.2B module in it**, because `database.types.js` compiles to 77 bytes with zero runtime imports — its new imports are type-only and fully erased. Nothing this slice adds is on the startup path, so it cannot affect startup timing. Which of the two trips varies between runs on both branches, and both passed earlier in the same session on a less loaded host — which is what a marginal budget looks like. **No timeout was raised and no assertion weakened.**

**Nine database suites were not executed.** `cross-tenant-isolation`, `resident-experience`, `resident-experience-admin`, `resident-experience-review`, `tenant-domain-registry`, `tenant-domain-verification`, `tenant-domain-operator-controls`, `tenant-domain-function-hardening` and `tenant-domain-operator-cli` assert a specifically provisioned test database (`/reqro_f0592_test` as `reqro_test_user`); the available `TEST_DATABASE_URL` points elsewhere, so they fail their own environment guard before running any assertion. **This is a pre-existing environment mismatch, not a regression**: none of those files is modified by this slice, and the failing comparison reads the environment rather than anything this slice adds. They are reported as **not executed**, never as passed, and no credential was invented and no database provisioned to change that.

## Remaining work

- **The grant change above** must be reviewed and applied before any runtime code reads connector metadata.
- **An administrative surface producing authoritative authorization evidence** for connector changes — who approved, under what review. This slice records _what_ changed and carries `actor` for traceability only.
- **F062.2C (outbox persistence and atomic enqueue)** is the next slice and is **not authorized by this one.** It composite-FKs `integration_connector`, which is why connector metadata came first.
- **F062.2D remains blocked on both** the worker identity and grant decision (F062.2A §19.1) and the maximum-pending-age policy.
- `accepted_schema_versions` is deliberately **not** in this slice: it is negotiation configuration with no consumer until a dispatch path exists, and adding unvalidated JSON now would contradict the validated-representation rule.
- `connector_kind`'s vocabulary will need review once a first destination is known (F062 Part 17 item 1). It must stay a capability profile, never a product name.

## Related

- [F062 — Enterprise integration reliability and eventing architecture](F062-enterprise-integration-eventing-architecture.md)
- [F062.1 — Enterprise integration contracts foundation](F062-1-integration-contracts-foundation.md) — the vocabularies these tables bind to
- [F062.2A — Transactional outbox persistence readiness](F062-2A-transactional-outbox-persistence-readiness.md) — the assessment this implements the first bounded migration of
- [ADR-001 — Organization isolation](../architecture/decisions/ADR-001-organization-isolation.md) — the composite tenant-safe reference pattern
- [ADR-024 — Transaction-time request authorization](../architecture/decisions/ADR-024-transaction-time-request-authorization.md) — the lock ordering the write path follows
- [ADR-025 — Trusted production Organization resolution](../architecture/decisions/ADR-025-trusted-production-organization-resolution.md) — the guard, audit and deferred-evidence patterns reused here
- [F060.3C-2D — Database role separation](F060-3C-2D-database-role-separation.md) — the grant matrix this slice leaves unchanged

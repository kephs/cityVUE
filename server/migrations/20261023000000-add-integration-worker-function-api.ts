import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 53. F062.2D-2B, implementing the F062.2D-1 worker identity and
 * database function security decision over the F062.2D-2A fencing schema.
 *
 * **NO WORKER RUNS. NO EXTERNAL DESTINATION IS CONTACTED. NO WORKER LOGIN OR
 * WORKER EXECUTE GRANT EXISTS. RAW CLAIM TOKENS ARE NEVER PERSISTED.** There is
 * no polling loop, no transport, no HTTP client, no connector adapter, no
 * secret resolution, no credential, no operator API and no scheduler. This
 * migration creates two PostgreSQL functions and nothing else.
 *
 * **Two functions, not three.** F062.2D-1 §6 inventoried
 * `recover_expired_integration_claim` alongside the two below, and it is
 * **deliberately not implemented**. The repository contains no lease column,
 * no approved lease duration, and no record of whether an open attempt reached
 * its destination — so every recovery rule available today would either guess a
 * timeout or treat "old" as "safe to retry". F062.2D-1A forbids the second and
 * the feature record states the first. A two-function foundation is safer than
 * an incorrect third function; the full reasoning is in
 * `docs/features/F062-2D-2B-worker-database-function-api.md`.
 *
 * **No age predicate of any kind appears below**, and no `interval` is
 * accepted, stored or compared. The `pending_age_exceeded` edge remains
 * unimplemented and `dead_lettered` remains unreachable from any function here.
 *
 * **Claim eligibility is `pending` only.** `retrying -> dispatching` and
 * `ambiguous -> dispatching` are legal edges in F062.1, but neither is
 * *claimable* yet: a retry has no approved backoff — F062.2D-1A §2 records
 * `next_attempt_at` and `attempt_count` as deferred — so claiming a `retrying`
 * row would be an unbounded hot retry loop, and an ambiguous obligation
 * requires the authorized decision F062.2D-0 routes to an operator. Both are
 * reachable only by a future reviewed slice.
 *
 * **`public.` is hardcoded, matching Migrations 48 and 49.** A `SECURITY
 * DEFINER` function must fully qualify every application object (F062.2D-1 §9)
 * and its `search_path` deliberately excludes the application schema, so the
 * literal schema name has to appear. That is why this migration, like those
 * two, is applied as text by the suites that exercise it rather than imported:
 * `test/helpers/integration-worker-functions.ts` rewrites `public.` to the
 * disposable schema, exactly as `runtime-reference-locks.ts` does for
 * Migration 49. The literal spelling is asserted separately.
 *
 * **`search_path` departs from Migration 49's pin, and the reason is
 * measured rather than preferred.** F062.2D-1 §9 specifies
 * `pg_catalog, pg_temp` with the application schema deliberately absent, and
 * that is correct for Migration 49, whose nine definer functions only `SELECT`
 * and therefore fire no trigger. **It is not usable for a definer function
 * that performs DML here.** A function's `SET` clause is in effect for
 * everything it calls, and the F062.2C and F062.2D-2A integrity guards
 * (`guard_integration_outbox`, `guard_integration_delivery_attempt`) declare
 * composite variables and read tables **unqualified**, with no `SET` clause of
 * their own — deliberately, so the schema stays portable for the
 * disposable-schema harness. Measured: with the application schema absent from
 * the path, the first claim fails with `type "integration_outbox" does not
 * exist`, raised from inside the attempt guard. **That is a production failure,
 * not a harness artifact**, because the deployment's application schema is
 * `public` and `public` is equally absent from that path.
 *
 * So the path is `pg_catalog, public, pg_temp`, and every threat F062.2D-1 §8
 * names is still closed:
 *
 * - **Caller-controlled resolution order** — the path is still pinned on the
 *   function, so the caller does not choose it.
 * - **Temp-object hijacking** — `pg_temp` is still **last**, so a planted
 *   `pg_temp.integration_outbox` never wins; the suite proves this by planting
 *   decoys for all four tables and claiming successfully anyway.
 * - **Function shadowing** — `pg_catalog` is still **first**, so no
 *   application object can shadow a built-in, and PostgreSQL never searches
 *   `pg_temp` for function names at all.
 * - **Object shadowing in the application schema** — no role in the topology
 *   holds `CREATE` on it; the bootstrap's fail-closed block refuses any that
 *   does, and now refuses it for the function owner too.
 * - **Dependence on the path for this slice's own references** — closed by
 *   qualification instead: every reference below is `public.`-qualified, and a
 *   source test asserts that by counting qualified against total occurrences,
 *   so the entry buys the nested guards their resolution and nothing else.
 *
 * The alternative was to replace both guards with `SET`-clause-bearing,
 * fully-qualified versions. That redefines another slice's accepted objects and
 * makes the schema non-portable for the harness, which is the worse trade — but
 * it is the right fix if a reviewer prefers the stricter pin, and it is
 * recorded as such in the feature document.
 *
 * **Ownership and the one membership edge.** The functions are owned by
 * `reqro_integration_function_owner`, whose privilege set is DML on four
 * integration tables and nothing else, so a flaw in a body cannot reach a
 * resident record. The migration reaches that role by `SET ROLE`, which
 * PostgreSQL authorizes against `session_user` — `reqro_migrate`, a member
 * under `INHERIT FALSE, SET TRUE, ADMIN FALSE`. Measured on PostgreSQL 17.11:
 * the assumption persists past the `DO` block that issues it, and the prior
 * role is restored explicitly rather than by `RESET ROLE`, which would drop to
 * the session login and strand the rest of the migration run.
 *
 * **The schema's lifecycle belongs to the bootstrap, not here.** `CREATE
 * SCHEMA` requires `CREATE` on the database, which the function owner must not
 * hold (F062.2D-1 §11) — measured: `create schema if not exists` is refused for
 * lack of that privilege *even when the schema already exists*. So
 * `deploy/database/bootstrap-roles.sql` creates `reqro_integration_api` with
 * `AUTHORIZATION`, and the `create schema if not exists` below is the
 * development and test path, issued before the role is assumed and a no-op
 * where provisioning already made it. `down()` drops the schema only where this
 * migration created it.
 *
 * **No grant is issued here.** Every role-specific privilege lives in
 * `deploy/database/integration-worker-role.sql`, following Migrations 48 and 49
 * and `runtime-role.sql`. `PUBLIC EXECUTE` is revoked by full signature,
 * because PostgreSQL's default grant is `PUBLIC` and omitting the revoke would
 * hand definer authority to every role in the cluster.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    -- Restored explicitly at the end: RESET ROLE would return to the session
    -- login, which holds nothing, and every later migration in the run would
    -- then fail.
    select set_config('reqro.integration_prior_role', current_user, false);

    -- Before the role is assumed, because the assumed role must not hold
    -- CREATE on the database. A no-op where the bootstrap already created it.
    create schema if not exists reqro_integration_api;

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        if not exists (select 1 from pg_catalog.pg_namespace
          where nspname = 'reqro_integration_api') then
          raise exception 'The integration function schema must be provisioned by bootstrap-roles.sql';
        end if;
        if pg_catalog.pg_get_userbyid(
            (select nspowner from pg_catalog.pg_namespace
              where nspname = 'reqro_integration_api'))
          <> 'reqro_integration_function_owner' then
          raise exception 'The integration function schema must be owned by reqro_integration_function_owner';
        end if;
        execute 'set role reqro_integration_function_owner';
      end if;
    end $$;

    -- ------------------------------------------------------------------
    -- Claim.
    --
    -- Establishes ownership of one eligible obligation. It does NOT make
    -- dispatch possible: no destination, credential or vendor operation is
    -- resolved anywhere, and F062.2D-0 12 records destination semantics as
    -- still missing from the connector snapshot.
    --
    -- Concurrency rests on two independent mechanisms, deliberately:
    --   1. FOR UPDATE SKIP LOCKED on the obligation row, so two claimers
    --      never select the same row;
    --   2. the F062.2D-2A partial unique index integration_attempt_open,
    --      which makes a second open attempt a constraint violation even if
    --      the first mechanism were removed.
    --
    -- The connector is read under FOR SHARE so its configuration cannot
    -- change between pinning the snapshot and opening the attempt, which is
    -- the read-then-pin race F062.2C identified. FOR SHARE requires UPDATE on
    -- at least one column, measured in Migration 49; the grant artifact gives
    -- the owner UPDATE (id) only, which F062.2B's identity guard makes inert.
    -- ------------------------------------------------------------------
    create function reqro_integration_api.claim_integration_intent(
      target_organization uuid,
      target_connector uuid,
      raw_claim_token text
    ) returns table (
      integration_outbox_id uuid,
      delivery_attempt_id uuid,
      attempt_number integer,
      claim_generation bigint,
      integration_connector_id uuid,
      connector_kind varchar(40),
      integration_id uuid,
      contract_kind varchar(10),
      integration_type varchar(64),
      schema_version integer,
      aggregate_type varchar(20),
      aggregate_id uuid,
      aggregate_revision integer,
      payload_mode varchar(28),
      correlation_id uuid,
      causation_id uuid,
      deployment_environment varchar(30),
      occurred_at timestamptz,
      connector_configuration_revision integer,
      capability_snapshot jsonb
    ) language plpgsql volatile security definer
      set search_path = pg_catalog, public, pg_temp as $$
    -- Column wins over variable for any bare identifier, so an output
    -- parameter sharing a column's name can never silently shadow it. Every
    -- local reference below is qualified by its record or alias regardless.
    #variable_conflict use_column
    declare
      serving_connector public.integration_connector;
      pinned_snapshot public.integration_connector_audit;
      obligation public.integration_outbox;
      opened_attempt public.integration_delivery_attempt;
    begin
      if target_organization is null or target_connector is null then
        raise exception 'An integration claim requires an Organization and a connector';
      end if;

      -- The database can bound a token's ENCODING; it cannot verify entropy.
      -- 22 characters is the shortest encoding of 128 bits (base64url), so a
      -- shorter value is refused outright, and the CSPRNG obligation remains
      -- the worker's under F062.2D-0. The raw value is never stored, never
      -- returned, never interpolated into SQL and never named in an exception.
      if raw_claim_token is null
        or pg_catalog.length(pg_catalog.btrim(raw_claim_token)) < 22
        or pg_catalog.length(raw_claim_token) > 512 then
        raise exception 'An integration claim requires a worker-generated claim token of at least 128 bits';
      end if;

      -- Organization-qualified, and locked against concurrent reconfiguration.
      select * into serving_connector from public.integration_connector c
        where c.organization_id = target_organization
          and c.id = target_connector
        for share;
      -- A connector in another Organization is indistinguishable from one that
      -- does not exist, and from one with no work: zero rows, no detail.
      if not found then return; end if;
      -- F062.1 dispatchingLifecycleStates. Mirrored rather than imported,
      -- and asserted against the contract by the parity test.
      if serving_connector.lifecycle_state not in ('active', 'degraded') then
        return;
      end if;

      -- One eligible obligation. pending only: see the header.
      select * into obligation from public.integration_outbox o
        where o.organization_id = target_organization
          and o.integration_connector_id = target_connector
          and o.state = 'pending'
          -- Never two live claims for one obligation. Redundant with the
          -- partial unique index by design, so the refusal is a clean skip
          -- rather than a constraint violation in the common case.
          and not exists (
            select 1 from public.integration_delivery_attempt a
              where a.organization_id = o.organization_id
                and a.integration_outbox_id = o.id
                and a.completed_at is null)
        order by o.created_at, o.id
        for update skip locked
        limit 1;
      if not found then return; end if;

      -- The semantics the intent pinned, never the connector's current row.
      select * into pinned_snapshot from public.integration_connector_audit a
        where a.organization_id = obligation.organization_id
          and a.integration_connector_id = obligation.integration_connector_id
          and a.configuration_revision
                = obligation.pinned_connector_configuration_revision
          and a.revision_advanced;
      if not found then
        raise exception 'The pinned integration connector semantic snapshot is missing';
      end if;

      -- attempt_number and claim_generation are omitted deliberately: the
      -- F062.2D-2A guard assigns both monotonically per obligation, and a
      -- caller-supplied ordinal would be a caller-shaped evidence trail.
      -- Omitting them also fails closed, because the NOT NULL check would
      -- refuse the row if that guard were ever removed.
      insert into public.integration_delivery_attempt (
        organization_id,
        integration_outbox_id,
        integration_connector_id,
        claim_token_digest,
        connector_configuration_revision,
        capability_snapshot
      ) values (
        obligation.organization_id,
        obligation.id,
        obligation.integration_connector_id,
        -- SHA-256 of the worker's raw token, hex. Both functions are
        -- pg_catalog built-ins from PostgreSQL 11, so no extension is
        -- required and nothing depends on a schema outside the pinned path.
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_claim_token, 'UTF8')), 'hex'),
        obligation.pinned_connector_configuration_revision,
        pg_catalog.jsonb_build_object(
          'supports_idempotency_key', pinned_snapshot.supports_idempotency_key,
          'supports_read_after_write', pinned_snapshot.supports_read_after_write,
          'side_effect_risk', pinned_snapshot.side_effect_risk)
      ) returning * into opened_attempt;

      -- The legal pending -> dispatching edge. The F062.2D-2A guard is the
      -- authority on legality; the state predicate here keeps the statement
      -- idempotent under the row lock already held.
      update public.integration_outbox o
        set state = 'dispatching'
        where o.organization_id = obligation.organization_id
          and o.id = obligation.id
          and o.state = 'pending';

      -- Bounded descriptor. No raw token, no digest, no credential locator, no
      -- business payload, no resident value, no vendor metadata. Every field
      -- is either claim identity or an F062.1 envelope field a future worker
      -- needs to form the envelope it would send.
      return query
        select o.id,
               a.id,
               a.attempt_number,
               a.claim_generation,
               o.integration_connector_id,
               c.connector_kind,
               o.integration_id,
               o.contract_kind,
               o.integration_type,
               o.schema_version,
               o.aggregate_type,
               o.aggregate_id,
               o.aggregate_revision,
               o.payload_mode,
               o.correlation_id,
               o.causation_id,
               o.deployment_environment,
               o.occurred_at,
               a.connector_configuration_revision,
               a.capability_snapshot
          from public.integration_delivery_attempt a
          join public.integration_outbox o
            on o.organization_id = a.organization_id
           and o.id = a.integration_outbox_id
          join public.integration_connector c
            on c.organization_id = a.organization_id
           and c.id = a.integration_connector_id
         where a.organization_id = opened_attempt.organization_id
           and a.id = opened_attempt.id;
    end $$;

    -- ------------------------------------------------------------------
    -- Completion.
    --
    -- One statement establishes ownership and settles, so there is no
    -- check-then-act window: identity, openness, generation and token digest
    -- are all predicates on the UPDATE. A stale claimant matches zero rows
    -- and mutates nothing.
    --
    -- The return is a bare boolean, and false is deliberately
    -- undifferentiated: a wrong token, a stale generation, an already-settled
    -- attempt and another Organization's attempt are indistinguishable to the
    -- caller.
    -- ------------------------------------------------------------------
    create function reqro_integration_api.complete_integration_attempt(
      target_organization uuid,
      target_obligation uuid,
      target_attempt uuid,
      expected_claim_generation bigint,
      raw_claim_token text,
      attempt_outcome varchar(18),
      attempt_failure_category varchar(28)
    ) returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, public, pg_temp as $$
    #variable_conflict use_column
    declare
      settled_attempt public.integration_delivery_attempt;
      resulting_state varchar(16);
    begin
      if target_organization is null or target_obligation is null
        or target_attempt is null or expected_claim_generation is null then
        raise exception 'An integration settlement requires a fully identified claim';
      end if;
      if raw_claim_token is null
        or pg_catalog.length(pg_catalog.btrim(raw_claim_token)) < 22
        or pg_catalog.length(raw_claim_token) > 512 then
        raise exception 'An integration settlement requires the claim token';
      end if;

      -- F062.1 attemptOutcomes, closed. PostgreSQL does not enforce a length
      -- modifier on a parameter, so membership is checked rather than assumed;
      -- the F062.2D-2A column CHECKs are the structural backstop.
      if attempt_outcome is null or attempt_outcome not in
        ('succeeded', 'failed_transient', 'failed_permanent', 'ambiguous') then
        raise exception 'Unsupported integration attempt outcome';
      end if;

      if attempt_outcome = 'succeeded' then
        if attempt_failure_category is not null then
          raise exception 'A successful integration attempt carries no failure category';
        end if;
      else
        -- F062.1 integrationFailureCategories, closed. A free-text category is
        -- refused structurally, here and again by the column CHECK.
        if attempt_failure_category is null or attempt_failure_category not in
          ('destination_unavailable', 'destination_timeout', 'destination_rejected',
           'rate_limited', 'authentication_failed', 'destination_unconfigured',
           'projection_failed', 'contract_unsupported', 'malformed_request',
           'internal_failure') then
          raise exception 'Unsupported integration failure category';
        end if;
        -- F062.1 transientIntegrationFailures is exactly two categories, and
        -- destination_timeout is deliberately absent from it because a timeout
        -- may already have taken effect. Both halves of that classification are
        -- enforced, so a worker cannot relabel an ambiguous timeout as a
        -- transient failure and earn itself a blind retry.
        if attempt_outcome = 'failed_transient' and attempt_failure_category
          not in ('destination_unavailable', 'rate_limited') then
          raise exception 'Only a transient integration failure category may settle an attempt as transient';
        end if;
        if attempt_failure_category = 'destination_timeout'
          and attempt_outcome <> 'ambiguous' then
          raise exception 'A destination timeout is ambiguous and may not settle an attempt as failed';
        end if;
      end if;

      -- The fencing predicate, entire: Organization, obligation, attempt,
      -- openness, generation and token digest. completed_at is assigned by the
      -- F062.2D-2A guard, which also refuses a second settlement.
      update public.integration_delivery_attempt a
        set outcome = attempt_outcome,
            failure_category = attempt_failure_category,
            completed_at = pg_catalog.clock_timestamp()
        where a.organization_id = target_organization
          and a.integration_outbox_id = target_obligation
          and a.id = target_attempt
          and a.completed_at is null
          and a.claim_generation = expected_claim_generation
          and a.claim_token_digest::text
                = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(raw_claim_token, 'UTF8')), 'hex')
        returning * into settled_attempt;
      if not found then return false; end if;

      -- The F062.1 outcome-to-state mapping, which is total over the four
      -- outcomes and reaches none of dead_lettered, acknowledged or refused.
      -- dead_lettered stays unreachable because F062.2D-1A requires durable
      -- replay authorization evidence that does not exist; acknowledged is a
      -- destination-reported terminal state, not an attempt outcome.
      resulting_state := case attempt_outcome
        when 'succeeded' then 'accepted'
        when 'failed_transient' then 'retrying'
        when 'failed_permanent' then 'failed_permanent'
        when 'ambiguous' then 'ambiguous'
      end;

      update public.integration_outbox o
        set state = resulting_state
        where o.organization_id = target_organization
          and o.id = target_obligation
          and o.state = 'dispatching';
      if not found then
        -- Nothing is left settled: the raise rolls back this statement and the
        -- attempt update above together, because both are in the caller's
        -- transaction.
        raise exception 'The integration obligation is not dispatching';
      end if;

      return true;
    end $$;

    -- Fail closed and role agnostic, following Migrations 48 and 49: PUBLIC is
    -- PostgreSQL's default grantee for EXECUTE, so this is not hygiene. No
    -- EXECUTE is granted to any role here, and no worker principal exists yet.
    revoke execute on function reqro_integration_api.claim_integration_intent(
      uuid, uuid, text) from public;
    revoke execute on function reqro_integration_api.complete_integration_attempt(
      uuid, uuid, uuid, bigint, text, varchar, varchar) from public;

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        execute format('set role %I',
          current_setting('reqro.integration_prior_role'));
      end if;
    end $$;
  `.execute(db);
}

/** Removes only the two functions, and the schema only where this migration
 * created it.
 *
 * **Refuses while an unsettled claim exists.** An open attempt is an obligation
 * a worker has taken ownership of; removing the settlement path would leave it
 * permanently unsettleable, and no operator surface exists to resolve it. That
 * is an operational invariant rather than a data-retention one, so the refusal
 * is on openness alone — settled evidence does not block rollback, and nothing
 * here deletes an outbox row, an attempt, connector history or audit evidence.
 *
 * **The schema's lifecycle.** Where `reqro_integration_function_owner` exists
 * the schema was provisioned by `bootstrap-roles.sql`, which owns its
 * lifecycle, so it is left in place — the same rule that keeps a migration from
 * dropping a bootstrap-created role. Where the role is absent this migration
 * created the schema, so it drops it, with `restrict` so an unexpected object
 * refuses rather than cascading.
 *
 * **Grants are not revoked here**, because they are not granted here. The
 * function-owner privileges in `deploy/database/integration-worker-role.sql`
 * are a separate reviewed lifecycle, exactly as Migration 49's header records
 * for the runtime grants: a rolled-back deployment must revoke them in the same
 * operation. */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    select set_config('reqro.integration_prior_role', current_user, false);

    set local lock_timeout = '5s';
    lock table integration_delivery_attempt in access exclusive mode;
    do $$ begin
      if exists (select 1 from integration_delivery_attempt
        where completed_at is null) then
        raise exception 'An unsettled integration delivery claim prevents rollback of its settlement path';
      end if;
    end $$;

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        execute 'set role reqro_integration_function_owner';
      end if;
    end $$;

    drop function reqro_integration_api.complete_integration_attempt(
      uuid, uuid, uuid, bigint, text, varchar, varchar);
    drop function reqro_integration_api.claim_integration_intent(uuid, uuid, text);

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        execute format('set role %I',
          current_setting('reqro.integration_prior_role'));
      else
        -- Created by up() rather than by provisioning, so it is removed here.
        -- restrict, never cascade: an unexpected object must refuse.
        execute 'drop schema reqro_integration_api restrict';
      end if;
    end $$;
  `.execute(db);
}

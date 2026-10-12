import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/**
 * F062.2D-2C-3A — strict FIFO, due-retry eligibility and the dispatch boundary.
 *
 * > **NO LEASE IS AUTHORED. NO RETRY IS SCHEDULED. NO RECOVERY FUNCTION
 * > EXISTS. NO WORKER HAS EXECUTE. NO WORKER RUNTIME EXISTS. NO EXTERNAL
 * > NETWORK I/O EXISTS.**
 *
 * Implements the policy-free half of F062.2D-2C-3-0, as amended by
 * F062.2D-2C-3-0A. Two functions are touched and two are not:
 * `claim_integration_intent` is **replaced**, `mark_integration_dispatch_started`
 * is **created**, `complete_integration_attempt` is **byte-unchanged**, and
 * `recover_expired_integration_claim` is **not created**. F062.2D-3 remains
 * blocked.
 *
 * ## Why the claim function is dropped and recreated
 *
 * The descriptor gains one column, `claim_expires_at`, and **PostgreSQL cannot
 * widen a `RETURNS TABLE` with `CREATE OR REPLACE`** — it refuses with
 * *"cannot change return type of existing function"*. So the exact signature is
 * dropped and recreated, **without `CASCADE`**, after a fail-closed dependency
 * inspection. Because `DROP` discards the function's ACL and a freshly created
 * function carries PostgreSQL's default `PUBLIC EXECUTE`, the revoke below is
 * **not hygiene** — it is the control that keeps the surface closed.
 *
 * Doing this now is deliberate: a `DROP` also drops every grant, so performing
 * it after F062.2D-3 would silently revoke the worker's access. No grant exists
 * yet.
 *
 * ## `claim_expires_at` is NULL in this slice
 *
 * Nothing authors a lease. The column is returned so the contract is stable for
 * 3C, and a transitional NULL is safe precisely because no identity holds
 * `EXECUTE`. **A NULL lease must never be read as "expired"** — the same
 * discipline F061.3C requires of a future producer.
 *
 * ## Strict FIFO is a predicate, not an index
 *
 * Migration 55's `integration_outbox_ordered_stream_in_flight` is untouched and
 * still provides **mutual exclusion only**, over the narrower
 * `dispatching`/`ambiguous` set. The predecessor gate here is a separate
 * control with a wider blocker set, and it is written as a correlated
 * `NOT EXISTS` — taking no row locks — specifically so that
 * `FOR UPDATE SKIP LOCKED` on the candidate cannot cause a **locked**
 * predecessor to be skipped and let a newer obligation overtake it.
 *
 * ## What is deliberately absent
 *
 * No lease duration, interval or default; no retry delay, backoff, jitter or
 * randomness; no retry ceiling or horizon; no recovery function, scan or
 * counter; no `attempt_count`/`retry_count`/`recovery_count`; no role,
 * membership or grant; no network, vendor, credential or secret reference. The
 * only new time comparison is due-retry eligibility against the database clock.
 */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    -- ------------------------------------------------------------------
    -- Assume the function owner, exactly as Migration 53 does. SET ROLE is
    -- authorized against session_user, which is why the
    -- reqro_migrate -> function owner edge suffices during a migration that
    -- has already assumed reqro_owner.
    -- ------------------------------------------------------------------
    select set_config('reqro.integration_prior_role', current_user, false);

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
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
    -- Fail closed before dropping: nothing may depend on the claim function.
    -- A view, a default expression or another function referencing it would
    -- be silently broken by a DROP, and CASCADE is deliberately not used.
    -- ------------------------------------------------------------------
    do $$
    declare dependents bigint;
    begin
      select count(*) into dependents
        from pg_catalog.pg_depend d
       where d.refclassid = 'pg_catalog.pg_proc'::regclass
         and d.refobjid = 'reqro_integration_api.claim_integration_intent(uuid, uuid, text)'::regprocedure;
      if dependents > 0 then
        raise exception
          'Unexpected dependencies on claim_integration_intent prevent its replacement: %',
          dependents;
      end if;
    end $$;

    drop function reqro_integration_api.claim_integration_intent(uuid, uuid, text);

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
      capability_snapshot jsonb,
      -- F062.2D-2C-3A. Appended as the 21st column so the existing twenty
      -- keep their identity, meaning and order. It is NULL in this slice: no
      -- lease policy exists, and 3C authors it after 3B persists policy.
      claim_expires_at timestamptz
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

      -- One eligible obligation.
      select * into obligation from public.integration_outbox o
        where o.organization_id = target_organization
          and o.integration_connector_id = target_connector
          -- F062.2D-2C-3A retry eligibility. pending as before, plus a
          -- retrying obligation whose schedule is non-null and due. A NULL
          -- schedule means nothing scheduled it, so it is NOT eligible: the
          -- fail-closed reading. The comparison is against the DATABASE
          -- clock, never a caller's.
          and (o.state = 'pending'
               or (o.state = 'retrying'
                   and o.next_attempt_at is not null
                   and o.next_attempt_at <= pg_catalog.clock_timestamp()))
          -- Never two live claims for one obligation. Redundant with the
          -- partial unique index by design, so the refusal is a clean skip
          -- rather than a constraint violation in the common case.
          and not exists (
            select 1 from public.integration_delivery_attempt a
              where a.organization_id = o.organization_id
                and a.integration_outbox_id = o.id
                and a.completed_at is null)
          -- ----------------------------------------------------------
          -- F062.2D-2C-3A strict FIFO (F062.2D-2C-3-0 section 4, as amended
          -- by F062.2D-2C-3-0A).
          --
          -- The gate applies ONLY to an ordered candidate, and a predecessor
          -- participates REGARDLESS of its own requires_ordered_delivery: an
          -- obligation pinned under a historical unordered connector revision
          -- does not become ordered, but an ordered candidate may not be
          -- delivered past it while it is unresolved. Waiting is reversible;
          -- external reordering is not.
          --
          -- This is a SEPARATE control from Migration 55's partial unique
          -- index, which provides mutual exclusion only over a narrower
          -- blocker set. Both must hold.
          --
          -- It is deliberately a correlated NOT EXISTS rather than an
          -- ordering plus LIMIT: the subquery takes no row locks, so
          -- FOR UPDATE SKIP LOCKED below cannot cause a locked predecessor
          -- to be skipped and let a newer obligation overtake it. The
          -- subquery observes committed state through the snapshot whether or
          -- not another transaction currently holds that row's lock.
          -- ----------------------------------------------------------
          and (not o.requires_ordered_delivery
               or not exists (
                 select 1 from public.integration_outbox p
                   where p.organization_id = o.organization_id
                     and p.integration_connector_id = o.integration_connector_id
                     and p.aggregate_type = o.aggregate_type
                     and p.aggregate_id = o.aggregate_id
                     and p.id <> o.id
                     -- The frozen blocker set. accepted, acknowledged,
                     -- failed_permanent and refused are non-blocking;
                     -- dead_lettered BLOCKS, because dead-lettering abandons
                     -- an obligation rather than resolving it for its stream.
                     and p.state in ('pending', 'retrying', 'dispatching',
                                     'ambiguous', 'dead_lettered')
                     -- "Earlier" under aggregate_revision ASC NULLS FIRST,
                     -- created_at ASC, id ASC. Written out rather than as a
                     -- row comparison because a row comparison cannot express
                     -- NULLS FIRST: PostgreSQL's ASC default is NULLS LAST,
                     -- which would sort an unknown causal position LAST and
                     -- permit exactly the overtake this gate prevents.
                     and (
                       -- A NULL revision is an UNKNOWN causal position, not a
                       -- late one, so it precedes every numbered revision --
                       -- even when its created_at is later.
                       (p.aggregate_revision is null
                        and o.aggregate_revision is not null)
                       -- Both unknown: created_at and id break the tie only
                       -- after revision position is established, so the
                       -- NULL cohort is still totally ordered.
                       or (p.aggregate_revision is null
                           and o.aggregate_revision is null
                           and (p.created_at, p.id) < (o.created_at, o.id))
                       -- Both known: the full sequence key.
                       or (p.aggregate_revision is not null
                           and o.aggregate_revision is not null
                           and (p.aggregate_revision, p.created_at, p.id)
                             < (o.aggregate_revision, o.created_at, o.id))
                     )))
        -- Unchanged global ordering. No new fairness policy is introduced,
        -- and unrelated obligations are deliberately NOT sorted by
        -- aggregate_revision, which is meaningful only inside its own stream.
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

      -- The legal pending -> dispatching and retrying -> dispatching edges.
      -- The F062.2D-2A guard is the authority on legality; the state
      -- predicate here keeps the statement idempotent under the row lock
      -- already held.
      --
      -- F062.2D-2C-3A: the retry schedule is cleared in the SAME authoritative
      -- transition. Migration 55 forbids next_attempt_at outside retrying, so
      -- a schedule must not survive into dispatching -- and because the
      -- outbox guard refuses an update that changes nothing, the transition is
      -- the only moment at which it can be cleared.
      update public.integration_outbox o
        set state = 'dispatching',
            next_attempt_at = null
        where o.organization_id = obligation.organization_id
          and o.id = obligation.id
          and o.state in ('pending', 'retrying');

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
               a.capability_snapshot,
               -- NULL in this slice; nothing authors a lease yet.
               a.claim_expires_at
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
    -- The dispatch boundary.
    --
    -- The caller signals only "I am about to cross the external side-effect
    -- boundary". There is no timestamp, obligation-state, destination or
    -- credential parameter: the database authors the marker through the
    -- F062.2D-2A/F062.2D-2C-1 guard, which discards any value a caller
    -- supplies and enforces write-once.
    --
    -- Idempotent FOR THE RIGHTFUL OWNER and fenced for everyone else. The
    -- fenced row is taken FOR UPDATE first, so reading dispatch_started_at
    -- under that lock is not a check-then-act: a blind
    -- "UPDATE ... WHERE fence AND dispatch_started_at IS NULL" would return
    -- zero rows for both "already marked" and "fence failed", which the
    -- contract requires be distinguishable internally.
    --
    -- Why idempotency matters: if the first marker call commits but its
    -- response is lost, a worker must be able to retry and learn that the
    -- boundary is committed, rather than be unable to tell that from
    -- "someone else owns this" and be pushed toward transmitting without a
    -- committed marker.
    -- ------------------------------------------------------------------
    create function reqro_integration_api.mark_integration_dispatch_started(
      target_organization uuid,
      target_attempt uuid,
      expected_claim_generation bigint,
      raw_claim_token text
    ) returns boolean language plpgsql volatile security definer
      set search_path = pg_catalog, public, pg_temp as $$
    #variable_conflict use_column
    declare
      owned public.integration_delivery_attempt;
    begin
      if target_organization is null or target_attempt is null
        or expected_claim_generation is null then
        raise exception 'An integration dispatch boundary requires an Organization, an attempt and a claim generation';
      end if;
      -- The same bound the claim applies. The raw value is never stored,
      -- never returned, never interpolated into SQL and never named in an
      -- exception.
      if raw_claim_token is null
        or pg_catalog.length(pg_catalog.btrim(raw_claim_token)) < 22
        or pg_catalog.length(raw_claim_token) > 512 then
        raise exception 'An integration dispatch boundary requires the worker claim token';
      end if;

      -- The fence, entire: Organization, attempt, openness, generation and
      -- token digest. A caller failing any of them selects zero rows and
      -- cannot tell which, exactly as completion behaves.
      select * into owned from public.integration_delivery_attempt a
        where a.organization_id = target_organization
          and a.id = target_attempt
          and a.completed_at is null
          and a.claim_generation = expected_claim_generation
          and a.claim_token_digest::text
                = pg_catalog.encode(pg_catalog.sha256(
                    pg_catalog.convert_to(raw_claim_token, 'UTF8')), 'hex')
        for update;
      if not found then return false; end if;

      -- The attempt/obligation relationship and the obligation's state. The
      -- relationship is structural: the obligation is located through the
      -- attempt's own tenant-safe reference rather than a caller-supplied id.
      if not exists (
        select 1 from public.integration_outbox o
          where o.organization_id = owned.organization_id
            and o.id = owned.integration_outbox_id
            and o.state = 'dispatching') then
        return false;
      end if;

      -- Owner-idempotent: the boundary is already committed for THIS claim,
      -- so the postcondition the caller needs already holds. The timestamp is
      -- never re-stamped.
      if owned.dispatch_started_at is not null then
        return true;
      end if;

      -- Database-authored. The guard overwrites whatever is supplied here
      -- with its own clock_timestamp(), so no caller value can become durable
      -- evidence; passing clock_timestamp() keeps the intent explicit.
      update public.integration_delivery_attempt a
        set dispatch_started_at = pg_catalog.clock_timestamp()
        where a.organization_id = owned.organization_id
          and a.id = owned.id;
      return true;
    end $$;

    -- Fail closed and role agnostic, following Migrations 48, 49 and 53.
    -- PUBLIC is PostgreSQL's default grantee for EXECUTE, and the recreated
    -- claim function carries that default afresh, so both revokes are
    -- load-bearing. No EXECUTE is granted to any role, and no worker
    -- principal exists.
    revoke execute on function reqro_integration_api.claim_integration_intent(
      uuid, uuid, text) from public;
    revoke execute on function reqro_integration_api.mark_integration_dispatch_started(
      uuid, uuid, bigint, text) from public;

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        execute format('set role %I',
          current_setting('reqro.integration_prior_role'));
      end if;
    end $$;
  `.execute(db);
}

/**
 * Restores the exact pre-3A function surface.
 *
 * The Migration 53 claim function is recreated **verbatim**, with its owner,
 * `SECURITY DEFINER`, volatility, `search_path` and closed ACL restored, and
 * the dispatch-marker function is removed.
 *
 * **No business evidence is touched.** A `dispatch_started_at` written while
 * Migration 56 was active is valid Migration 54 evidence and survives rollback
 * untouched, as does every obligation, attempt, schedule and connector row.
 * Rolling a function definition back is not a reason to erase what the
 * function recorded.
 */
export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    select set_config('reqro.integration_prior_role', current_user, false);

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        execute 'set role reqro_integration_function_owner';
      end if;
    end $$;

    drop function reqro_integration_api.mark_integration_dispatch_started(
      uuid, uuid, bigint, text);
    drop function reqro_integration_api.claim_integration_intent(uuid, uuid, text);

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

    revoke execute on function reqro_integration_api.claim_integration_intent(
      uuid, uuid, text) from public;

    do $$ begin
      if exists (select 1 from pg_catalog.pg_roles
        where rolname = 'reqro_integration_function_owner') then
        execute format('set role %I',
          current_setting('reqro.integration_prior_role'));
      end if;
    end $$;
  `.execute(db);
}

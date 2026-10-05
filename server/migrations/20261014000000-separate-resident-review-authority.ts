import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

// Policy 2 separates review from publication. Historical evidence is never rewritten.
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization, organization_access_state, organization_resident_experience,
      resident_experience_review_request, resident_experience_review_decision, resident_experience_event,
      permission, role_permission, access_permission_delta in access exclusive mode;
    insert into permission(permission_key) values ('resident_experience.review');
    alter table resident_experience_review_request drop constraint resident_experience_review_request_policy_version_check;
    alter table resident_experience_review_request add constraint resident_experience_review_request_policy_version_check check(policy_version in (1,2));
    create function resident_review_authorized(org uuid,actor uuid,high_impact boolean) returns boolean language sql stable as $$
      select exists(select 1 from staff_identity s join organization o on o.id=s.organization_id
        where s.organization_id=org and s.id=actor and s.active and o.status='active' and s.entra_tenant_id is not null and s.entra_object_id is not null)
        and not exists(select 1 from unnest(case when high_impact then array['admin.configuration.read','resident_experience.review','resident_experience.contact.manage'] else array['admin.configuration.read','resident_experience.review'] end) required(key)
          where not exists(select 1 from staff_role_assignment a join role r on r.organization_id=a.organization_id and r.id=a.role_id
            join role_permission p on p.organization_id=r.organization_id and p.role_id=r.id
            where a.organization_id=org and a.staff_identity_id=actor and a.active and r.active and p.permission_key=required.key))
    $$;
    create or replace function resident_review_context_valid(request resident_experience_review_request) returns boolean language sql stable as $$
      select exists(select 1 from organization_resident_experience r join organization_access_state a using(organization_id)
        where r.organization_id=request.organization_id and r.revision=request.resource_revision
        and r.published_revision_id is not distinct from request.baseline_revision_id
        and r.draft_revision_id is not distinct from request.draft_revision_id
        and a.authorization_revision=request.authorization_revision)
        and request.policy_version=2 and request.classifier_version=1
        and not exists(select 1 from resident_experience_review_request newer where newer.organization_id=request.organization_id and newer.review_sequence>request.review_sequence)
    $$;
    create or replace function guard_resident_review_request() returns trigger language plpgsql as $$
    declare resource organization_resident_experience; authority bigint; latest uuid; changes jsonb;
    begin
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      if not found then raise exception 'Resident review unavailable'; end if;
      select authorization_revision into authority from organization_access_state where organization_id=NEW.organization_id for share;
      select * into resource from organization_resident_experience where organization_id=NEW.organization_id for update;
      if NEW.policy_version<>2 then raise exception 'Current resident review policy required'; end if;
      if resource.revision is distinct from NEW.resource_revision or authority is distinct from NEW.authorization_revision
        or resource.published_revision_id is distinct from NEW.baseline_revision_id or resource.draft_revision_id is distinct from NEW.draft_revision_id then raise exception 'Stale resident review'; end if;
      if not exists(select 1 from staff_identity s where s.organization_id=NEW.organization_id and s.id=NEW.requested_by and s.active and s.entra_tenant_id is not null and s.entra_object_id is not null)
        or not exists(select 1 from staff_role_assignment a join role r on r.id=a.role_id and r.organization_id=a.organization_id join role_permission p on p.role_id=r.id and p.organization_id=r.organization_id
          where a.organization_id=NEW.organization_id and a.staff_identity_id=NEW.requested_by and a.active and r.active and p.permission_key='admin.configuration.read')
        or not exists(select 1 from staff_role_assignment a join role r on r.id=a.role_id and r.organization_id=a.organization_id join role_permission p on p.role_id=r.id and p.organization_id=r.organization_id
          where a.organization_id=NEW.organization_id and a.staff_identity_id=NEW.requested_by and a.active and r.active and p.permission_key in ('resident_experience.write','resident_experience.publish')) then raise exception 'Resident review authority required'; end if;
      if NEW.target_revision_id is not distinct from NEW.baseline_revision_id
        or not exists(select 1 from resident_experience_revision where organization_id=NEW.organization_id and id=NEW.target_revision_id and creation_txid<>txid_current()) then raise exception 'Committed resident target required'; end if;
      if (NEW.purpose='draft' and NEW.target_revision_id is distinct from resource.draft_revision_id)
        or (NEW.purpose='historical' and not exists(select 1 from resident_experience_event where organization_id=NEW.organization_id and new_revision_id=NEW.target_revision_id and operation='published')) then raise exception 'Invalid resident review purpose'; end if;
      select id into latest from resident_experience_review_request where organization_id=NEW.organization_id order by review_sequence desc limit 1;
      if NEW.supersedes_request_id is distinct from latest then raise exception 'Stale resident review selection'; end if;
      select coalesce(max(review_sequence),0)+1 into NEW.review_sequence from resident_experience_review_request where organization_id=NEW.organization_id;
      changes=resident_publication_changes(NEW.organization_id,NEW.target_revision_id,NEW.baseline_revision_id);
      if NEW.consequential is distinct from (changes->>'consequential')::boolean or to_jsonb(NEW.changed_fields)<>changes->'changedFields' or to_jsonb(NEW.reasons)<>changes->'reasons' then raise exception 'Resident classification mismatch'; end if;
      NEW.created_at=clock_timestamp(); NEW.creation_txid=txid_current(); return NEW;
    end $$;
    create or replace function guard_resident_review_decision() returns trigger language plpgsql as $$
    declare request resident_experience_review_request;
    begin
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      perform 1 from organization_access_state where organization_id=NEW.organization_id for share;
      perform 1 from organization_resident_experience where organization_id=NEW.organization_id for update;
      select * into request from resident_experience_review_request where organization_id=NEW.organization_id and id=NEW.request_id;
      if not found or not resident_review_context_valid(request) or request.creation_txid=txid_current() then raise exception 'Resident review unavailable'; end if;
      if not resident_review_authorized(NEW.organization_id,NEW.reviewer_id,request.consequential)
        or NEW.reviewer_id in (select resident_review_contributors(NEW.organization_id,request.target_revision_id,request.baseline_revision_id)) then raise exception 'Independent resident reviewer required'; end if;
      NEW.decided_at=clock_timestamp(); NEW.expires_at=NEW.decided_at+interval '24 hours'; NEW.creation_txid=txid_current(); return NEW;
    end $$;
    create or replace function guard_resident_publication_event() returns trigger language plpgsql as $$
    declare request resident_experience_review_request; decision resident_experience_review_decision;
    begin
      if NEW.operation<>'published' then return NEW; end if;
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      perform 1 from organization_access_state where organization_id=NEW.organization_id for share;
      perform 1 from organization_resident_experience where organization_id=NEW.organization_id for update;
      select * into request from resident_experience_review_request where organization_id=NEW.organization_id and id=NEW.review_request_id;
      if not found or not resident_review_context_valid(request) then raise exception 'Resident publication review unavailable'; end if;
      select * into decision from resident_experience_review_decision where organization_id=NEW.organization_id and id=NEW.review_decision_id and request_id=request.id;
      if not found or decision.outcome<>'approved' or decision.creation_txid=txid_current()
        or not resident_review_unexpired(decision.decided_at,clock_timestamp()) then raise exception 'Resident approval unusable'; end if;
      if NEW.actor_id=decision.reviewer_id
        or decision.reviewer_id in (select resident_review_contributors(NEW.organization_id,request.target_revision_id,request.baseline_revision_id))
        or not resident_publication_authorized(NEW.organization_id,NEW.actor_id,request.consequential)
        or not resident_review_authorized(NEW.organization_id,decision.reviewer_id,request.consequential) then raise exception 'Independent resident publication authority required'; end if;
      if NEW.new_revision_id<>request.target_revision_id or NEW.prior_revision_id is distinct from request.baseline_revision_id
        or NEW.prior_resource_revision<>request.resource_revision or NEW.resource_revision<>request.resource_revision+1
        or NEW.consequential<>request.consequential or NEW.changed_fields<>request.changed_fields or NEW.reasons<>request.reasons then raise exception 'Resident publication evidence mismatch'; end if;
      NEW.publication_txid=txid_current(); NEW.occurred_at=clock_timestamp(); return NEW;
    end $$;
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization, organization_access_state, organization_resident_experience,
      resident_experience_review_request, resident_experience_review_decision, resident_experience_event,
      permission, role_permission, access_permission_delta in access exclusive mode;
    do $$ begin
      if exists(select 1 from resident_experience_review_request where policy_version=2)
        or exists(select 1 from role_permission where permission_key='resident_experience.review')
        or exists(select 1 from access_permission_delta where permission_key='resident_experience.review')
      then raise exception 'Retained resident review policy 2 evidence or grants prevent rollback'; end if;
    end $$;
    create or replace function resident_review_context_valid(request resident_experience_review_request) returns boolean language sql stable as $$
      select exists(select 1 from organization_resident_experience r join organization_access_state a using(organization_id)
        where r.organization_id=request.organization_id and r.revision=request.resource_revision
        and r.published_revision_id is not distinct from request.baseline_revision_id
        and r.draft_revision_id is not distinct from request.draft_revision_id
        and a.authorization_revision=request.authorization_revision)
        and request.policy_version=1 and request.classifier_version=1
        and not exists(select 1 from resident_experience_review_request newer where newer.organization_id=request.organization_id and newer.review_sequence>request.review_sequence)
    $$;
    create or replace function guard_resident_review_request() returns trigger language plpgsql as $$
    declare resource organization_resident_experience; authority bigint; latest uuid; changes jsonb;
    begin
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      if not found then raise exception 'Resident review unavailable'; end if;
      select authorization_revision into authority from organization_access_state where organization_id=NEW.organization_id for share;
      select * into resource from organization_resident_experience where organization_id=NEW.organization_id for update;
      if resource.revision is distinct from NEW.resource_revision or authority is distinct from NEW.authorization_revision
        or resource.published_revision_id is distinct from NEW.baseline_revision_id or resource.draft_revision_id is distinct from NEW.draft_revision_id then raise exception 'Stale resident review'; end if;
      if not exists(select 1 from staff_identity s where s.organization_id=NEW.organization_id and s.id=NEW.requested_by and s.active and s.entra_tenant_id is not null and s.entra_object_id is not null)
        or not exists(select 1 from staff_role_assignment a join role r on r.id=a.role_id and r.organization_id=a.organization_id join role_permission p on p.role_id=r.id and p.organization_id=r.organization_id
          where a.organization_id=NEW.organization_id and a.staff_identity_id=NEW.requested_by and a.active and r.active and p.permission_key='admin.configuration.read')
        or not exists(select 1 from staff_role_assignment a join role r on r.id=a.role_id and r.organization_id=a.organization_id join role_permission p on p.role_id=r.id and p.organization_id=r.organization_id
          where a.organization_id=NEW.organization_id and a.staff_identity_id=NEW.requested_by and a.active and r.active and p.permission_key in ('resident_experience.write','resident_experience.publish')) then raise exception 'Resident review authority required'; end if;
      if NEW.target_revision_id is not distinct from NEW.baseline_revision_id
        or not exists(select 1 from resident_experience_revision where organization_id=NEW.organization_id and id=NEW.target_revision_id and creation_txid<>txid_current()) then raise exception 'Committed resident target required'; end if;
      if (NEW.purpose='draft' and NEW.target_revision_id is distinct from resource.draft_revision_id)
        or (NEW.purpose='historical' and not exists(select 1 from resident_experience_event where organization_id=NEW.organization_id and new_revision_id=NEW.target_revision_id and operation='published')) then raise exception 'Invalid resident review purpose'; end if;
      select id into latest from resident_experience_review_request where organization_id=NEW.organization_id order by review_sequence desc limit 1;
      if NEW.supersedes_request_id is distinct from latest then raise exception 'Stale resident review selection'; end if;
      select coalesce(max(review_sequence),0)+1 into NEW.review_sequence from resident_experience_review_request where organization_id=NEW.organization_id;
      changes=resident_publication_changes(NEW.organization_id,NEW.target_revision_id,NEW.baseline_revision_id);
      if NEW.consequential is distinct from (changes->>'consequential')::boolean or to_jsonb(NEW.changed_fields)<>changes->'changedFields' or to_jsonb(NEW.reasons)<>changes->'reasons' then raise exception 'Resident classification mismatch'; end if;
      NEW.created_at=clock_timestamp(); NEW.creation_txid=txid_current(); return NEW;
    end $$;
    create or replace function guard_resident_review_decision() returns trigger language plpgsql as $$
    declare request resident_experience_review_request;
    begin
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      perform 1 from organization_access_state where organization_id=NEW.organization_id for share;
      perform 1 from organization_resident_experience where organization_id=NEW.organization_id for update;
      select * into request from resident_experience_review_request where organization_id=NEW.organization_id and id=NEW.request_id;
      if not found or not resident_review_context_valid(request) or request.creation_txid=txid_current() then raise exception 'Resident review unavailable'; end if;
      if not resident_publication_authorized(NEW.organization_id,NEW.reviewer_id,request.consequential)
        or NEW.reviewer_id in (select resident_review_contributors(NEW.organization_id,request.target_revision_id,request.baseline_revision_id)) then raise exception 'Independent resident reviewer required'; end if;
      NEW.decided_at=clock_timestamp(); NEW.expires_at=NEW.decided_at+interval '24 hours'; NEW.creation_txid=txid_current(); return NEW;
    end $$;
    create or replace function guard_resident_publication_event() returns trigger language plpgsql as $$
    declare request resident_experience_review_request; decision resident_experience_review_decision;
    begin
      if NEW.operation<>'published' then return NEW; end if;
      perform 1 from organization where id=NEW.organization_id and status='active' for share;
      perform 1 from organization_access_state where organization_id=NEW.organization_id for share;
      perform 1 from organization_resident_experience where organization_id=NEW.organization_id for update;
      select * into request from resident_experience_review_request where organization_id=NEW.organization_id and id=NEW.review_request_id;
      if not found or not resident_review_context_valid(request) then raise exception 'Resident publication review unavailable'; end if;
      select * into decision from resident_experience_review_decision where organization_id=NEW.organization_id and id=NEW.review_decision_id and request_id=request.id;
      if not found or decision.outcome<>'approved' or decision.creation_txid=txid_current()
        or not resident_review_unexpired(decision.decided_at,clock_timestamp()) then raise exception 'Resident approval unusable'; end if;
      if NEW.actor_id=decision.reviewer_id
        or decision.reviewer_id in (select resident_review_contributors(NEW.organization_id,request.target_revision_id,request.baseline_revision_id))
        or not resident_publication_authorized(NEW.organization_id,NEW.actor_id,request.consequential)
        or not resident_publication_authorized(NEW.organization_id,decision.reviewer_id,request.consequential) then raise exception 'Independent resident publication authority required'; end if;
      if NEW.new_revision_id<>request.target_revision_id or NEW.prior_revision_id is distinct from request.baseline_revision_id
        or NEW.prior_resource_revision<>request.resource_revision or NEW.resource_revision<>request.resource_revision+1
        or NEW.consequential<>request.consequential or NEW.changed_fields<>request.changed_fields or NEW.reasons<>request.reasons then raise exception 'Resident publication evidence mismatch'; end if;
      NEW.publication_txid=txid_current(); NEW.occurred_at=clock_timestamp(); return NEW;
    end $$;
    drop function resident_review_authorized(uuid,uuid,boolean);
    alter table resident_experience_review_request drop constraint resident_experience_review_request_policy_version_check;
    alter table resident_experience_review_request add constraint resident_experience_review_request_policy_version_check check(policy_version=1);
    delete from permission where permission_key='resident_experience.review';
  `.execute(db);
}

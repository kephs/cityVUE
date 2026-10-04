import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

/** Ordinal 43. No routes, grants, content defaults or development application. */
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization, organization_access_state, organization_resident_experience,
      resident_experience_revision, resident_experience_event in share row exclusive mode;
    do $$ begin
      if exists(select 1 from resident_experience_event where operation <> 'draft_saved')
        or exists(select 1 from organization_resident_experience where published_revision_id is not null) then
        raise exception 'Unsupported pre-foundation publication evidence';
      end if;
    end $$;

    create table resident_experience_review_request (
      id uuid primary key, organization_id uuid not null references organization_resident_experience(organization_id),
      target_revision_id uuid not null, baseline_revision_id uuid, draft_revision_id uuid,
      resource_revision integer not null check(resource_revision > 0),
      authorization_revision bigint not null check(authorization_revision >= 0),
      purpose varchar(16) not null check(purpose in ('draft','historical')),
      policy_version integer not null check(policy_version=1), classifier_version integer not null check(classifier_version=1),
      consequential boolean not null, changed_fields text[] not null, reasons text[] not null,
      requested_by uuid not null, supersedes_request_id uuid,
      review_sequence bigint not null, created_at timestamptz not null default clock_timestamp(),
      creation_txid bigint not null default txid_current(),
      unique(organization_id,id), unique(organization_id,review_sequence),
      foreign key(organization_id,target_revision_id) references resident_experience_revision(organization_id,id),
      foreign key(organization_id,baseline_revision_id) references resident_experience_revision(organization_id,id),
      foreign key(organization_id,draft_revision_id) references resident_experience_revision(organization_id,id),
      foreign key(organization_id,requested_by) references staff_identity(organization_id,id),
      foreign key(organization_id,supersedes_request_id) references resident_experience_review_request(organization_id,id),
      check(cardinality(changed_fields) between 0 and 10 and changed_fields <@ array['presentation.branding','presentation.metadata','presentation.navigation','presentation.hero','presentation.actionsTitle','presentation.benefitsLabel','presentation.footer','actions','benefits','contacts']::text[]),
      check(cardinality(reasons) between 0 and 5 and reasons <@ array['first_publication','actions_changed','contacts_changed','navigation_links_changed','footer_links_changed']::text[]),
      check(consequential=(cardinality(reasons)>0))
    );
    create table resident_experience_review_decision (
      id uuid primary key, organization_id uuid not null, request_id uuid not null,
      reviewer_id uuid not null, outcome varchar(16) not null check(outcome in ('approved','rejected')),
      decided_at timestamptz not null default clock_timestamp(),
      expires_at timestamptz not null, creation_txid bigint not null default txid_current(),
      unique(organization_id,id,request_id), unique(organization_id,request_id),
      foreign key(organization_id,request_id) references resident_experience_review_request(organization_id,id),
      foreign key(organization_id,reviewer_id) references staff_identity(organization_id,id),
      check(expires_at=decided_at+interval '24 hours')
    );
    create index resident_review_target on resident_experience_review_request(organization_id,target_revision_id,review_sequence desc);
    create index resident_review_history on resident_experience_review_request(organization_id,created_at,id);
    alter table resident_experience_event
      add column review_request_id uuid,
      add column review_decision_id uuid,
      add column publication_txid bigint,
      add constraint resident_publication_decision foreign key(organization_id,review_decision_id,review_request_id)
        references resident_experience_review_decision(organization_id,id,request_id),
      add constraint resident_publication_references check(
        (operation='published' and review_request_id is not null and review_decision_id is not null and publication_txid is not null)
        or (operation='draft_saved' and review_request_id is null and review_decision_id is null and publication_txid is null and not ('first_publication'=any(reasons))));
    alter table resident_experience_event drop constraint resident_experience_event_reasons_check;
    alter table resident_experience_event add constraint resident_experience_event_reasons_check
      check(cardinality(reasons) between 0 and 5 and reasons <@ array['first_publication','actions_changed','contacts_changed','navigation_links_changed','footer_links_changed']::text[]);
    create unique index resident_approval_consumed on resident_experience_event(organization_id,review_decision_id) where operation='published';
    create unique index resident_publication_transition on resident_experience_event(organization_id,resource_revision) where operation='published';

    -- Complete normalized snapshots are compared in SQL as well as in the domain layer.
    create function resident_publication_changes(org uuid, target_id uuid, baseline uuid) returns jsonb language plpgsql stable as $$
    declare current_p jsonb; prior_p jsonb; fields text[]='{}'; why text[]='{}'; section text; different boolean;
    begin
      select presentation into current_p from resident_experience_revision where organization_id=org and id=target_id;
      if not found then raise exception 'Resident revision unavailable'; end if;
      if baseline is not null then
        select presentation into prior_p from resident_experience_revision where organization_id=org and id=baseline;
        if not found then raise exception 'Resident revision unavailable'; end if;
      else why=array_append(why,'first_publication'); end if;
      foreach section in array array['branding','metadata','navigation','hero','actionsTitle','benefitsLabel','footer'] loop
        if current_p->section is distinct from prior_p->section then fields=array_append(fields,'presentation.'||section); end if;
      end loop;
      foreach section in array array['actions','benefits','contacts'] loop
        if section='actions' then
          select coalesce((select jsonb_agg(to_jsonb(a)-array['organization_id','revision_id'] order by display_order,logical_id) from resident_experience_action a where organization_id=org and revision_id=target_id),'[]'::jsonb)
            is distinct from coalesce((select jsonb_agg(to_jsonb(a)-array['organization_id','revision_id'] order by display_order,logical_id) from resident_experience_action a where organization_id=org and revision_id=baseline),'[]'::jsonb) into different;
        elsif section='benefits' then
          select coalesce((select jsonb_agg(to_jsonb(a)-array['organization_id','revision_id'] order by display_order,logical_id) from resident_experience_benefit a where organization_id=org and revision_id=target_id),'[]'::jsonb)
            is distinct from coalesce((select jsonb_agg(to_jsonb(a)-array['organization_id','revision_id'] order by display_order,logical_id) from resident_experience_benefit a where organization_id=org and revision_id=baseline),'[]'::jsonb) into different;
        else
          select coalesce((select jsonb_agg(to_jsonb(a)-array['organization_id','revision_id'] order by logical_id) from resident_experience_contact a where organization_id=org and revision_id=target_id),'[]'::jsonb)
            is distinct from coalesce((select jsonb_agg(to_jsonb(a)-array['organization_id','revision_id'] order by logical_id) from resident_experience_contact a where organization_id=org and revision_id=baseline),'[]'::jsonb) into different;
        end if;
        if different then
          fields=array_append(fields,section);
          if section<>'benefits' then why=array_append(why,section||'_changed'); end if;
        end if;
      end loop;
      foreach section in array array['navigation','footer'] loop
        if coalesce(current_p->section->'links','[]'::jsonb) is distinct from coalesce(prior_p->section->'links','[]'::jsonb) then why=array_append(why,section||'_links_changed'); end if;
      end loop;
      return jsonb_build_object('changedFields',fields,'reasons',why,'consequential',cardinality(why)>0);
    end $$;

    -- Fail closed on incomplete, cyclic or excessively deep ancestry. Never infer latest content.
    create function resident_revision_lineage(org uuid, target_id uuid)
      returns table(revision_id uuid,saver uuid,consequential boolean,depth integer) language plpgsql stable as $$
    declare cursor_id uuid=target_id; seen uuid[]='{}'; previous_id uuid; actor uuid; n integer=0;
    begin
      while cursor_id is not null loop
        if cursor_id=any(seen) or n>=10000 then raise exception 'Resident lineage unavailable'; end if;
        select e.prior_revision_id,r.created_by into previous_id,actor
          from resident_experience_revision r join resident_experience_event e on e.organization_id=r.organization_id and e.new_revision_id=r.id and e.operation='draft_saved'
          where r.organization_id=org and r.id=cursor_id;
        if not found then raise exception 'Resident lineage unavailable'; end if;
        revision_id=cursor_id; saver=actor; depth=n;
        consequential=(resident_publication_changes(org,cursor_id,previous_id)->>'consequential')::boolean;
        return next; seen=array_append(seen,cursor_id); cursor_id=previous_id; n=n+1;
      end loop;
    end $$;
    create function resident_review_contributors(org uuid,target_id uuid,baseline uuid) returns setof uuid language sql stable as $$
      with candidate as materialized(select * from resident_revision_lineage(org,target_id)),
      previous as materialized(select * from resident_revision_lineage(org,baseline)),
      common as(select c.depth candidate_depth,p.depth previous_depth from candidate c join previous p using(revision_id) order by c.depth limit 1)
      select saver from candidate where depth=0 or (consequential and depth<coalesce((select candidate_depth from common),10000))
      union select saver from previous where consequential and depth<coalesce((select previous_depth from common),10000)
    $$;
    create function resident_publication_authorized(org uuid,actor uuid,high_impact boolean) returns boolean language sql stable as $$
      select exists(select 1 from staff_identity s join organization o on o.id=s.organization_id
        where s.organization_id=org and s.id=actor and s.active and o.status='active' and s.entra_tenant_id is not null and s.entra_object_id is not null)
        and not exists(select 1 from unnest(case when high_impact then array['admin.configuration.read','resident_experience.publish','resident_experience.contact.manage'] else array['admin.configuration.read','resident_experience.publish'] end) required(key)
          where not exists(select 1 from staff_role_assignment a join role r on r.organization_id=a.organization_id and r.id=a.role_id
            join role_permission p on p.organization_id=r.organization_id and p.role_id=r.id
            where a.organization_id=org and a.staff_identity_id=actor and a.active and r.active and p.permission_key=required.key))
    $$;
    create function resident_review_unexpired(decided timestamptz,instant timestamptz) returns boolean language sql immutable as $$
      select instant>=decided and instant<decided+interval '24 hours'
    $$;
    create function resident_review_context_valid(request resident_experience_review_request) returns boolean language sql stable as $$
      select exists(select 1 from organization_resident_experience r join organization_access_state a using(organization_id)
        where r.organization_id=request.organization_id and r.revision=request.resource_revision
        and r.published_revision_id is not distinct from request.baseline_revision_id
        and r.draft_revision_id is not distinct from request.draft_revision_id
        and a.authorization_revision=request.authorization_revision)
        and request.policy_version=1 and request.classifier_version=1
        and not exists(select 1 from resident_experience_review_request newer where newer.organization_id=request.organization_id and newer.review_sequence>request.review_sequence)
    $$;
    create function guard_resident_review_request() returns trigger language plpgsql as $$
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
    create trigger resident_review_request_guard before insert on resident_experience_review_request for each row execute function guard_resident_review_request();
    create function guard_resident_review_decision() returns trigger language plpgsql as $$
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
    create trigger resident_review_decision_guard before insert on resident_experience_review_decision for each row execute function guard_resident_review_decision();

    create function guard_resident_publication_event() returns trigger language plpgsql as $$
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
    create trigger resident_publication_event_guard before insert on resident_experience_event for each row execute function guard_resident_publication_event();
    create function verify_resident_publication_event() returns trigger language plpgsql as $$
    begin
      if NEW.operation='published' then
        if not exists(select 1 from organization_resident_experience r
          where r.organization_id=NEW.organization_id and r.published_revision_id=NEW.new_revision_id and r.revision=NEW.resource_revision) then raise exception 'Publication evidence requires matching transition'; end if;
        if not exists(select 1 from resident_experience_review_decision d
          join resident_experience_review_request q on q.organization_id=d.organization_id and q.id=d.request_id
          join organization_access_state a on a.organization_id=q.organization_id
          where d.organization_id=NEW.organization_id and d.id=NEW.review_decision_id and d.outcome='approved'
          and resident_review_unexpired(d.decided_at,clock_timestamp()) and a.authorization_revision=q.authorization_revision
          and not exists(select 1 from resident_experience_review_request newer where newer.organization_id=q.organization_id and newer.review_sequence>q.review_sequence)) then raise exception 'Resident approval expired or superseded before commit'; end if;
      end if;
      return null;
    end $$;
    create constraint trigger resident_publication_event_complete after insert on resident_experience_event deferrable initially deferred for each row execute function verify_resident_publication_event();
    create or replace function require_resident_resource_event() returns trigger language plpgsql as $$ begin
      if NEW.draft_revision_id is distinct from OLD.draft_revision_id then
        if NEW.published_revision_id is distinct from OLD.published_revision_id then raise exception 'Save and publication must be separate'; end if;
        if not exists(select 1 from resident_experience_revision r join resident_experience_event e on e.organization_id=r.organization_id and e.new_revision_id=r.id
          where r.organization_id=NEW.organization_id and r.id=NEW.draft_revision_id and r.creation_txid=txid_current() and r.resource_revision=NEW.revision
          and e.operation='draft_saved' and e.prior_revision_id is not distinct from OLD.draft_revision_id and e.prior_resource_revision=OLD.revision and e.resource_revision=NEW.revision) then raise exception 'Resident draft pointer requires atomic save evidence'; end if;
      end if;
      if NEW.published_revision_id is distinct from OLD.published_revision_id then
        if NEW.published_revision_id is null or not exists(select 1 from resident_experience_event e
          where e.organization_id=NEW.organization_id and e.operation='published' and e.publication_txid=txid_current()
          and e.prior_revision_id is not distinct from OLD.published_revision_id and e.new_revision_id=NEW.published_revision_id
          and e.prior_resource_revision=OLD.revision and e.resource_revision=NEW.revision) then raise exception 'Resident publication requires atomic approval evidence'; end if;
      end if;
      return null;
    end $$;
    create function guard_resident_resource_insert() returns trigger language plpgsql as $$ begin
      if NEW.revision<>1 or NEW.draft_revision_id is not null or NEW.published_revision_id is not null then raise exception 'Resident resource must start empty'; end if;
      return NEW;
    end $$;
    create trigger resident_resource_initial before insert on organization_resident_experience for each row execute function guard_resident_resource_insert();
  `.execute(db);
  for (const table of [
    'resident_experience_review_request',
    'resident_experience_review_decision',
  ]) {
    await sql`create trigger resident_review_immutable before update or delete on ${sql.table(table)} for each row execute function protect_resident_history();
      create trigger resident_review_no_truncate before truncate on ${sql.table(table)} execute function protect_resident_history();`.execute(
      db,
    );
  }
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    set local lock_timeout = '5s';
    lock table organization,organization_access_state,organization_resident_experience,resident_experience_revision,resident_experience_event,resident_experience_review_request,resident_experience_review_decision in access exclusive mode;
    do $$ begin
      if exists(select 1 from resident_experience_review_request) or exists(select 1 from resident_experience_review_decision)
        or exists(select 1 from resident_experience_event where operation<>'draft_saved')
        or exists(select 1 from organization_resident_experience where published_revision_id is not null) then raise exception 'Retained resident review evidence prevents rollback'; end if;
    end $$;
    drop trigger resident_resource_initial on organization_resident_experience;
    drop trigger resident_publication_event_complete on resident_experience_event;
    drop trigger resident_publication_event_guard on resident_experience_event;
    drop function guard_resident_resource_insert(),verify_resident_publication_event(),guard_resident_publication_event();
    alter table resident_experience_event drop constraint resident_publication_decision,drop constraint resident_publication_references;
    drop index resident_approval_consumed,resident_publication_transition;
    alter table resident_experience_event drop column review_request_id,drop column review_decision_id,drop column publication_txid;
    alter table resident_experience_event drop constraint resident_experience_event_reasons_check;
    alter table resident_experience_event add constraint resident_experience_event_reasons_check check(cardinality(reasons) between 0 and 4 and reasons <@ array['actions_changed','contacts_changed','navigation_links_changed','footer_links_changed']::text[]);
    drop table resident_experience_review_decision;
    drop trigger resident_review_request_guard on resident_experience_review_request;
    drop function guard_resident_review_decision(),guard_resident_review_request(),resident_review_context_valid(resident_experience_review_request);
    drop table resident_experience_review_request;
    drop function resident_review_unexpired(timestamptz,timestamptz),resident_publication_authorized(uuid,uuid,boolean),resident_review_contributors(uuid,uuid,uuid),resident_revision_lineage(uuid,uuid),resident_publication_changes(uuid,uuid,uuid);
    create or replace function require_resident_resource_event() returns trigger language plpgsql as $$ begin
      if NEW.draft_revision_id is distinct from OLD.draft_revision_id then
        if not exists(select 1 from resident_experience_revision r join resident_experience_event e on e.organization_id=r.organization_id and e.new_revision_id=r.id
          where r.organization_id=NEW.organization_id and r.id=NEW.draft_revision_id and r.creation_txid=txid_current() and r.resource_revision=NEW.revision
          and e.operation='draft_saved' and e.prior_revision_id is not distinct from OLD.draft_revision_id and e.prior_resource_revision=OLD.revision and e.resource_revision=NEW.revision) then raise exception 'Resident draft pointer requires atomic save evidence'; end if;
      end if;
      if NEW.published_revision_id is distinct from OLD.published_revision_id then raise exception 'Resident publication is not implemented'; end if;
      return null;
    end $$;
  `.execute(db);
}

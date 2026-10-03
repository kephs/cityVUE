import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

// Ordinal 41. Authoring only: no live/development application is authorized.
export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    create table organization_resident_experience (
      organization_id uuid primary key references organization(id),
      revision integer not null default 1 check(revision > 0),
      draft_revision_id uuid, published_revision_id uuid,
      created_at timestamptz not null default clock_timestamp(),
      updated_at timestamptz not null default clock_timestamp()
    );
    create table resident_experience_revision (
      id uuid primary key, organization_id uuid not null references organization_resident_experience(organization_id),
      resource_revision integer not null check(resource_revision > 1),
      schema_version integer not null check(schema_version = 1),
      presentation jsonb not null check(jsonb_typeof(presentation) = 'object' and octet_length(presentation::text) <= 65536),
      state varchar(16) not null default 'saved' check(state = 'saved'),
      created_by uuid not null, created_at timestamptz not null default clock_timestamp(),
      creation_txid bigint not null default txid_current(),
      unique(organization_id, id), unique(organization_id, resource_revision),
      foreign key(organization_id, created_by) references staff_identity(organization_id, id)
    );
    alter table organization_resident_experience
      add constraint resident_draft_owner foreign key(organization_id, draft_revision_id) references resident_experience_revision(organization_id, id),
      add constraint resident_published_owner foreign key(organization_id, published_revision_id) references resident_experience_revision(organization_id, id);
    create table resident_experience_contact (
      organization_id uuid not null, revision_id uuid not null,
      logical_id varchar(48) not null check(logical_id ~ '^[a-z][a-z0-9-]*$'),
      kind varchar(16) not null check(kind = 'phone'),
      classification varchar(24) not null check(classification in ('emergency','non_emergency')),
      display_value varchar(32) not null,
      phone_target varchar(16) not null check(phone_target ~ '^[+]?[0-9]{2,15}$'),
      guidance varchar(500) not null,
      primary key(organization_id, revision_id, logical_id),
      foreign key(organization_id, revision_id) references resident_experience_revision(organization_id, id),
      check(regexp_replace(display_value, '[ ().-]', '', 'g') = phone_target)
    );
    create table resident_experience_action (
      organization_id uuid not null, revision_id uuid not null,
      logical_id varchar(48) not null check(logical_id ~ '^[a-z][a-z0-9-]*$'),
      enabled boolean not null, display_order integer not null check(display_order between 0 and 10000),
      icon_key varchar(48) not null check(icon_key in ('report','emergency','water')),
      title varchar(100) not null check(length(btrim(title)) > 0),
      description varchar(320) not null check(length(btrim(description)) > 0),
      cta_label varchar(80) not null check(length(btrim(cta_label)) > 0),
      action_type varchar(16) not null check(action_type in ('internal','external','phone')),
      target varchar(2048), contact_id varchar(48),
      tone varchar(16) not null check(tone in ('primary','danger','warning')),
      primary key(organization_id, revision_id, logical_id),
      unique(organization_id, revision_id, display_order),
      foreign key(organization_id, revision_id) references resident_experience_revision(organization_id, id),
      foreign key(organization_id, revision_id, contact_id) references resident_experience_contact(organization_id, revision_id, logical_id),
      check((action_type = 'phone' and target is null and contact_id is not null and cta_label !~ '[0-9]') or
            (action_type in ('internal','external') and target is not null and contact_id is null)),
      check(action_type <> 'internal' or target in ('/','/report')),
      check(action_type <> 'external' or target like 'https://%')
    );
    create table resident_experience_benefit (
      organization_id uuid not null, revision_id uuid not null,
      logical_id varchar(48) not null check(logical_id ~ '^[a-z][a-z0-9-]*$'),
      enabled boolean not null, display_order integer not null check(display_order between 0 and 10000),
      icon_key varchar(48) not null check(icon_key in ('residents','responsive','operations','community')),
      title varchar(100) not null check(length(btrim(title)) > 0),
      description varchar(240) not null check(length(btrim(description)) > 0),
      primary key(organization_id, revision_id, logical_id),
      unique(organization_id, revision_id, display_order),
      foreign key(organization_id, revision_id) references resident_experience_revision(organization_id, id)
    );
    create table resident_experience_event (
      id uuid primary key, organization_id uuid not null references organization_resident_experience(organization_id),
      actor_id uuid not null, operation varchar(24) not null check(operation in ('draft_saved','approved','published')),
      prior_revision_id uuid, new_revision_id uuid not null,
      prior_resource_revision integer not null check(prior_resource_revision > 0),
      resource_revision integer not null check(resource_revision >= prior_resource_revision),
      changed_fields text[] not null check(cardinality(changed_fields) between 0 and 10 and changed_fields <@ array['presentation.branding','presentation.metadata','presentation.navigation','presentation.hero','presentation.actionsTitle','presentation.benefitsLabel','presentation.footer','actions','benefits','contacts']::text[]),
      consequential boolean not null,
      reasons text[] not null check(cardinality(reasons) between 0 and 4 and reasons <@ array['actions_changed','contacts_changed','navigation_links_changed','footer_links_changed']::text[]),
      correlation_id uuid not null, occurred_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id, actor_id) references staff_identity(organization_id, id),
      foreign key(organization_id, prior_revision_id) references resident_experience_revision(organization_id, id),
      foreign key(organization_id, new_revision_id) references resident_experience_revision(organization_id, id),
      check(consequential = (cardinality(reasons) > 0)),
      check(operation <> 'draft_saved' or resource_revision = prior_resource_revision + 1)
    );
    create unique index resident_saved_event on resident_experience_event(organization_id, new_revision_id) where operation = 'draft_saved';
    create index resident_event_history on resident_experience_event(organization_id, occurred_at, id);

    create function initialize_resident_experience() returns trigger language plpgsql as $$ begin
      insert into organization_resident_experience(organization_id) values(NEW.id); return NEW;
    end $$;
    insert into organization_resident_experience(organization_id) select id from organization;
    create trigger resident_experience_default after insert on organization for each row execute function initialize_resident_experience();

    create function protect_resident_history() returns trigger language plpgsql as $$ begin
      raise exception 'Resident experience history is immutable';
    end $$;
    create trigger resident_revision_immutable before update or delete on resident_experience_revision for each row execute function protect_resident_history();
    create trigger resident_revision_no_truncate before truncate on resident_experience_revision for each statement execute function protect_resident_history();
    create trigger resident_action_immutable before update or delete on resident_experience_action for each row execute function protect_resident_history();
    create trigger resident_action_no_truncate before truncate on resident_experience_action for each statement execute function protect_resident_history();
    create trigger resident_benefit_immutable before update or delete on resident_experience_benefit for each row execute function protect_resident_history();
    create trigger resident_benefit_no_truncate before truncate on resident_experience_benefit for each statement execute function protect_resident_history();
    create trigger resident_contact_immutable before update or delete on resident_experience_contact for each row execute function protect_resident_history();
    create trigger resident_contact_no_truncate before truncate on resident_experience_contact for each statement execute function protect_resident_history();
    create trigger resident_event_immutable before update or delete on resident_experience_event for each row execute function protect_resident_history();
    create trigger resident_event_no_truncate before truncate on resident_experience_event for each statement execute function protect_resident_history();

    create function stamp_resident_revision() returns trigger language plpgsql as $$ begin
      NEW.creation_txid := txid_current(); NEW.created_at := clock_timestamp(); return NEW;
    end $$;
    create trigger resident_revision_stamp before insert on resident_experience_revision for each row execute function stamp_resident_revision();
    -- Prevent adding children to an already committed revision, not only editing its existing children.
    create function protect_resident_child_insert() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from resident_experience_revision where organization_id=NEW.organization_id and id=NEW.revision_id and creation_txid=txid_current()) then
        raise exception 'Resident revision is closed';
      end if; return NEW;
    end $$;
    create trigger resident_action_insert before insert on resident_experience_action for each row execute function protect_resident_child_insert();
    create trigger resident_benefit_insert before insert on resident_experience_benefit for each row execute function protect_resident_child_insert();
    create trigger resident_contact_insert before insert on resident_experience_contact for each row execute function protect_resident_child_insert();

    create function protect_resident_resource() returns trigger language plpgsql as $$ begin
      if NEW.organization_id is distinct from OLD.organization_id or NEW.created_at is distinct from OLD.created_at then raise exception 'Resident ownership is immutable'; end if;
      if row(NEW.draft_revision_id,NEW.published_revision_id) is not distinct from row(OLD.draft_revision_id,OLD.published_revision_id) then
        NEW.revision := OLD.revision; NEW.updated_at := OLD.updated_at; return NEW;
      end if;
      if NEW.revision <> OLD.revision + 1 then raise exception 'Resident resource revision must advance once'; end if;
      NEW.updated_at := clock_timestamp(); return NEW;
    end $$;
    create trigger resident_resource_update before update on organization_resident_experience for each row execute function protect_resident_resource();
    create trigger resident_resource_delete before delete on organization_resident_experience for each row execute function protect_resident_history();
    create trigger resident_resource_no_truncate before truncate on organization_resident_experience for each statement execute function protect_resident_history();

    create function require_resident_save_event() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from resident_experience_event e where e.organization_id=NEW.organization_id and e.new_revision_id=NEW.id and e.operation='draft_saved' and e.resource_revision=NEW.resource_revision and e.actor_id=NEW.created_by) then
        raise exception 'Resident revision requires atomic save evidence';
      end if; return null;
    end $$;
    create constraint trigger resident_revision_audited after insert on resident_experience_revision deferrable initially deferred for each row execute function require_resident_save_event();
    create function require_resident_resource_event() returns trigger language plpgsql as $$ begin
      if NEW.draft_revision_id is distinct from OLD.draft_revision_id then
        if not exists(select 1 from resident_experience_revision r join resident_experience_event e on e.organization_id=r.organization_id and e.new_revision_id=r.id
          where r.organization_id=NEW.organization_id and r.id=NEW.draft_revision_id and r.creation_txid=txid_current() and r.resource_revision=NEW.revision
          and e.operation='draft_saved' and e.prior_revision_id is not distinct from OLD.draft_revision_id and e.prior_resource_revision=OLD.revision and e.resource_revision=NEW.revision) then
          raise exception 'Resident draft pointer requires atomic save evidence';
        end if;
      end if;
      if NEW.published_revision_id is distinct from OLD.published_revision_id then
        raise exception 'Resident publication is not implemented';
      end if;
      return null;
    end $$;
    create constraint trigger resident_resource_audited after update on organization_resident_experience deferrable initially deferred for each row execute function require_resident_resource_event();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table organization, organization_resident_experience, resident_experience_revision, resident_experience_action, resident_experience_benefit, resident_experience_contact, resident_experience_event in access exclusive mode;
    do $$ begin
      if exists(select 1 from resident_experience_revision) or exists(select 1 from resident_experience_event) or exists(select 1 from organization_resident_experience where revision > 1 or draft_revision_id is not null or published_revision_id is not null) then
        raise exception 'Retained resident experience history prevents rollback';
      end if;
    end $$;
    drop trigger resident_experience_default on organization;
    drop function initialize_resident_experience();
    alter table organization_resident_experience drop constraint resident_draft_owner, drop constraint resident_published_owner;
    drop table resident_experience_event, resident_experience_action, resident_experience_benefit, resident_experience_contact, resident_experience_revision, organization_resident_experience;
    drop function require_resident_resource_event(), require_resident_save_event(), protect_resident_resource(), protect_resident_child_insert(), stamp_resident_revision(), protect_resident_history();
  `.execute(db);
}

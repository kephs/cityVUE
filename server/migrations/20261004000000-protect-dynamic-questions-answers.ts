import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table service_definition_version,question,question_option,service_request,answer in share row exclusive mode;
    do $$ begin
      if exists(select 1 from answer a join service_request r on r.id=a.service_request_id
        join question q on q.id=a.question_id where a.organization_id<>r.organization_id
        or a.organization_id<>q.organization_id or q.service_definition_version_id<>r.service_definition_version_id
        or a.question_key<>q.question_key or a.question_type<>q.question_type)
        or exists(select 1 from answer a where a.option_key is not null and not exists
          (select 1 from question_option o where o.organization_id=a.organization_id and o.question_id=a.question_id and o.option_key=a.option_key))
        then raise exception 'Existing answer relationships prevent migration'; end if;
      if exists(select 1 from question q where q.visibility_condition is not null and not exists
        (select 1 from question c where c.organization_id=q.organization_id and c.service_definition_version_id=q.service_definition_version_id
          and c.question_key=q.visibility_condition->>'questionKey' and c.status='active'
          and (c.question_type<>'single_select' or exists(select 1 from question_option o where o.question_id=c.id and o.status='active' and o.option_key=q.visibility_condition->>'value'))))
        then raise exception 'Existing conditional dependencies prevent migration'; end if;
    end $$;
    alter table service_request add constraint request_answer_version_unique unique(organization_id,id,service_definition_version_id);
    alter table question add constraint answer_question_version_unique unique(organization_id,id,service_definition_version_id);
    alter table answer add column catalog_version_id uuid;
    update answer a set catalog_version_id=r.service_definition_version_id from service_request r where r.id=a.service_request_id;
    alter table answer alter column catalog_version_id set not null;
    alter table answer add constraint answer_request_version_fk foreign key(organization_id,service_request_id,catalog_version_id)
      references service_request(organization_id,id,service_definition_version_id);
    alter table answer add constraint answer_question_version_fk foreign key(organization_id,question_id,catalog_version_id)
      references question(organization_id,id,service_definition_version_id);
    alter table answer add constraint answer_option_fk foreign key(organization_id,question_id,option_key)
      references question_option(organization_id,question_id,option_key);
    create function capture_answer_version() returns trigger language plpgsql as $$ begin
      select service_definition_version_id into new.catalog_version_id from service_request
        where organization_id=new.organization_id and id=new.service_request_id;
      return new;
    end $$;
    create trigger answer_capture_version before insert on answer for each row execute function capture_answer_version();
    create function protect_submitted_answer() returns trigger language plpgsql as $$ begin
      raise exception 'Submitted answers are immutable'; end $$;
    create trigger answer_immutable before update or delete on answer for each row execute function protect_submitted_answer();
    create trigger answer_no_truncate before truncate on answer for each statement execute function protect_submitted_answer();

    create function protect_catalog_children() returns trigger language plpgsql as $$
    declare old_version uuid; new_version uuid; candidate record;
    begin
      if TG_TABLE_NAME='question' then
        if TG_OP<>'INSERT' then old_version=old.service_definition_version_id; end if;
        if TG_OP<>'DELETE' then new_version=new.service_definition_version_id; end if;
      else
        -- Lock parents first: a question cannot be reparented while its options change.
        for candidate in select id,service_definition_version_id from question
          where id in (case when TG_OP<>'INSERT' then old.question_id end,case when TG_OP<>'DELETE' then new.question_id end)
          order by id for share loop
          if TG_OP<>'INSERT' and candidate.id=old.question_id then old_version=candidate.service_definition_version_id; end if;
          if TG_OP<>'DELETE' and candidate.id=new.question_id then new_version=candidate.service_definition_version_id; end if;
        end loop;
      end if;
      -- FOR UPDATE coordinates with publication, including non-key status changes.
      for candidate in select id,status from service_definition_version
        where id in (old_version,new_version) order by id for update loop
        if candidate.status<>'draft' then raise exception 'Published catalog children are immutable'; end if;
      end loop;
      if TG_OP='DELETE' then return old; end if;
      return new;
    end $$;
    create trigger question_published_immutable before insert or update or delete on question
      for each row execute function protect_catalog_children();
    create trigger option_published_immutable before insert or update or delete on question_option
      for each row execute function protect_catalog_children();
    create trigger question_no_truncate before truncate on question for each statement execute function protect_submitted_answer();
    create trigger option_no_truncate before truncate on question_option for each statement execute function protect_submitted_answer();

    alter table issue_configuration_audit add column schema_summary jsonb;
    insert into permission(permission_key) values('service_request.answers.read');
    create table request_answer_read_audit(
      id uuid primary key default gen_random_uuid(),organization_id uuid not null,
      service_request_id uuid not null,staff_identity_id uuid not null,correlation_id uuid not null,
      action text not null default 'answers_read' check(action='answers_read'),
      occurred_at timestamptz not null default clock_timestamp(),
      foreign key(organization_id,service_request_id) references service_request(organization_id,id),
      foreign key(organization_id,staff_identity_id) references staff_identity(organization_id,id));
    create trigger answer_read_audit_immutable before update or delete on request_answer_read_audit
      for each row execute function protect_submitted_answer();
    create trigger answer_read_audit_no_truncate before truncate on request_answer_read_audit
      for each statement execute function protect_submitted_answer();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table request_answer_read_audit,role_permission,answer in access exclusive mode;
    do $$ begin if exists(select 1 from request_answer_read_audit) or exists(select 1 from issue_configuration_audit where schema_summary is not null) or exists
      (select 1 from role_permission where permission_key='service_request.answers.read')
      then raise exception 'Retained protected answer access prevents rollback'; end if; end $$;
    drop table request_answer_read_audit;
    alter table issue_configuration_audit drop column schema_summary;
    delete from permission where permission_key='service_request.answers.read';
    drop trigger option_published_immutable on question_option;
    drop trigger question_published_immutable on question;
    drop trigger question_no_truncate on question;
    drop trigger option_no_truncate on question_option;
    drop function protect_catalog_children();
    drop trigger answer_capture_version on answer;
    drop trigger answer_immutable on answer;
    drop trigger answer_no_truncate on answer;
    drop function capture_answer_version();
    drop function protect_submitted_answer();
    alter table answer drop constraint answer_option_fk,drop constraint answer_question_version_fk,drop constraint answer_request_version_fk,drop column catalog_version_id;
    alter table question drop constraint answer_question_version_unique;
    alter table service_request drop constraint request_answer_version_unique;
  `.execute(db);
}

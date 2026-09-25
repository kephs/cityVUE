import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../src/database/database.types.js';

export async function up(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table question,question_option,answer in share row exclusive mode;
    do $$ begin
      if exists(select 1 from question where question_type in ('multi_select','date','information'))
        or exists(select 1 from answer where question_type in ('multi_select','date','information'))
        then raise exception 'Existing extended question types require compatibility review'; end if;
    end $$;
    alter table question drop constraint question_question_type_check;
    alter table question add constraint question_question_type_check check
      (question_type in ('short_text','long_text','number','yes_no','single_select','date','timestamp','multi_select','attachment_reference','information'));
    alter table question add constraint extended_question_metadata_check check
      ((question_type not in ('multi_select','date','information') or validation_metadata is null)
       and (question_type<>'information' or (not is_required and help_text is null and char_length(btrim(label)) between 1 and 200)));
    create function protect_extended_question_options() returns trigger language plpgsql as $$ begin
      if exists(select 1 from question where id=new.question_id and question_type in ('date','information'))
        then raise exception 'This question type cannot have options'; end if;
      return new;
    end $$;
    create trigger extended_question_options before insert or update on question_option
      for each row execute function protect_extended_question_options();
    alter table answer add column date_value date, add column selected_option_count smallint;
    alter table answer drop constraint answer_question_type_check, drop constraint answer_check;
    alter table answer add constraint answer_question_type_check check
      (question_type in ('short_text','long_text','number','yes_no','single_select','multi_select','date'));
    alter table answer add constraint answer_check check
      ((question_type in ('short_text','long_text') and text_value is not null and number_value is null and boolean_value is null and option_key is null and date_value is null and selected_option_count is null)
      or (question_type='number' and number_value is not null and text_value is null and boolean_value is null and option_key is null and date_value is null and selected_option_count is null)
      or (question_type='yes_no' and boolean_value is not null and text_value is null and number_value is null and option_key is null and date_value is null and selected_option_count is null)
      or (question_type='single_select' and option_key is not null and display_value is not null and text_value is null and number_value is null and boolean_value is null and date_value is null and selected_option_count is null)
      or (question_type='multi_select' and selected_option_count is not null and selected_option_count between 1 and 25 and text_value is null and number_value is null and boolean_value is null and option_key is null and display_value is null and date_value is null)
      or (question_type='date' and date_value is not null and date_value between date '0001-01-01' and date '9999-12-31' and text_value is null and number_value is null and boolean_value is null and option_key is null and display_value is null and selected_option_count is null));
    alter table answer add constraint selected_answer_question_unique unique(organization_id,id,question_id);
    create table answer_selected_option(
      organization_id uuid not null, answer_id uuid not null, question_id uuid not null,
      option_key varchar(100) not null, option_label text not null, display_order integer not null check(display_order>=0),
      primary key(answer_id,option_key),
      foreign key(organization_id,answer_id,question_id) references answer(organization_id,id,question_id),
      foreign key(organization_id,question_id,option_key) references question_option(organization_id,question_id,option_key));
    create function capture_selected_option() returns trigger language plpgsql as $$ begin
      if not exists(select 1 from answer where organization_id=new.organization_id and id=new.answer_id
        and question_id=new.question_id and question_type='multi_select')
        then raise exception 'Selection requires a matching multi-select answer'; end if;
      select label,display_order into strict new.option_label,new.display_order from question_option
        where organization_id=new.organization_id and question_id=new.question_id and option_key=new.option_key and status='active';
      return new;
    end $$;
    create trigger selected_option_capture before insert on answer_selected_option for each row execute function capture_selected_option();
    create trigger selected_option_immutable before update or delete on answer_selected_option for each row execute function protect_submitted_answer();
    create trigger selected_option_no_truncate before truncate on answer_selected_option for each statement execute function protect_submitted_answer();
    create function check_selected_option_count() returns trigger language plpgsql as $$
    declare parent_id uuid; expected integer; actual integer;
    begin
      if TG_TABLE_NAME='answer' then parent_id=new.id; else parent_id=new.answer_id; end if;
      select selected_option_count into expected from answer where id=parent_id;
      if expected is not null then
        select count(*) into actual from answer_selected_option where answer_id=parent_id;
        if actual<>expected then raise exception 'Submitted selections must match the immutable answer'; end if;
      end if;
      return null;
    end $$;
    create constraint trigger answer_selection_complete after insert on answer deferrable initially deferred
      for each row execute function check_selected_option_count();
    create constraint trigger selection_complete after insert on answer_selected_option deferrable initially deferred
      for each row execute function check_selected_option_count();
    create function validate_extended_answer() returns trigger language plpgsql as $$ begin
      if not exists
        (select 1 from question where organization_id=new.organization_id and id=new.question_id
          and question_type=new.question_type and question_key=new.question_key and status='active')
        then raise exception 'Answer type and identity must match the historical question'; end if;
      return new;
    end $$;
    create trigger extended_answer_identity before insert on answer for each row execute function validate_extended_answer();
  `.execute(db);
}

export async function down(db: Kysely<DatabaseSchema>): Promise<void> {
  await sql`
    lock table question,question_option,answer,answer_selected_option in access exclusive mode;
    do $$ begin
      if exists(select 1 from question where question_type in ('multi_select','date','information'))
        or exists(select 1 from answer where date_value is not null or selected_option_count is not null)
        or exists(select 1 from answer_selected_option)
        then raise exception 'Retained extended question history prevents rollback'; end if;
    end $$;
    drop trigger answer_selection_complete on answer;
    drop table answer_selected_option;
    drop function check_selected_option_count();
    drop function capture_selected_option();
    drop trigger extended_answer_identity on answer;
    drop function validate_extended_answer();
    drop trigger extended_question_options on question_option;
    drop function protect_extended_question_options();
    alter table answer drop constraint selected_answer_question_unique,drop constraint answer_check,drop constraint answer_question_type_check,
      drop column date_value,drop column selected_option_count;
    alter table answer add constraint answer_question_type_check check(question_type in ('short_text','long_text','number','yes_no','single_select'));
    alter table answer add constraint answer_check check
      ((question_type in ('short_text','long_text') and text_value is not null and number_value is null and boolean_value is null and option_key is null)
       or (question_type='number' and number_value is not null and text_value is null and boolean_value is null and option_key is null)
       or (question_type='yes_no' and boolean_value is not null and text_value is null and number_value is null and option_key is null)
       or (question_type='single_select' and option_key is not null and display_value is not null and text_value is null and number_value is null and boolean_value is null));
    alter table question drop constraint extended_question_metadata_check,drop constraint question_question_type_check;
    alter table question add constraint question_question_type_check check
      (question_type in ('short_text','long_text','number','yes_no','single_select','date','timestamp','multi_select','attachment_reference'));
  `.execute(db);
}

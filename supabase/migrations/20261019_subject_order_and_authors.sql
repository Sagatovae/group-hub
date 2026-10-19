-- Добавляем поля без удаления существующих предметов и материалов.
begin;
alter table public.subjects add column if not exists position integer;
with ranked as (select id, row_number() over (order by name,id)::integer - 1 as position from public.subjects)
update public.subjects s set position = ranked.position from ranked where s.id = ranked.id and s.position is null;
alter table public.subjects alter column position set default 0;
alter table public.subjects alter column position set not null;
alter table public.materials add column if not exists author text;
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid='public.subjects'::regclass and conname='subjects_position_nonnegative') then
    alter table public.subjects add constraint subjects_position_nonnegative check (position >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.materials'::regclass and conname='materials_author_check') then
    alter table public.materials add constraint materials_author_check check (author in ('Староста','Групп.орг','Проф.орг'));
  end if;
end $$;

create or replace function public.create_subject(
  subject_id uuid, subject_name text, subject_teacher text, subject_semester integer,
  subject_color text, section_names text[], section_ids uuid[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  lock table public.subjects in share row exclusive mode;
  if cardinality(section_names) is distinct from cardinality(section_ids)
     or cardinality(section_names) is null or cardinality(section_names) < 1 then
    raise exception 'At least one section and matching IDs are required';
  end if;
  insert into public.subjects(id, name, teacher, semester, color, position)
    values (subject_id, subject_name, subject_teacher, subject_semester, subject_color, (select coalesce(max(position),-1)+1 from public.subjects));
  insert into public.sections(id, subject_id, name, position)
    select section_ids[i], create_subject.subject_id, section_names[i], i - 1
    from generate_subscripts(section_names, 1) as i;
end;
$$;
revoke all on function public.create_subject(uuid,text,text,integer,text,text[],uuid[]) from public;
grant execute on function public.create_subject(uuid,text,text,integer,text,text[],uuid[]) to anon, authenticated;

-- Сохраняем весь порядок одной транзакцией; устаревший список отклоняется.
create or replace function public.reorder_subjects(subject_ids uuid[]) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  lock table public.subjects in share row exclusive mode;
  if subject_ids is null
    or cardinality(subject_ids) <> (select count(*) from public.subjects)
    or cardinality(subject_ids) <> (select count(distinct id) from unnest(subject_ids) as id)
    or exists (select 1 from unnest(subject_ids) as requested(id) where not exists (select 1 from public.subjects s where s.id = requested.id)) then
    raise exception 'Subject list changed; refresh and try again';
  end if;
  update public.subjects as s set position = ordered.ordinality::integer - 1
    from unnest(subject_ids) with ordinality as ordered(id, ordinality)
    where s.id = ordered.id;
end;
$$;
revoke all on function public.reorder_subjects(uuid[]) from public;
grant execute on function public.reorder_subjects(uuid[]) to anon, authenticated;

update storage.buckets set allowed_mime_types = array[
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain','application/zip','application/x-zip-compressed','image/png','image/jpeg','image/webp','image/gif','image/avif'
] where id = 'materials';
commit;

-- Выполните один раз в SQL Editor нового проекта Supabase.
-- Все посетители могут читать и редактировать материалы без входа.
begin;

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  position integer not null default 0 constraint subjects_position_nonnegative check (position >= 0),
  teacher text not null default '' check (length(teacher) <= 120),
  semester integer not null default 1 check (semester between 1 and 12),
  color text not null default 'sage' check (color in ('sage','blue','peach','lavender'))
);
create table public.sections (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.subjects(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  position integer not null default 0 check (position >= 0),
  unique (id, subject_id),
  unique (subject_id, name)
);
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid references public.subjects(id) on delete cascade,
  section_id uuid,
  title text not null default '' constraint materials_title_length_check check (length(btrim(title)) <= 180),
  body text not null default '' check (length(body) <= 20000),
  deadline date,
  delete_after_deadline boolean not null default false check (not delete_after_deadline or deadline is not null),
  author text constraint materials_author_check check (author in ('Староста','Групп.орг','Проф.орг')),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  constraint materials_content_check check (
    length(btrim(title)) > 0 or length(btrim(body)) > 0
    or jsonb_array_length(attachments) > 0 or deadline is not null
    or author is not null or pinned
  ),
  constraint material_location check ((subject_id is null) = (section_id is null)),
  constraint section_belongs_to_subject foreign key (section_id, subject_id)
    references public.sections(id, subject_id) on delete cascade
);
create index materials_subject_idx on public.materials(subject_id);
create index materials_section_idx on public.materials(section_id);
create index materials_created_idx on public.materials(created_at desc);
create index materials_deadline_idx on public.materials(deadline) where deadline is not null;

alter table public.subjects enable row level security;
alter table public.sections enable row level security;
alter table public.materials enable row level security;
create policy "Public subjects" on public.subjects for select to anon, authenticated using (true);
create policy "Public sections" on public.sections for select to anon, authenticated using (true);
create policy "Public materials" on public.materials for select to anon, authenticated using (true);
create policy "Shared subject editing" on public.subjects for all to anon, authenticated
  using (true) with check (true);
create policy "Shared section editing" on public.sections for all to anon, authenticated
  using (true) with check (true);
create policy "Shared material editing" on public.materials for all to anon, authenticated
  using (true) with check (true);
revoke all on public.subjects, public.sections, public.materials from anon, authenticated;
grant select on public.subjects, public.sections, public.materials to anon, authenticated;
grant insert, update, delete on public.subjects, public.sections, public.materials to anon, authenticated;

-- Одна транзакция: предмет и все его начальные разделы.
create function public.create_subject(
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

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('materials', 'materials', true, null, array[
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain', 'application/zip', 'application/x-zip-compressed',
  'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'
]);
create policy "Shared uploads" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'materials');
create policy "Shared file listing" on storage.objects for select to anon, authenticated
  using (bucket_id = 'materials');
create policy "Shared file deletion" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'materials');

commit;

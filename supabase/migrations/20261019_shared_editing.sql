-- Для существующего проекта с первоначальной схемой.
-- После применения редактирование доступно всем посетителям без входа.
begin;
drop policy if exists "Admin subject writes" on public.subjects;
drop policy if exists "Admin section writes" on public.sections;
drop policy if exists "Admin material writes" on public.materials;
drop policy if exists "Admin uploads" on storage.objects;
drop policy if exists "Admin file listing" on storage.objects;
drop policy if exists "Admin file deletion" on storage.objects;
create policy "Shared subject editing" on public.subjects for all to anon, authenticated
  using (true) with check (true);
create policy "Shared section editing" on public.sections for all to anon, authenticated
  using (true) with check (true);
create policy "Shared material editing" on public.materials for all to anon, authenticated
  using (true) with check (true);
grant insert, update, delete on public.subjects, public.sections, public.materials to anon, authenticated;

create or replace function public.create_subject(
  subject_id uuid, subject_name text, subject_teacher text, subject_semester integer,
  subject_color text, section_names text[], section_ids uuid[]
) returns void language plpgsql security invoker set search_path = '' as $$
begin
  if cardinality(section_names) is distinct from cardinality(section_ids)
     or cardinality(section_names) is null or cardinality(section_names) < 1 then
    raise exception 'At least one section and matching IDs are required';
  end if;
  insert into public.subjects(id, name, teacher, semester, color)
    values (subject_id, subject_name, subject_teacher, subject_semester, subject_color);
  insert into public.sections(id, subject_id, name, position)
    select section_ids[i], create_subject.subject_id, section_names[i], i - 1
    from generate_subscripts(section_names, 1) as i;
end;
$$;
revoke all on function public.create_subject(uuid,text,text,integer,text,text[],uuid[]) from public;
grant execute on function public.create_subject(uuid,text,text,integer,text,text[],uuid[]) to anon, authenticated;

create policy "Shared uploads" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'materials');
create policy "Shared file listing" on storage.objects for select to anon, authenticated
  using (bucket_id = 'materials');
create policy "Shared file deletion" on storage.objects for delete to anon, authenticated
  using (bucket_id = 'materials');

drop function if exists public.is_group_admin();
drop table if exists public.administrators;
commit;

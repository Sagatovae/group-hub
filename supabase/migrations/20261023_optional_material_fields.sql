begin;

-- Keep text columns as strings, but permit an omitted title.
alter table public.materials alter column title set default '';
alter table public.materials drop constraint if exists materials_title_check;
alter table public.materials drop constraint if exists materials_title_length_check;
alter table public.materials add constraint materials_title_length_check
  check (length(btrim(title)) <= 180);
alter table public.materials drop constraint if exists materials_content_check;
alter table public.materials add constraint materials_content_check check (
  length(btrim(title)) > 0 or length(btrim(body)) > 0
  or jsonb_array_length(attachments) > 0 or deadline is not null
  or author is not null or pinned
);

-- Notification labels describe untitled blocks without adding a fake stored title.
create or replace function public.enqueue_material_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subject_name text; material_label text; attachment_count integer;
begin
  select s.name into subject_name from public.subjects s where s.id = new.subject_id;
  attachment_count := jsonb_array_length(new.attachments);
  material_label := coalesce(
    nullif(btrim(new.title), ''), nullif(left(split_part(btrim(new.body), E'\n', 1), 120), ''),
    nullif(new.attachments->0->>'name', ''),
    case when new.deadline is not null then 'Событие с дедлайном' end,
    new.author, case when new.pinned then 'Закреплённый блок' else 'Материал' end
  );
  insert into public.push_deliveries(subscription_id,material_id,payload)
    select id,new.id,jsonb_build_object(
      'title',left(coalesce(subject_name,'Объявления') || ' · ' || material_label,180),
      'body',concat_ws(' · ',nullif(left(btrim(new.body),240),''),case when attachment_count>0 then 'Вложений: ' || attachment_count::text end),
      'tag','material-' || new.id::text,
      'route',case when new.subject_id is null then '#home' else '#subject/' || new.subject_id::text end)
    from public.push_subscriptions;
  return new;
end;
$$;
revoke all on function public.enqueue_material_push() from public, anon, authenticated;

commit;

begin;
create table public.push_config (id boolean primary key default true check(id), keys jsonb not null);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(), endpoint text not null unique,
  subscription jsonb not null, updated_at timestamptz not null default now()
);
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  material_id uuid not null, payload jsonb not null,
  attempts integer not null default 0, available_at timestamptz not null default now(),
  lease_until timestamptz, lease_token uuid, sent_at timestamptz, last_error text,
  created_at timestamptz not null default now(), unique(subscription_id,material_id)
);
alter table public.push_config enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_deliveries enable row level security;
revoke all on public.push_config, public.push_subscriptions, public.push_deliveries from public, anon, authenticated;
grant all on public.push_config, public.push_subscriptions, public.push_deliveries to service_role;
create index push_deliveries_pending on public.push_deliveries(available_at) where sent_at is null;

create or replace function public.enqueue_telegram_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subject_name text; section_name text; material_payload jsonb;
begin
  select s.name into subject_name from public.subjects s where s.id = new.subject_id;
  select s.name into section_name from public.sections s where s.id = new.section_id;
  material_payload := to_jsonb(new) || jsonb_build_object('subject_name',subject_name,'section_name',section_name);
  if tg_op = 'INSERT' then
    insert into public.telegram_outbox(material_id,payload) values(new.id,material_payload);
  elsif (new.title,new.body,new.author,new.attachments,new.subject_id,new.section_id) is distinct from
        (old.title,old.body,old.author,old.attachments,old.subject_id,old.section_id) then
    update public.telegram_outbox set payload = material_payload, revision = revision + 1,
      sent_at = null, attempts = 0, last_error = null, available_at = now()
    where material_id = new.id;
  end if;
  return new;
end;
$$;

create function public.enqueue_material_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare subject_name text;
begin
  select s.name into subject_name from public.subjects s where s.id = new.subject_id;
  insert into public.push_deliveries(subscription_id,material_id,payload)
    select id,new.id,jsonb_build_object(
      'title',left(coalesce(subject_name,'Объявления') || ' · ' || new.title,180),
      'body',left(new.body,240) || case when jsonb_array_length(new.attachments)>0 then ' · Вложений: ' || jsonb_array_length(new.attachments)::text else '' end,
      'tag','material-' || new.id::text,
      'route',case when new.subject_id is null then '#home' else '#subject/' || new.subject_id::text end)
    from public.push_subscriptions;
  return new;
end;
$$;
revoke all on function public.enqueue_material_push() from public, anon, authenticated;
create trigger material_push_created after insert on public.materials
for each row execute function public.enqueue_material_push();

create function public.claim_push_deliveries() returns setof public.push_deliveries
language sql security definer set search_path = '' as $$
  update public.push_deliveries set lease_until = now() + interval '3 minutes',
    lease_token = gen_random_uuid(), attempts = attempts + 1
  where id in (select id from public.push_deliveries
    where sent_at is null and attempts < 8 and available_at <= now()
      and (lease_until is null or lease_until < now())
    order by created_at for update skip locked limit 20)
  returning *;
$$;
revoke all on function public.claim_push_deliveries() from public, anon, authenticated;
grant execute on function public.claim_push_deliveries() to service_role;
commit;

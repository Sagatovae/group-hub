begin;
-- Private queue: visitors cannot read or change delivery state.
create table public.telegram_outbox (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null unique,
  payload jsonb not null,
  next_part integer not null default 0,
  message_ids bigint[] not null default '{}',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
alter table public.telegram_outbox enable row level security;
revoke all on public.telegram_outbox from public, anon, authenticated;
grant all on public.telegram_outbox to service_role;
create function public.enqueue_telegram_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.subject_id is null then
    insert into public.telegram_outbox(material_id,payload) values(new.id,to_jsonb(new));
  end if;
  return new;
end;
$$;
revoke all on function public.enqueue_telegram_announcement() from public, anon, authenticated;
create trigger telegram_announcement_created after insert on public.materials
for each row execute function public.enqueue_telegram_announcement();

create function public.claim_telegram_delivery() returns setof public.telegram_outbox
language sql security definer set search_path = '' as $$
  update public.telegram_outbox set lease_until = now() + interval '3 minutes',
    lease_token = gen_random_uuid(), attempts = attempts + 1
  where id = (select id from public.telegram_outbox
    where sent_at is null and attempts < 12 and available_at <= now()
      and (lease_until is null or lease_until < now())
    order by created_at for update skip locked limit 1)
  returning *;
$$;
revoke all on function public.claim_telegram_delivery() from public, anon, authenticated;
grant execute on function public.claim_telegram_delivery() to service_role;
commit;

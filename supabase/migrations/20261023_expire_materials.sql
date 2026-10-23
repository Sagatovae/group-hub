begin;
alter table public.materials add column delete_after_deadline boolean not null default false
  check (not delete_after_deadline or deadline is not null);
create index materials_expiry_idx on public.materials(deadline) where delete_after_deadline;

-- Keep a durable tombstone with all confirmed Telegram IDs. An in-flight publisher
-- checkpoints its actual result against the old revision and cannot mark this done.
create function public.expire_materials() returns integer
language plpgsql security definer set search_path = '' as $$
declare material public.materials; total integer := 0;
begin
  for material in select m.* from public.materials m
    where m.delete_after_deadline and m.deadline < (now() at time zone 'Europe/Moscow')::date
      and not exists (select 1 from public.sections s where s.id=m.section_id
        and lower(btrim(s.name)) ~ '^(лекци|лекц\.?$|lectures?(\s|$))')
    for update of m skip locked
  loop
    insert into public.telegram_outbox(material_id,payload)
      values(material.id,to_jsonb(material) || jsonb_build_object('expired',true))
    on conflict(material_id) do update set
      legacy_payload = coalesce(public.telegram_outbox.legacy_payload,public.telegram_outbox.payload),
      payload = public.telegram_outbox.payload || to_jsonb(material) || jsonb_build_object('expired',true),
      revision = public.telegram_outbox.revision + 1, sent_at = null,
      attempts = 0, last_error = null, available_at = now();
    delete from public.push_deliveries where material_id=material.id and sent_at is null;
    delete from public.materials where id=material.id;
    total := total + 1;
  end loop;
  return total;
end;
$$;
revoke all on function public.expire_materials() from public,anon,authenticated;
grant execute on function public.expire_materials() to service_role;

-- Expiry cleanup remains retryable even after a long Telegram outage.
create or replace function public.claim_telegram_delivery() returns setof public.telegram_outbox
language sql security definer set search_path = '' as $$
  update public.telegram_outbox set lease_until = now() + interval '3 minutes',
    lease_token = gen_random_uuid(), attempts = attempts + 1
  where id = (select id from public.telegram_outbox
    where sent_at is null and (attempts < 12 or payload->>'expired' = 'true') and available_at <= now()
      and (lease_until is null or lease_until < now())
    order by available_at,created_at for update skip locked limit 1)
  returning *;
$$;

-- Database clock, independent of open browser windows and delivery failures.
select cron.schedule('expire-materials','* * * * *','select public.expire_materials()');
commit;

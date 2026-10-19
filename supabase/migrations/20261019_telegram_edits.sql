begin;
alter table public.telegram_outbox
  add column revision bigint not null default 1,
  add column delivered_parts jsonb,
  add column legacy_payload jsonb;
-- Preserve the payload used by the first publisher to recover existing message IDs.
update public.telegram_outbox set legacy_payload = payload;

create or replace function public.enqueue_telegram_announcement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.subject_id is null then
    if tg_op = 'INSERT' then
      insert into public.telegram_outbox(material_id,payload) values(new.id,to_jsonb(new));
    elsif (new.title,new.body,new.author,new.attachments) is distinct from
          (old.title,old.body,old.author,old.attachments) then
      -- Existing untracked announcements are not backfilled on edit.
      update public.telegram_outbox set payload = to_jsonb(new), revision = revision + 1,
        sent_at = null, attempts = 0, last_error = null, available_at = now()
      where material_id = new.id;
    end if;
  end if;
  return new;
end;
$$;
create trigger telegram_announcement_edited after update on public.materials
for each row execute function public.enqueue_telegram_announcement();

-- Checkpoint actual Telegram state even if an edit arrived while sending.
-- Only mark complete when this is still the latest revision.
create function public.checkpoint_telegram_delivery(
  job_id uuid, token uuid, expected_revision bigint, parts jsonb, complete boolean
) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.telegram_outbox set delivered_parts = parts,
    message_ids = array(select (p->>'messageId')::bigint from jsonb_array_elements(parts) p),
    next_part = jsonb_array_length(parts), attempts = 0, last_error = null,
    sent_at = case when revision = expected_revision and complete then now() else null end,
    available_at = now() + interval '3 seconds', lease_until = null, lease_token = null
  where id = job_id and lease_token = token;
  if not found then raise exception 'Delivery lease expired'; end if;
end;
$$;
revoke all on function public.checkpoint_telegram_delivery(uuid,uuid,bigint,jsonb,boolean) from public, anon, authenticated;
grant execute on function public.checkpoint_telegram_delivery(uuid,uuid,bigint,jsonb,boolean) to service_role;
commit;

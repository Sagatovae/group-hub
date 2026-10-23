-- Rollback-only integration check: no test posts can reach either worker.
begin;
do $$
declare
  expired_id uuid := gen_random_uuid(); today_id uuid := gen_random_uuid();
  keep_id uuid := gen_random_uuid(); lecture_id uuid := gen_random_uuid();
  subject_id uuid := gen_random_uuid(); section_id uuid := gen_random_uuid();
  job_id uuid; lease uuid := gen_random_uuid(); old_revision bigint;
  actual public.telegram_outbox;
  today date := (now() at time zone 'Europe/Moscow')::date;
begin
  insert into public.subjects(id,name,teacher,semester,color,position)
    values(subject_id,'Проверка автоудаления','','1','sage',999);
  insert into public.sections(id,subject_id,name,position) values(section_id,subject_id,'Лекции',999);
  insert into public.materials(id,title,deadline,delete_after_deadline) values
    (expired_id,'Проверка — просрочено',today-1,true),
    (today_id,'Проверка — сегодня',today,true),
    (keep_id,'Проверка — без галочки',today-1,false);
  insert into public.materials(id,title,subject_id,section_id,deadline,delete_after_deadline)
    values(lecture_id,'Проверка — лекция',subject_id,section_id,today-1,true);
  update public.telegram_outbox set lease_token=lease,lease_until=now()+interval '3 minutes',
    delivered_parts='[{"key":"text:0","kind":"text","text":"Проверка","messageId":123}]'::jsonb,
    message_ids=array[123::bigint]
    where material_id=expired_id returning id,revision into job_id,old_revision;
  perform public.expire_materials();
  if exists(select 1 from public.materials where id=expired_id) then raise exception 'Expired row remains'; end if;
  if (select count(*) from public.materials where id in(today_id,keep_id,lecture_id)) <> 3 then
    raise exception 'Today, unchecked or lecture row was removed'; end if;
  select * into actual from public.telegram_outbox where id=job_id;
  if actual.payload->>'expired' <> 'true' or actual.message_ids <> array[123::bigint] then
    raise exception 'Missing tombstone or Telegram IDs'; end if;
  if exists(select 1 from public.push_deliveries where material_id=expired_id and sent_at is null) then
    raise exception 'Expired push jobs remain'; end if;
  -- An API response from a publisher started before expiry must retain its IDs,
  -- but may not complete the newer deletion revision.
  perform public.checkpoint_telegram_delivery(job_id,lease,old_revision,
    '[{"key":"text:0","kind":"text","text":"Проверка","messageId":124}]'::jsonb,true);
  select * into actual from public.telegram_outbox where id=job_id;
  if actual.sent_at is not null or actual.message_ids <> array[124::bigint] then
    raise exception 'In-flight publisher lost IDs or completed expired revision'; end if;
  if not exists(select 1 from cron.job where jobname='expire-materials' and active) then
    raise exception 'Expiry schedule is missing'; end if;
end;
$$;
rollback;
select 'OK: expiry, whole deadline day, unchecked blocks, lectures, Telegram IDs, in-flight revision, push cancellation and cron; fixtures rolled back' as verification;

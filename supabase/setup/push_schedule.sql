do $$
declare existing bigint;
begin
  select jobid into existing from cron.job where jobname = 'push-notifications';
  if existing is not null then perform cron.unschedule(existing); end if;
end;
$$;
select cron.schedule('push-notifications','* * * * *', $job$
  select net.http_post(
    url := 'https://tqmzpwzjpoppbxvavuwn.supabase.co/functions/v1/push-notifications',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-dispatch-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'telegram_dispatch_secret' limit 1)),
    body := '{}'::jsonb, timeout_milliseconds := 60000
  );
$job$);

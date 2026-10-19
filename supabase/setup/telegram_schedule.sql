-- Run AFTER deploying the function and creating the telegram_dispatch_secret in Vault.
-- Store the same value as TELEGRAM_DISPATCH_SECRET in Edge Function Secrets.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
declare existing bigint;
begin
  select jobid into existing from cron.job where jobname = 'telegram-publisher';
  if existing is not null then perform cron.unschedule(existing); end if;
end;
$$;
select cron.schedule(
  'telegram-publisher',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://tqmzpwzjpoppbxvavuwn.supabase.co/functions/v1/telegram-publisher',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-dispatch-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'telegram_dispatch_secret' limit 1)
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);

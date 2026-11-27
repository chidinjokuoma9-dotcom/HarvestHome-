create extension if not exists pg_cron with schema pg_catalog;
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'partner-store-subscription-notices-hourly') then
    perform cron.schedule(
      'partner-store-subscription-notices-hourly',
      '15 * * * *',
      'select public.notify_partner_store_subscription_events();'
    );
  end if;
end;
$$;

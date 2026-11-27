-- Annual Partner Store subscription. This applies only to the public Partner Storefront display;
-- it does not change marketplace listing publication, free listing cooldowns, or paid listing services.

alter table public.payments
  add column if not exists partner_store_id uuid references public.partner_storefronts(id) on delete set null;

create index if not exists payments_partner_store_idx on public.payments(partner_store_id);

create table if not exists public.partner_store_subscriptions (
  id uuid primary key default gen_random_uuid(),
  storefront_id uuid not null references public.partner_storefronts(id) on delete restrict,
  seller_id uuid not null references public.profiles(id) on delete restrict,
  payment_id uuid not null unique references public.payments(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'active' check (status in ('active','expired','cancelled')),
  reminder_30_sent_at timestamptz,
  reminder_7_sent_at timestamptz,
  expired_notice_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_store_subscription_dates check (ends_at > starts_at)
);

create index if not exists partner_store_subscriptions_store_end_idx
  on public.partner_store_subscriptions(storefront_id, ends_at desc);
create index if not exists partner_store_subscriptions_seller_idx
  on public.partner_store_subscriptions(seller_id);

alter table public.partner_store_subscriptions enable row level security;

drop policy if exists partner_store_subscriptions_read_owner_staff on public.partner_store_subscriptions;
create policy partner_store_subscriptions_read_owner_staff
  on public.partner_store_subscriptions for select to authenticated
  using (seller_id = (select auth.uid()) or public.is_staff());

revoke all on public.partner_store_subscriptions from anon, authenticated;
grant select on public.partner_store_subscriptions to authenticated;

-- Idempotent reminder routine. If pg_cron is enabled, schedule it hourly below.
create or replace function public.notify_partner_store_subscription_events()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select s.id, s.seller_id, s.storefront_id, s.ends_at,
           f.business_name,
           case
             when s.ends_at <= now() and s.expired_notice_sent_at is null then 'expired'
             when s.ends_at > now() and s.ends_at <= now() + interval '7 days' and s.reminder_7_sent_at is null then '7_days'
             when s.ends_at > now() + interval '7 days' and s.ends_at <= now() + interval '30 days' and s.reminder_30_sent_at is null then '30_days'
           end as notice_type
    from public.partner_store_subscriptions s
    join public.partner_storefronts f on f.id = s.storefront_id
    where s.status = 'active'
      and (
        (s.ends_at <= now() and s.expired_notice_sent_at is null)
        or (s.ends_at > now() and s.ends_at <= now() + interval '7 days' and s.reminder_7_sent_at is null)
        or (s.ends_at > now() + interval '7 days' and s.ends_at <= now() + interval '30 days' and s.reminder_30_sent_at is null)
      )
    order by s.ends_at
    for update of s skip locked
  loop
    if r.notice_type = 'expired' then
      insert into public.notifications(user_id,type,title,message)
      values (r.seller_id,'partner_store_expired','Partner Store subscription expired',
        'Your Partner Store subscription for '||r.business_name||' has expired. Renew for ₦15,000 to restore listings on your public Partner Store. Your ordinary marketplace listings are not affected.');
      update public.partner_store_subscriptions set status='expired', expired_notice_sent_at=now(), updated_at=now() where id=r.id;
    elsif r.notice_type = '7_days' then
      insert into public.notifications(user_id,type,title,message)
      values (r.seller_id,'partner_store_renewal','Partner Store renewal due in 7 days',
        'Your Partner Store subscription for '||r.business_name||' expires on '||to_char(r.ends_at at time zone 'Africa/Lagos','DD Mon YYYY')||'. Renew for ₦15,000 to keep your Partner Store listings visible.');
      update public.partner_store_subscriptions set reminder_7_sent_at=now(), updated_at=now() where id=r.id;
    elsif r.notice_type = '30_days' then
      insert into public.notifications(user_id,type,title,message)
      values (r.seller_id,'partner_store_renewal','Partner Store renewal due in 30 days',
        'Your Partner Store subscription for '||r.business_name||' expires on '||to_char(r.ends_at at time zone 'Africa/Lagos','DD Mon YYYY')||'. Renew for ₦15,000 to keep your Partner Store listings visible.');
      update public.partner_store_subscriptions set reminder_30_sent_at=now(), updated_at=now() where id=r.id;
    end if;
  end loop;
end;
$$;

revoke all on function public.notify_partner_store_subscription_events() from public, anon, authenticated;
grant execute on function public.notify_partner_store_subscription_events() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'partner-store-subscription-notices-hourly') then
      perform cron.schedule(
        'partner-store-subscription-notices-hourly',
        '15 * * * *',
        'select public.notify_partner_store_subscription_events();'
      );
    end if;
  end if;
exception when undefined_table or undefined_function then
  raise notice 'pg_cron is not available; reminder function is installed but must be scheduled in Supabase.';
end;
$$;

-- HarvestHome Reward Completion & Security Fix
-- Run this once in Supabase SQL Editor after the existing V9 reward SQL
-- and HarvestHome_Launch_Rewards.sql.

-- 1) One-time participation award for each listing.
create table if not exists public.listing_participation_awards (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  awarded_at timestamptz not null default now()
);

alter table public.listing_participation_awards enable row level security;

drop policy if exists "admins can view listing participation awards" on public.listing_participation_awards;
create policy "admins can view listing participation awards"
on public.listing_participation_awards for select
to authenticated
using (
  exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role in ('Admin','Moderator')
  )
);

-- 2) Secure listing-created participation reward.
-- A seller can earn this only once for their own listing.
create or replace function public.award_listing_creation_reward(p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.seller_rewards;
  v_seller_id uuid;
  v_inserted integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Not allowed';
  end if;

  select l.seller_id
    into v_seller_id
  from public.listings l
  where l.id = p_listing_id
    and l.seller_id = (select auth.uid())
    and l.status <> 'deleted'
  for update;

  if v_seller_id is null then
    raise exception 'Listing not found or not owned by you';
  end if;

  insert into public.listing_participation_awards(listing_id, seller_id)
  values (p_listing_id, v_seller_id)
  on conflict (listing_id) do nothing;

  get diagnostics v_inserted = row_count;

  insert into public.seller_rewards(user_id)
  values (v_seller_id)
  on conflict (user_id) do nothing;

  if v_inserted > 0 then
    update public.seller_rewards
    set points = points + 10,
        participation_points = participation_points + 10,
        updated_at = now()
    where user_id = v_seller_id;
  end if;

  select *
    into r
  from public.seller_rewards
  where user_id = v_seller_id;

  return r;
end;
$$;

revoke execute on function public.award_listing_creation_reward(uuid) from public, anon;
grant execute on function public.award_listing_creation_reward(uuid) to authenticated;

-- 3) Remove the old generic points endpoint.
-- It allowed a caller to choose an arbitrary positive point amount.
revoke execute on function public.award_participation_points(uuid, integer, text) from public, anon, authenticated;

-- 4) Harden seller recommendation rewards.
create or replace function public.recommend_seller(
  p_seller_id uuid,
  p_listing_id uuid
)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.seller_rewards;
  v_inserted integer;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in';
  end if;

  if (select auth.uid()) = p_seller_id then
    raise exception 'You cannot recommend yourself';
  end if;

  if not exists (
    select 1
    from public.listings l
    where l.id = p_listing_id
      and l.seller_id = p_seller_id
      and l.status = 'approved'
  ) then
    raise exception 'Listing is not an approved listing for this seller';
  end if;

  insert into public.seller_recommendations(seller_id, buyer_id, listing_id)
  values (p_seller_id, (select auth.uid()), p_listing_id)
  on conflict (seller_id, buyer_id, listing_id) do nothing;

  get diagnostics v_inserted = row_count;

  insert into public.seller_rewards(user_id)
  values (p_seller_id)
  on conflict (user_id) do nothing;

  if v_inserted > 0 then
    update public.seller_rewards
    set points = points + 5,
        recommendation_points = recommendation_points + 5,
        recommendation_count = recommendation_count + 1,
        updated_at = now()
    where user_id = p_seller_id;
  end if;

  select *
    into r
  from public.seller_rewards
  where user_id = p_seller_id;

  return r;
end;
$$;

revoke execute on function public.recommend_seller(uuid, uuid) from public, anon;
grant execute on function public.recommend_seller(uuid, uuid) to authenticated;

-- 5) Harden unique-buyer referral rewards.
create or replace function public.record_buyer_referral(
  p_seller_id uuid,
  p_buyer_id uuid,
  p_listing_id uuid
)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.seller_rewards;
  v_inserted integer;
begin
  if (select auth.uid()) is null or (select auth.uid()) <> p_buyer_id then
    raise exception 'Not allowed';
  end if;

  if p_buyer_id = p_seller_id then
    raise exception 'You cannot refer yourself';
  end if;

  if not exists (
    select 1
    from public.listings l
    where l.id = p_listing_id
      and l.seller_id = p_seller_id
      and l.status = 'approved'
  ) then
    raise exception 'Listing is not an approved listing for this seller';
  end if;

  insert into public.seller_buyer_referrals(seller_id, buyer_id, first_listing_id)
  values (p_seller_id, p_buyer_id, p_listing_id)
  on conflict (seller_id, buyer_id) do nothing;

  get diagnostics v_inserted = row_count;

  insert into public.seller_rewards(user_id)
  values (p_seller_id)
  on conflict (user_id) do nothing;

  if v_inserted > 0 then
    update public.seller_rewards
    set points = points + 10,
        buyer_referral_points = buyer_referral_points + 10,
        buyer_count = buyer_count + 1,
        updated_at = now()
    where user_id = p_seller_id;
  end if;

  select *
    into r
  from public.seller_rewards
  where user_id = p_seller_id;

  return r;
end;
$$;

revoke execute on function public.record_buyer_referral(uuid, uuid, uuid) from public, anon;
grant execute on function public.record_buyer_referral(uuid, uuid, uuid) to authenticated;

-- Reward rules after this fix:
-- Listing created: +10 participation points (once per listing).
-- Listing approved: +10 participation points (once per listing).
-- Buyer recommendation: +5 recommendation points to the seller (once per buyer/listing).
-- New unique buyer contacting seller: +10 buyer-referral points (once per buyer/seller).

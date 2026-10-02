-- HarvestHome Free 24-Hour Publication + Featured Duration Plans
-- Run this ONCE in the Supabase SQL Editor.
-- This migration preserves existing paid/legacy listings and adds free publication as the new default.

alter table public.listings
  add column if not exists publication_plan text,
  add column if not exists publish_expires_at timestamptz;

-- Existing listings were created under the previous paid-approval model.
-- Keep them from unexpectedly becoming 24-hour listings.
update public.listings
set publication_plan='legacy_paid'
where publication_plan is null;

alter table public.listings
  alter column publication_plan set default 'free';

create index if not exists listings_publication_expiry_idx
  on public.listings(publication_plan, publish_expires_at);

-- Public users can see approved listings only while a free publication is active.
-- Paid/legacy listings have no 24-hour expiry.
drop policy if exists listings_public_approved on public.listings;
create policy listings_public_approved
on public.listings
for select
using (
  (
    status='approved'
    and (
      coalesce(publication_plan,'legacy_paid') <> 'free'
      or publish_expires_at is null
      or publish_expires_at > now()
    )
  )
  or seller_id=auth.uid()
  or public.is_staff()
);

-- Keep seller-profile visibility aligned with publicly active listings.
drop policy if exists profiles_read_listing_sellers on public.profiles;
create policy profiles_read_listing_sellers
on public.profiles
for select
using (
  exists (
    select 1
    from public.listings l
    where l.seller_id=public.profiles.id
      and l.status='approved'
      and (
        coalesce(l.publication_plan,'legacy_paid') <> 'free'
        or l.publish_expires_at is null
        or l.publish_expires_at > now()
      )
  )
);

-- Approve a listing:
-- * new free listings are approved without a listing-payment requirement;
-- * legacy/paid plans still require a successful payment linked to that exact listing.
create or replace function public.approve_paid_listing(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid;
  v_title text;
  v_plan text;
  v_payment_id uuid;
  v_expires timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id=auth.uid()
      and p.role in ('Admin','Moderator')
  ) then
    raise exception 'Not allowed';
  end if;

  select seller_id,title,coalesce(publication_plan,'legacy_paid')
    into v_seller_id,v_title,v_plan
  from public.listings
  where id=p_listing_id
  for update;

  if v_seller_id is null then
    raise exception 'Listing not found';
  end if;

  if v_plan='free' then
    v_expires:=now()+interval '24 hours';
    update public.listings
      set status='approved',
          publish_expires_at=v_expires,
          updated_at=now()
    where id=p_listing_id;

    return jsonb_build_object(
      'approved',true,
      'payment_found',false,
      'publication_plan','free',
      'expires_at',v_expires,
      'listing_id',p_listing_id,
      'title',v_title
    );
  end if;

  select id into v_payment_id
  from public.payments
  where listing_id=p_listing_id
    and status='success'
  order by created_at desc
  limit 1;

  if v_payment_id is null then
    return jsonb_build_object(
      'approved',false,
      'payment_found',false,
      'listing_id',p_listing_id,
      'title',v_title
    );
  end if;

  update public.listings
    set status='approved',
        publish_expires_at=null,
        updated_at=now()
  where id=p_listing_id;

  return jsonb_build_object(
    'approved',true,
    'payment_found',true,
    'publication_plan',v_plan,
    'listing_id',p_listing_id,
    'title',v_title
  );
end;
$$;

grant execute on function public.approve_paid_listing(uuid) to authenticated;

-- Keep the reward programme from counting free 24-hour listings.
-- These checks apply even if a client tries to call reward functions directly.

create or replace function public.award_listing_creation_reward(p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.seller_rewards;
  v_seller_id uuid;
  v_plan text;
  v_inserted integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Not allowed';
  end if;

  select l.seller_id,coalesce(l.publication_plan,'legacy_paid')
    into v_seller_id,v_plan
  from public.listings l
  where l.id=p_listing_id
    and l.seller_id=(select auth.uid())
    and l.status<>'deleted';

  if v_seller_id is null then
    raise exception 'Listing not found or not owned by you';
  end if;

  insert into public.seller_rewards(user_id)
  values(v_seller_id)
  on conflict(user_id) do nothing;

  select * into r from public.seller_rewards where user_id=v_seller_id;

  if v_plan='free' then
    return r;
  end if;

  insert into public.listing_participation_awards(listing_id,seller_id)
  values(p_listing_id,v_seller_id)
  on conflict(listing_id) do nothing;

  get diagnostics v_inserted=row_count;

  if v_inserted>0 then
    update public.seller_rewards
    set points=points+10,
        participation_points=participation_points+10,
        updated_at=now()
    where user_id=v_seller_id
    returning * into r;
  end if;

  return r;
end;
$$;

revoke execute on function public.award_listing_creation_reward(uuid) from public,anon;
grant execute on function public.award_listing_creation_reward(uuid) to authenticated;

create or replace function public.award_listing_approval_reward(p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.seller_rewards;
  seller_id_value uuid;
  v_plan text;
  inserted_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id=auth.uid() and p.role in ('Admin','Moderator')
  ) then
    raise exception 'Not allowed';
  end if;

  select seller_id,coalesce(publication_plan,'legacy_paid')
    into seller_id_value,v_plan
  from public.listings
  where id=p_listing_id and status='approved';

  if seller_id_value is null then
    raise exception 'Approved listing not found';
  end if;

  insert into public.seller_rewards(user_id)
  values(seller_id_value)
  on conflict(user_id) do nothing;

  select * into r from public.seller_rewards where user_id=seller_id_value;

  if v_plan='free' then
    return r;
  end if;

  insert into public.listing_reward_awards(listing_id)
  values(p_listing_id)
  on conflict(listing_id) do nothing;

  get diagnostics inserted_count=row_count;

  if inserted_count>0 then
    update public.seller_rewards
    set points=points+10,
        participation_points=participation_points+10,
        updated_at=now()
    where user_id=seller_id_value
    returning * into r;
  end if;

  return r;
end;
$$;

grant execute on function public.award_listing_approval_reward(uuid) to authenticated;

-- Free listings must not generate recommendation or unique-buyer reward points.
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
  v_plan text;
begin
  if (select auth.uid()) is null then
    raise exception 'You must be logged in';
  end if;
  if (select auth.uid())=p_seller_id then
    raise exception 'You cannot recommend yourself';
  end if;

  select coalesce(l.publication_plan,'legacy_paid') into v_plan
  from public.listings l
  where l.id=p_listing_id
    and l.seller_id=p_seller_id
    and l.status='approved';

  if v_plan is null then
    raise exception 'Listing is not an approved listing for this seller';
  end if;

  insert into public.seller_rewards(user_id)
  values(p_seller_id)
  on conflict(user_id) do nothing;

  select * into r from public.seller_rewards where user_id=p_seller_id;

  if v_plan='free' then
    return r;
  end if;

  insert into public.seller_recommendations(seller_id,buyer_id,listing_id)
  values(p_seller_id,(select auth.uid()),p_listing_id)
  on conflict(seller_id,buyer_id,listing_id) do nothing;

  get diagnostics v_inserted=row_count;

  if v_inserted>0 then
    update public.seller_rewards
    set points=points+5,
        recommendation_points=recommendation_points+5,
        recommendation_count=recommendation_count+1,
        updated_at=now()
    where user_id=p_seller_id
    returning * into r;
  end if;

  return r;
end;
$$;

revoke execute on function public.recommend_seller(uuid,uuid) from public,anon;
grant execute on function public.recommend_seller(uuid,uuid) to authenticated;

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
  v_plan text;
begin
  if (select auth.uid()) is null or (select auth.uid())<>p_buyer_id then
    raise exception 'Not allowed';
  end if;
  if p_buyer_id=p_seller_id then
    raise exception 'You cannot refer yourself';
  end if;

  select coalesce(l.publication_plan,'legacy_paid') into v_plan
  from public.listings l
  where l.id=p_listing_id
    and l.seller_id=p_seller_id
    and l.status='approved';

  if v_plan is null then
    raise exception 'Listing is not an approved listing for this seller';
  end if;

  insert into public.seller_rewards(user_id)
  values(p_seller_id)
  on conflict(user_id) do nothing;

  select * into r from public.seller_rewards where user_id=p_seller_id;

  if v_plan='free' then
    return r;
  end if;

  insert into public.seller_buyer_referrals(seller_id,buyer_id,first_listing_id)
  values(p_seller_id,p_buyer_id,p_listing_id)
  on conflict(seller_id,buyer_id) do nothing;

  get diagnostics v_inserted=row_count;

  if v_inserted>0 then
    update public.seller_rewards
    set points=points+10,
        buyer_referral_points=buyer_referral_points+10,
        buyer_count=buyer_count+1,
        updated_at=now()
    where user_id=p_seller_id
    returning * into r;
  end if;

  return r;
end;
$$;

revoke execute on function public.record_buyer_referral(uuid,uuid,uuid) from public,anon;
grant execute on function public.record_buyer_referral(uuid,uuid,uuid) to authenticated;

-- Track one-time activation so refreshing payment-success cannot extend the same promotion.
alter table public.payments add column if not exists activated_at timestamptz;

-- Featured promotion activation:
-- 7 days ₦2,000, 14 days ₦4,000, 1 month (30 days) ₦8,000.
-- The old 'featured' service remains accepted as a 7-day legacy alias.
create or replace function public.activate_paid_featured_payment(p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_days integer;
  v_plan text;
  v_ends timestamptz;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select * into v_payment
  from public.payments
  where reference=p_reference
    and user_id=auth.uid()
    and status='success'
  for update;

  if v_payment.id is null then
    raise exception 'Successful Featured payment not found';
  end if;

  if v_payment.activated_at is not null then
    return jsonb_build_object(
      'already_activated',true,
      'reference',p_reference,
      'service',v_payment.service
    );
  end if;

  v_days:=case
    when v_payment.service in ('featured','featured_7') and v_payment.amount=200000 then 7
    when v_payment.service='featured_14' and v_payment.amount=400000 then 14
    when v_payment.service='featured_30' and v_payment.amount=800000 then 30
    else null
  end;

  if v_days is null then
    raise exception 'Invalid Featured payment plan';
  end if;

  if v_payment.listing_id is null then
    raise exception 'Featured payment is missing its listing reference';
  end if;

  if not exists (
    select 1 from public.listings l
    where l.id=v_payment.listing_id
      and l.seller_id=auth.uid()
      and l.status<>'deleted'
  ) then
    raise exception 'Listing is not available for this Featured payment';
  end if;

  v_plan:='featured_'||v_days;

  -- Paying for Featured converts the listing away from the free 24-hour plan.
  update public.listings
  set publication_plan=v_plan,
      publish_expires_at=null,
      updated_at=now()
  where id=v_payment.listing_id;

  update public.payments
  set activated_at=now()
  where id=v_payment.id;

  if not exists (
    select 1 from public.listings where id=v_payment.listing_id and status='approved'
  ) then
    return jsonb_build_object(
      'activated',false,
      'pending_approval',true,
      'reference',p_reference,
      'service',v_payment.service,
      'days',v_days
    );
  end if;

  v_ends:=now()+make_interval(days=>v_days);

  insert into public.featured_listings(listing_id,starts_at,ends_at,created_by)
  values(v_payment.listing_id,now(),v_ends,auth.uid())
  on conflict(listing_id) do update
    set starts_at=now(),
        ends_at=excluded.ends_at,
        created_by=auth.uid();

  return jsonb_build_object(
    'activated',true,
    'already_activated',false,
    'reference',p_reference,
    'service',v_payment.service,
    'days',v_days,
    'ends_at',v_ends
  );
end;
$$;

grant execute on function public.activate_paid_featured_payment(text) to authenticated;

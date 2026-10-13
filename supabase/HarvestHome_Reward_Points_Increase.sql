-- HarvestHome reward-point increase (2026-10)
-- Doubles points for eligible paid/legacy-paid listing activities.
-- Explicitly preserves the free-listing exclusion and anti-abuse/idempotency checks.
-- Reward qualification thresholds are intentionally unchanged.

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
  select seller_id, coalesce(publication_plan,'legacy_paid')
    into seller_id_value, v_plan
  from public.listings where id=p_listing_id and status='approved';
  if seller_id_value is null then raise exception 'Approved listing not found'; end if;
  insert into public.seller_rewards(user_id) values(seller_id_value) on conflict(user_id) do nothing;
  select * into r from public.seller_rewards where user_id=seller_id_value;
  if v_plan='free' then return r; end if;
  insert into public.listing_reward_awards(listing_id) values(p_listing_id) on conflict(listing_id) do nothing;
  get diagnostics inserted_count=row_count;
  if inserted_count>0 then
    update public.seller_rewards set points=points+20, participation_points=participation_points+20, updated_at=now()
    where user_id=seller_id_value returning * into r;
  end if;
  return r;
end;
$$;

create or replace function public.award_listing_creation_reward(p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.seller_rewards; v_seller_id uuid; v_plan text; v_inserted integer;
begin
  if (select auth.uid()) is null then raise exception 'Not allowed'; end if;
  select l.seller_id, coalesce(l.publication_plan,'legacy_paid') into v_seller_id,v_plan
  from public.listings l where l.id=p_listing_id and l.seller_id=(select auth.uid()) and l.status<>'deleted';
  if v_seller_id is null then raise exception 'Listing not found or not owned by you'; end if;
  insert into public.seller_rewards(user_id) values(v_seller_id) on conflict(user_id) do nothing;
  select * into r from public.seller_rewards where user_id=v_seller_id;
  if v_plan='free' then return r; end if;
  insert into public.listing_participation_awards(listing_id,seller_id) values(p_listing_id,v_seller_id) on conflict(listing_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted>0 then
    update public.seller_rewards set points=points+20, participation_points=participation_points+20, updated_at=now()
    where user_id=v_seller_id returning * into r;
  end if;
  return r;
end;
$$;

create or replace function public.recommend_seller(p_seller_id uuid, p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.seller_rewards; v_inserted integer; v_plan text;
begin
  if (select auth.uid()) is null then raise exception 'You must be logged in'; end if;
  if (select auth.uid())=p_seller_id then raise exception 'You cannot recommend yourself'; end if;
  select coalesce(l.publication_plan,'legacy_paid') into v_plan
  from public.listings l where l.id=p_listing_id and l.seller_id=p_seller_id and l.status='approved';
  if v_plan is null then raise exception 'Listing is not an approved listing for this seller'; end if;
  insert into public.seller_rewards(user_id) values(p_seller_id) on conflict(user_id) do nothing;
  select * into r from public.seller_rewards where user_id=p_seller_id;
  if v_plan='free' then return r; end if;
  insert into public.seller_recommendations(seller_id,buyer_id,listing_id)
  values(p_seller_id,(select auth.uid()),p_listing_id) on conflict(seller_id,buyer_id,listing_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted>0 then
    update public.seller_rewards set points=points+10, recommendation_points=recommendation_points+10,
      recommendation_count=recommendation_count+1, updated_at=now()
    where user_id=p_seller_id returning * into r;
  end if;
  return r;
end;
$$;

create or replace function public.record_buyer_referral(p_seller_id uuid, p_buyer_id uuid, p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.seller_rewards; v_inserted integer; v_plan text;
begin
  if (select auth.uid()) is null or (select auth.uid())<>p_buyer_id then raise exception 'Not allowed'; end if;
  if p_buyer_id=p_seller_id then raise exception 'You cannot refer yourself'; end if;
  select coalesce(l.publication_plan,'legacy_paid') into v_plan
  from public.listings l where l.id=p_listing_id and l.seller_id=p_seller_id and l.status='approved';
  if v_plan is null then raise exception 'Listing is not an approved listing for this seller'; end if;
  insert into public.seller_rewards(user_id) values(p_seller_id) on conflict(user_id) do nothing;
  select * into r from public.seller_rewards where user_id=p_seller_id;
  if v_plan='free' then return r; end if;
  insert into public.seller_buyer_referrals(seller_id,buyer_id,first_listing_id)
  values(p_seller_id,p_buyer_id,p_listing_id) on conflict(seller_id,buyer_id) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted>0 then
    update public.seller_rewards set points=points+20, buyer_referral_points=buyer_referral_points+20,
      buyer_count=buyer_count+1, updated_at=now()
    where user_id=p_seller_id returning * into r;
  end if;
  return r;
end;
$$;

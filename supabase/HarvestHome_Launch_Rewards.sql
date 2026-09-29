-- HarvestHome launch reward automation
-- Run once in Supabase SQL Editor AFTER the existing HarvestHome V9 reward SQL.

-- 1) Prevent the same approved listing from giving the seller the approval reward twice.
create table if not exists public.listing_reward_awards (
  listing_id uuid primary key references public.listings(id) on delete cascade,
  awarded_at timestamptz not null default now()
);

alter table public.listing_reward_awards enable row level security;

drop policy if exists "admins can view listing reward awards" on public.listing_reward_awards;
create policy "admins can view listing reward awards"
on public.listing_reward_awards for select
to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('Admin','Moderator')
  )
);

-- 2) Give 10 participation points when a moderator approves a seller listing.
create or replace function public.award_listing_approval_reward(p_listing_id uuid)
returns public.seller_rewards
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.seller_rewards;
  seller_id_value uuid;
  inserted_count integer;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('Admin','Moderator')
  ) then
    raise exception 'Not allowed';
  end if;

  select seller_id into seller_id_value
  from public.listings
  where id = p_listing_id and status = 'approved';

  if seller_id_value is null then
    raise exception 'Approved listing not found';
  end if;

  insert into public.listing_reward_awards(listing_id)
  values (p_listing_id)
  on conflict (listing_id) do nothing;

  get diagnostics inserted_count = row_count;

  if inserted_count = 0 then
    select * into r from public.seller_rewards where user_id = seller_id_value;
    if r.user_id is null then
      insert into public.seller_rewards(user_id) values (seller_id_value) returning * into r;
    end if;
    return r;
  end if;

  insert into public.seller_rewards(
    user_id, points, participation_points, updated_at
  )
  values (seller_id_value, 10, 10, now())
  on conflict (user_id) do update set
    points = seller_rewards.points + 10,
    participation_points = seller_rewards.participation_points + 10,
    updated_at = now()
  returning * into r;

  return r;
end;
$$;

grant execute on function public.award_listing_approval_reward(uuid) to authenticated;

-- 3) Let Admin/Moderator see automatic reward qualification.
create or replace function public.get_reward_eligibility()
returns table (
  user_id uuid,
  full_name text,
  email text,
  points integer,
  participation_points integer,
  recommendation_points integer,
  buyer_referral_points integer,
  buyer_count integer,
  recommendation_count integer,
  reward_status text,
  reward_tier text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('Admin','Moderator')
  ) then
    raise exception 'Not allowed';
  end if;

  return query
  select
    sr.user_id,
    coalesce(p.full_name, u.email)::text,
    u.email::text,
    sr.points,
    sr.participation_points,
    sr.recommendation_points,
    sr.buyer_referral_points,
    sr.buyer_count,
    sr.recommendation_count,
    case
      when sr.points >= 50 or sr.buyer_count >= 5 then 'Qualified'
      else 'Building'
    end::text,
    case
      when sr.points >= 100 or sr.buyer_count >= 10 then 'Gold'
      when sr.points >= 50 or sr.buyer_count >= 5 then 'Reward'
      else 'Standard'
    end::text
  from public.seller_rewards sr
  join auth.users u on u.id = sr.user_id
  left join public.profiles p on p.id = sr.user_id
  where coalesce(p.role,'Seller') not in ('Admin','Moderator')
  order by
    case when sr.points >= 100 or sr.buyer_count >= 10 then 0
         when sr.points >= 50 or sr.buyer_count >= 5 then 1
         else 2 end,
    sr.points desc,
    sr.buyer_count desc,
    sr.updated_at desc;
end;
$$;

grant execute on function public.get_reward_eligibility() to authenticated;

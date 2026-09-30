-- HarvestHome Featured Listings V11
-- Run this once in Supabase SQL Editor.
-- Admin/Moderator can feature an APPROVED listing for up to 30 days.
-- This version prepares the promotion system without charging sellers yet.

create table if not exists public.featured_listings (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null unique references public.listings(id) on delete cascade,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists featured_listings_active_idx
  on public.featured_listings (ends_at);

alter table public.featured_listings enable row level security;

drop policy if exists "Public can view active featured listings" on public.featured_listings;
create policy "Public can view active featured listings"
on public.featured_listings
for select
to anon, authenticated
using (ends_at > now());

create or replace function public.set_listing_featured(
  p_listing_id uuid,
  p_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_status text;
  v_ends timestamptz;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('Admin','Moderator') then
    raise exception 'Only an Admin or Moderator can manage featured listings.';
  end if;

  select status into v_status
  from public.listings
  where id = p_listing_id;

  if v_status is null then
    raise exception 'Listing not found.';
  end if;

  if p_days <= 0 then
    delete from public.featured_listings where listing_id = p_listing_id;
    return jsonb_build_object('featured', false, 'listing_id', p_listing_id);
  end if;

  if v_status <> 'approved' then
    raise exception 'Only approved listings can be featured.';
  end if;

  if p_days > 30 then
    p_days := 30;
  end if;

  v_ends := now() + make_interval(days => p_days);

  insert into public.featured_listings (listing_id, starts_at, ends_at, created_by)
  values (p_listing_id, now(), v_ends, auth.uid())
  on conflict (listing_id) do update
    set starts_at = now(),
        ends_at = excluded.ends_at,
        created_by = auth.uid();

  return jsonb_build_object(
    'featured', true,
    'listing_id', p_listing_id,
    'ends_at', v_ends
  );
end;
$$;

grant execute on function public.set_listing_featured(uuid, integer) to authenticated;

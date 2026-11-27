-- Correct listing visibility for Partner Stores and the main marketplace.
-- Without an active annual Partner Store subscription, all listings follow
-- their normal publication expiry. An active annual subscription covers approved
-- listings on BOTH the Partner Store and main marketplace for its 12-month term.
-- Seller deletion, moderation/status changes, and sold state remain independently controlled.

create or replace function public.get_active_partner_store_listings(p_slug text)
returns table (
  id uuid,
  title text,
  description text,
  price numeric,
  currency text,
  category text,
  mode text,
  country text,
  location text,
  cover_url text,
  video_url text,
  publication_plan text,
  publish_expires_at timestamptz,
  created_at timestamptz,
  media_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id, l.title, l.description, l.price, l.currency, l.category, l.mode,
    l.country, l.location, l.cover_url, l.video_url, l.publication_plan,
    l.publish_expires_at, l.created_at, media.storage_path as media_path
  from public.partner_storefronts f
  join public.listings l
    on l.seller_id = f.seller_id
   and l.status = 'approved'
  left join lateral (
    select lm.storage_path
    from public.listing_media lm
    where lm.listing_id = l.id and lm.media_type = 'image'
    order by lm.created_at asc nulls last
    limit 1
  ) media on true
  where f.slug = p_slug
    and f.is_published = true
    and f.partner_submission_status = 'published'
    and f.removed_at is null
    and (
      (l.publish_expires_at is not null and l.publish_expires_at > now())
      or (
        l.publish_expires_at is null
        and coalesce(l.publication_plan, 'legacy_paid') <> 'free'
      )
      or exists (
        select 1
        from public.partner_store_subscriptions s
        where s.storefront_id = f.id
          and s.seller_id = f.seller_id
          and s.status = 'active'
          and s.starts_at <= now()
          and s.ends_at > now()
      )
    )
  order by l.created_at desc
  limit 60;
$$;

revoke all on function public.get_active_partner_store_listings(text) from public;
grant execute on function public.get_active_partner_store_listings(text) to anon, authenticated;

-- Remove an older permissive SELECT policy that exposed every approved listing,
-- including expired free listings. PostgreSQL combines permissive policies with OR,
-- so leaving it in place would defeat the expiry-aware policy below.
drop policy if exists "harvesthome listings select approved or own" on public.listings;

drop policy if exists "listings_public_approved" on public.listings;
create policy "listings_public_approved"
on public.listings
for select
to anon, authenticated
using (
  (
    status = 'approved'
    and (
      (publish_expires_at is not null and publish_expires_at > now())
      or (
        publish_expires_at is null
        and coalesce(publication_plan, 'legacy_paid') <> 'free'
      )
      or exists (
        select 1
        from public.partner_storefronts f
        join public.partner_store_subscriptions s
          on s.storefront_id = f.id
         and s.seller_id = f.seller_id
         and s.status = 'active'
         and s.starts_at <= now()
         and s.ends_at > now()
        where f.seller_id = listings.seller_id
          and f.is_published = true
          and f.partner_submission_status = 'published'
          and f.removed_at is null
      )
    )
  )
  or seller_id = auth.uid()
  or is_staff()
);

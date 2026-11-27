-- Public Partner Store inventory follows the normal marketplace storefront model:
-- approved listings appear automatically for every published partner store.
-- The annual Partner Store subscription remains separate from ordinary inventory visibility.
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
  order by l.created_at desc
  limit 60;
$$;

revoke all on function public.get_active_partner_store_listings(text) from public;
grant execute on function public.get_active_partner_store_listings(text) to anon, authenticated;

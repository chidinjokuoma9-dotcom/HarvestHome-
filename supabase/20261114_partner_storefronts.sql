-- Partner storefronts are an optional public profile for approved HarvestHome partners.
-- Existing marketplace listings remain in public marketplace/search through the existing listings flow.
create table if not exists public.partner_storefronts (
  id uuid primary key default gen_random_uuid(),
  partnership_application_id uuid not null unique references public.partnership_applications(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  slug text not null unique,
  business_name text not null check (char_length(trim(business_name)) between 2 and 160),
  tagline text not null default '' check (char_length(tagline) <= 180),
  description text not null default '' check (char_length(description) <= 4000),
  country text not null default 'Nigeria' check (char_length(trim(country)) between 2 and 100),
  website text,
  phone text,
  logo_url text,
  cover_url text,
  is_published boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_storefronts_slug_format check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint partner_storefronts_website_length check (website is null or char_length(website) <= 300),
  constraint partner_storefronts_phone_length check (phone is null or char_length(phone) <= 40)
);

create index if not exists partner_storefronts_published_idx
  on public.partner_storefronts(is_published, business_name);
create index if not exists partner_storefronts_seller_idx
  on public.partner_storefronts(seller_id);

alter table public.partner_storefronts enable row level security;

drop policy if exists partner_storefronts_public_read on public.partner_storefronts;
create policy partner_storefronts_public_read on public.partner_storefronts
  for select to anon, authenticated
  using (is_published or seller_id = auth.uid() or private.is_hh_partnership_admin());

drop policy if exists partner_storefronts_staff_insert on public.partner_storefronts;
create policy partner_storefronts_staff_insert on public.partner_storefronts
  for insert to authenticated
  with check (private.is_hh_partnership_admin());

drop policy if exists partner_storefronts_staff_update on public.partner_storefronts;
create policy partner_storefronts_staff_update on public.partner_storefronts
  for update to authenticated
  using (private.is_hh_partnership_admin())
  with check (private.is_hh_partnership_admin());

drop policy if exists partner_storefronts_staff_delete on public.partner_storefronts;
create policy partner_storefronts_staff_delete on public.partner_storefronts
  for delete to authenticated
  using (private.is_hh_partnership_admin());

grant select on public.partner_storefronts to anon, authenticated;
grant insert, update, delete on public.partner_storefronts to authenticated;

create or replace function public.admin_upsert_partner_storefront(
  p_application_id uuid,
  p_seller_email text,
  p_slug text,
  p_business_name text,
  p_tagline text default '',
  p_description text default '',
  p_country text default 'Nigeria',
  p_website text default null,
  p_phone text default null,
  p_logo_url text default null,
  p_cover_url text default null,
  p_is_published boolean default false
)
returns public.partner_storefronts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.partnership_applications%rowtype;
  v_seller_id uuid;
  v_store public.partner_storefronts%rowtype;
  v_slug text;
begin
  if not private.is_hh_partnership_admin() then
    raise exception 'Only authorised HarvestHome staff can manage partner storefronts.';
  end if;

  select * into v_app
  from public.partnership_applications
  where id = p_application_id and status = 'approved' and archived_at is null;

  if not found then
    raise exception 'The partnership application must be approved and active before a storefront can be created.';
  end if;

  select id into v_seller_id
  from auth.users
  where lower(email) = lower(trim(coalesce(p_seller_email, '')))
  limit 1;

  if v_seller_id is null then
    raise exception 'No HarvestHome seller account was found for that email. Ask the partner to create an account first.';
  end if;

  v_slug := lower(trim(coalesce(p_slug, '')));
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Use a simple web address with lowercase letters, numbers and hyphens only.';
  end if;

  if char_length(trim(coalesce(p_business_name, ''))) < 2
     or char_length(trim(coalesce(p_business_name, ''))) > 160 then
    raise exception 'Enter a business name between 2 and 160 characters.';
  end if;

  insert into public.partner_storefronts (
    partnership_application_id, seller_id, slug, business_name, tagline,
    description, country, website, phone, logo_url, cover_url,
    is_published, created_by, updated_at
  ) values (
    p_application_id, v_seller_id, v_slug, trim(p_business_name),
    left(trim(coalesce(p_tagline, '')),180),
    left(trim(coalesce(p_description, '')),4000),
    left(trim(coalesce(p_country, 'Nigeria')),100),
    nullif(trim(coalesce(p_website, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cover_url, '')), ''),
    coalesce(p_is_published, false), auth.uid(), now()
  )
  on conflict (partnership_application_id) do update set
    seller_id = excluded.seller_id,
    slug = excluded.slug,
    business_name = excluded.business_name,
    tagline = excluded.tagline,
    description = excluded.description,
    country = excluded.country,
    website = excluded.website,
    phone = excluded.phone,
    logo_url = excluded.logo_url,
    cover_url = excluded.cover_url,
    is_published = excluded.is_published,
    updated_at = now()
  returning * into v_store;

  return v_store;
end;
$$;

revoke all on function public.admin_upsert_partner_storefront(uuid,text,text,text,text,text,text,text,text,text,text,boolean) from public;
grant execute on function public.admin_upsert_partner_storefront(uuid,text,text,text,text,text,text,text,text,text,text,boolean) to authenticated;

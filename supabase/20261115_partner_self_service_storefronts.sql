-- Partner self-service storefront submission. Existing staff approval remains the only publish path.
alter table public.partner_storefronts
  add column if not exists partner_submission_status text not null default 'not_submitted',
  add column if not exists partner_submitted_at timestamptz;

alter table public.partner_storefronts
  drop constraint if exists partner_storefronts_submission_status_check;
alter table public.partner_storefronts
  add constraint partner_storefronts_submission_status_check
  check (partner_submission_status in ('not_submitted','submitted','published'));

create or replace function public.partner_get_storefront_setup()
returns table (
  application_id uuid,
  organisation_name text,
  contact_name text,
  email text,
  country text,
  website text,
  phone text,
  proposal text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if (select auth.uid()) is null then
    raise exception 'Please sign in to continue.';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception 'Please verify your HarvestHome account email before continuing.';
  end if;

  return query
  select a.id, a.organisation_name, a.contact_name, a.email, a.country,
         a.website, a.phone, a.proposal
  from public.partnership_applications a
  where lower(a.email) = v_email
    and a.status = 'approved'
    and a.archived_at is null
  order by a.created_at desc;
end;
$$;

revoke all on function public.partner_get_storefront_setup() from public, anon;
grant execute on function public.partner_get_storefront_setup() to authenticated;

create or replace function public.partner_submit_storefront_profile(
  p_application_id uuid,
  p_slug text,
  p_business_name text,
  p_tagline text default '',
  p_description text default '',
  p_country text default 'Nigeria',
  p_website text default null,
  p_phone text default null,
  p_logo_url text default null,
  p_cover_url text default null
)
returns public.partner_storefronts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_app public.partnership_applications%rowtype;
  v_store public.partner_storefronts%rowtype;
  v_slug text;
begin
  if (select auth.uid()) is null then
    raise exception 'Please sign in to continue.';
  end if;

  select lower(u.email) into v_email
  from auth.users u
  where u.id = (select auth.uid())
    and u.email_confirmed_at is not null;

  if v_email is null then
    raise exception 'Please verify your HarvestHome account email before continuing.';
  end if;

  select * into v_app
  from public.partnership_applications a
  where a.id = p_application_id
    and lower(a.email) = v_email
    and a.status = 'approved'
    and a.archived_at is null;

  if not found then
    raise exception 'No active approved-for-discussion partnership application matches this account.';
  end if;

  v_slug := lower(trim(coalesce(p_slug, '')));
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Use lowercase letters, numbers and hyphens for your storefront address.';
  end if;

  if char_length(trim(coalesce(p_business_name, ''))) < 2
     or char_length(trim(coalesce(p_business_name, ''))) > 160 then
    raise exception 'Enter a business name between 2 and 160 characters.';
  end if;

  select * into v_store
  from public.partner_storefronts s
  where s.partnership_application_id = p_application_id
  for update;

  if found and v_store.seller_id <> (select auth.uid()) then
    raise exception 'This application is already linked to a different seller account. Please contact HarvestHome.';
  end if;

  if found and v_store.is_published then
    raise exception 'Your storefront is already published. Please contact HarvestHome staff to request profile changes.';
  end if;

  insert into public.partner_storefronts (
    partnership_application_id, seller_id, slug, business_name, tagline,
    description, country, website, phone, logo_url, cover_url,
    is_published, agreement_confirmed, partner_submission_status,
    partner_submitted_at, updated_at
  ) values (
    p_application_id, (select auth.uid()), v_slug, trim(p_business_name),
    left(trim(coalesce(p_tagline, '')),180),
    left(trim(coalesce(p_description, '')),4000),
    left(trim(coalesce(p_country, 'Nigeria')),100),
    nullif(trim(coalesce(p_website, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cover_url, '')), ''),
    false, false, 'submitted', now(), now()
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
    is_published = false,
    agreement_confirmed = false,
    partner_submission_status = 'submitted',
    partner_submitted_at = now(),
    updated_at = now()
  returning * into v_store;

  return v_store;
end;
$$;

revoke all on function public.partner_submit_storefront_profile(uuid,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.partner_submit_storefront_profile(uuid,text,text,text,text,text,text,text,text,text) to authenticated;

-- Keep staff publishing as the sole approval gate.
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
  p_is_published boolean default false,
  p_agreement_confirmed boolean default false
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

  if not coalesce(p_agreement_confirmed, false) then
    raise exception 'A storefront can only be approved after partner checks are complete and a written partnership agreement has been confirmed.';
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
    is_published, agreement_confirmed, agreement_confirmed_by, agreement_confirmed_at,
    created_by, updated_at, partner_submission_status
  ) values (
    p_application_id, v_seller_id, v_slug, trim(p_business_name),
    left(trim(coalesce(p_tagline, '')),180),
    left(trim(coalesce(p_description, '')),4000),
    left(trim(coalesce(p_country, 'Nigeria')),100),
    nullif(trim(coalesce(p_website, '')), ''),
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_logo_url, '')), ''),
    nullif(trim(coalesce(p_cover_url, '')), ''),
    coalesce(p_is_published, false), true, (select auth.uid()), now(), (select auth.uid()), now(),
    case when coalesce(p_is_published, false) then 'published' else 'not_submitted' end
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
    agreement_confirmed = true,
    agreement_confirmed_by = (select auth.uid()),
    agreement_confirmed_at = now(),
    updated_at = now(),
    partner_submission_status = case when excluded.is_published then 'published' else 'not_submitted' end
  returning * into v_store;

  return v_store;
end;
$$;

revoke all on function public.admin_upsert_partner_storefront(uuid,text,text,text,text,text,text,text,text,text,text,boolean,boolean) from public;
grant execute on function public.admin_upsert_partner_storefront(uuid,text,text,text,text,text,text,text,text,text,text,boolean,boolean) to authenticated;

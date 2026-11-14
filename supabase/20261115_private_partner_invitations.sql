-- Private, one-time partner storefront invitations.
alter table public.partner_storefronts
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id) on delete set null,
  add column if not exists removal_reason text;

create index if not exists partner_storefronts_active_published_idx
  on public.partner_storefronts(is_published, removed_at)
  where removed_at is null;

create table if not exists public.partner_storefront_invitations (
  id uuid primary key default gen_random_uuid(),
  partnership_application_id uuid not null references public.partnership_applications(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  locked_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists partner_storefront_invitations_application_idx
  on public.partner_storefront_invitations(partnership_application_id, created_at desc);
create index if not exists partner_storefront_invitations_expiry_idx
  on public.partner_storefront_invitations(expires_at)
  where used_at is null and revoked_at is null;

alter table public.partner_storefront_invitations enable row level security;
revoke all on public.partner_storefront_invitations from anon, authenticated;
grant all on public.partner_storefront_invitations to service_role;

-- Remove the former account-password portal RPCs. Partner access is now by
-- private, expiring invitation link; no partner password is collected.
revoke all on function public.partner_get_storefront_setup() from public, anon, authenticated;
revoke all on function public.partner_submit_storefront_profile(uuid,text,text,text,text,text,text,text,text,text) from public, anon, authenticated;
drop function if exists public.partner_get_storefront_setup();
drop function if exists public.partner_submit_storefront_profile(uuid,text,text,text,text,text,text,text,text,text);

-- Retire direct staff RPC writes. The Edge Function below verifies Admin role
-- and provides the only invitation, publication and removal actions.
revoke all on function public.admin_upsert_partner_storefront(uuid,text,text,text,text,text,text,text,text,text,text,boolean,boolean)
  from public, anon, authenticated;

comment on table public.partner_storefront_invitations is
  'Private one-time partner setup invitations. Access is restricted to the service role through the Admin-verified Edge Function.';
comment on column public.partner_storefronts.removed_at is
  'When an Admin removed the storefront from public partner visibility. This does not delete the partner account or marketplace listings.';

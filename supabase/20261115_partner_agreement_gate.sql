-- Explicit Admin confirmation that the written partnership agreement is signed
-- before a private storefront setup invitation can be issued.
alter table public.partnership_applications
  add column if not exists partnership_agreement_confirmed boolean not null default false,
  add column if not exists partnership_agreement_confirmed_by uuid references auth.users(id) on delete set null,
  add column if not exists partnership_agreement_confirmed_at timestamptz;

comment on column public.partnership_applications.partnership_agreement_confirmed is
  'Admin-confirmed written partnership agreement status. Separate from Approved for discussion.';

-- Partner dashboard correction workflow. Additive only; no marketplace listing/payment tables are changed.
alter table public.partner_storefronts
  add column if not exists partner_correction_note text;

comment on column public.partner_storefronts.partner_correction_note is
  'Admin instructions shown privately to the partner when a storefront correction is requested.';

-- Partner dashboard correction workflow. Additive only; no marketplace listing/payment tables are changed.
alter table public.partner_storefronts
  add column if not exists partner_correction_note text;

comment on column public.partner_storefronts.partner_correction_note is
  'Admin instructions shown privately to the partner when a storefront correction is requested.';

-- Permit the explicit Admin-to-partner correction state used by the dashboard workflow.
alter table public.partner_storefronts drop constraint if exists partner_storefronts_submission_status_check;
alter table public.partner_storefronts add constraint partner_storefronts_submission_status_check
  check (partner_submission_status = any (array['not_submitted','submitted','published','changes_requested']));

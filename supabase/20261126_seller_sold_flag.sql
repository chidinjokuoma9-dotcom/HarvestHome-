-- Add a dedicated sold flag without changing listing moderation status.
-- Existing approved listings remain approved and visible, with a SOLD badge.
alter table public.listings
  add column if not exists is_sold boolean not null default false;

comment on column public.listings.is_sold is
  'Seller-declared sold state. Keeps the listing record and approved moderation status intact.';

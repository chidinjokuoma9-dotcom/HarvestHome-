-- Optional seller phone contact for marketplace listings.
-- A number is only stored on a listing when the seller explicitly opts in to public display.
alter table public.listings
  add column if not exists contact_phone text null;

comment on column public.listings.contact_phone is
  'Seller-provided phone number displayed publicly only when the seller explicitly opts in on the listing form.';

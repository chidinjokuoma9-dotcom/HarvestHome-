-- HarvestHome Final Security Hardening
-- Run this ONCE in Supabase SQL Editor.

create or replace function public.prevent_listing_protected_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    if new.seller_id is distinct from old.seller_id
       or new.status is distinct from old.status
       or new.views is distinct from old.views then
      raise exception 'Protected listing fields cannot be changed by this user';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_listing_fields on public.listings;
create trigger protect_listing_fields
before update on public.listings
for each row execute function public.prevent_listing_protected_change();

revoke execute on function public.prevent_listing_protected_change() from public, anon, authenticated;

drop policy if exists listings_insert_owner on public.listings;
create policy listings_insert_owner on public.listings
for insert
with check (seller_id = auth.uid() and status = 'pending');

drop policy if exists payments_owner_insert on public.payments;
drop policy if exists payments_owner_update on public.payments;

create policy payments_staff_insert on public.payments
for insert to authenticated
with check (public.is_staff());

create policy payments_staff_update on public.payments
for update to authenticated
using (public.is_staff())
with check (public.is_staff());

create or replace function public.prevent_payment_protected_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff() then
    raise exception 'Payment records can only be changed by the payment service';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_payment_fields on public.payments;
create trigger protect_payment_fields
before update on public.payments
for each row execute function public.prevent_payment_protected_change();

revoke execute on function public.prevent_payment_protected_change() from public, anon, authenticated;

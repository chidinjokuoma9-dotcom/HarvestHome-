-- HarvestHome: safely link an existing successful payment to the exact listing it was for
-- Run this once in Supabase SQL Editor.

create or replace function public.link_successful_payment_to_listing(
  p_payment_id uuid,
  p_listing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_listing public.listings%rowtype;
  v_seller_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('Admin','Moderator')
  ) then
    raise exception 'Not allowed';
  end if;

  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if v_payment.id is null then
    raise exception 'Payment not found';
  end if;

  if v_payment.status <> 'success' then
    raise exception 'Only a successful payment can be linked';
  end if;

  if v_payment.listing_id is not null then
    raise exception 'This payment is already linked to a listing';
  end if;

  select * into v_listing
  from public.listings
  where id = p_listing_id
  for update;

  if v_listing.id is null then
    raise exception 'Listing not found';
  end if;

  if v_listing.status = 'deleted' then
    raise exception 'This listing is deleted';
  end if;

  v_seller_id := coalesce(v_payment.seller_id, v_payment.user_id);

  if v_listing.seller_id <> v_seller_id then
    raise exception 'Payment and listing belong to different sellers';
  end if;

  update public.payments
  set listing_id = p_listing_id,
      seller_id = v_listing.seller_id
  where id = p_payment_id;

  return jsonb_build_object(
    'linked', true,
    'payment_id', p_payment_id,
    'listing_id', p_listing_id,
    'reference', v_payment.reference,
    'title', v_listing.title
  );
end;
$$;

grant execute on function public.link_successful_payment_to_listing(uuid, uuid) to authenticated;

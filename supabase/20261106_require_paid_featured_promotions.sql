-- Prevent staff from granting complimentary Featured promotions.
-- Staff may still remove an existing promotion; paid activation remains
-- restricted to the verified Paystack payment flow.

create or replace function public.set_listing_featured(
  p_listing_id uuid,
  p_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id = auth.uid();

  if v_role not in ('Admin','Moderator') then
    raise exception 'Only an Admin or Moderator can manage featured listings.';
  end if;

  if p_days is null or p_days > 0 then
    raise exception 'Paid Featured promotions can only be activated after successful Paystack payment.';
  end if;

  delete from public.featured_listings
  where listing_id = p_listing_id;

  return jsonb_build_object(
    'featured', false,
    'listing_id', p_listing_id
  );
end;
$$;

grant execute on function public.set_listing_featured(uuid, integer) to authenticated;

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

  if coalesce(v_role,'') not in ('Admin','Moderator') then
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

-- Keep the database-side paid activation guard aligned with the current
-- Featured prices configured in paystack-initialize (amounts are kobo).

create or replace function public.activate_paid_featured_payment(p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_days integer;
  v_plan text;
  v_expires timestamptz;
  v_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  v_user_id := auth.uid();

  select * into v_payment
  from public.payments
  where reference = p_reference
    and user_id = v_user_id
    and status = 'success'
  for update;

  if v_payment.id is null then
    raise exception 'Successful Featured payment not found';
  end if;

  v_days := case
    when v_payment.service in ('featured','featured_7') and v_payment.amount = 115000 then 7
    when v_payment.service = 'featured_14' and v_payment.amount = 215000 then 14
    when v_payment.service = 'featured_30' and v_payment.amount = 415000 then 30
    else null
  end;
  if v_days is null then raise exception 'Invalid Featured payment plan'; end if;
  if v_payment.listing_id is null then raise exception 'Featured payment is missing its listing reference'; end if;

  if not exists (
    select 1 from public.listings l
    where l.id = v_payment.listing_id
      and l.seller_id = v_user_id
      and l.status <> 'deleted'
  ) then
    raise exception 'Listing is not available for this Featured payment';
  end if;

  v_plan := 'featured_' || v_days;
  v_expires := now() + make_interval(days => v_days);

  perform set_config('app.harvesthome_paid_activation','1',true);

  update public.listings
  set publication_plan = v_plan,
      publish_expires_at = null,
      status = 'approved',
      updated_at = now()
  where id = v_payment.listing_id;

  insert into public.featured_listings(
    listing_id, starts_at, ends_at, created_by, source_payment_id, activation_pending
  )
  values (
    v_payment.listing_id, now(), v_expires, v_user_id, v_payment.id, false
  )
  on conflict(listing_id) do update
    set starts_at = now(),
        ends_at = excluded.ends_at,
        created_by = v_user_id,
        source_payment_id = excluded.source_payment_id,
        activation_pending = false;

  update public.payments
  set activated_at = coalesce(activated_at, now())
  where id = v_payment.id;

  return jsonb_build_object(
    'activated', true,
    'pending_approval', false,
    'already_activated', v_payment.activated_at is not null,
    'reference', p_reference,
    'service', v_payment.service,
    'days', v_days,
    'listing_id', v_payment.listing_id
  );
end;
$$;

grant execute on function public.activate_paid_featured_payment(text) to authenticated, service_role;

-- End existing active staff-granted promotions that have no successful
-- payment record. Keep the rows for audit/history rather than deleting them.
update public.featured_listings
set ends_at = now()
where ends_at > now()
  and source_payment_id is null
  and created_by in (
    select id from public.profiles where role in ('Admin','Moderator')
  );

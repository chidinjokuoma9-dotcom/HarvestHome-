-- HarvestHome: moderator payment check/approval fix
-- Run this once in Supabase SQL Editor.

create or replace function public.approve_paid_listing(p_listing_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seller_id uuid;
  v_title text;
  v_payment_id uuid;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('Admin','Moderator')
  ) then
    raise exception 'Not allowed';
  end if;

  select seller_id, title
    into v_seller_id, v_title
  from public.listings
  where id = p_listing_id
  for update;

  if v_seller_id is null then
    raise exception 'Listing not found';
  end if;

  select id
    into v_payment_id
  from public.payments
  where listing_id = p_listing_id
    and status = 'success'
  order by created_at desc
  limit 1;

  if v_payment_id is null then
    return jsonb_build_object('approved', false, 'payment_found', false, 'listing_id', p_listing_id);
  end if;

  update public.listings set status = 'approved' where id = p_listing_id;

  return jsonb_build_object('approved', true, 'payment_found', true, 'listing_id', p_listing_id, 'title', v_title);
end;
$$;

grant execute on function public.approve_paid_listing(uuid) to authenticated;

-- HarvestHome Lifetime Listing — one-time ₦8,150, annual policy review and staff moderation.
-- This migration is additive. It does not change existing Featured pricing or Paystack credentials.

alter table public.listings
  add column if not exists lifetime_review_due_at timestamptz;

update public.listings
set lifetime_review_due_at = now() + interval '1 year'
where lower(coalesce(publication_plan,'')) = 'lifetime'
  and lifetime_review_due_at is null;

create table if not exists public.listing_moderation_logs (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  seller_id uuid references public.profiles(id) on delete set null,
  listing_title text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_role text not null,
  action text not null check (action in ('removed','restored','annual_review_kept')),
  reason text not null,
  previous_status text,
  new_status text,
  created_at timestamptz not null default now()
);

create index if not exists listing_moderation_logs_listing_created_idx
  on public.listing_moderation_logs(listing_id, created_at desc);

create index if not exists listings_lifetime_review_due_idx
  on public.listings(lifetime_review_due_at)
  where lower(coalesce(publication_plan,'')) = 'lifetime';

alter table public.listing_moderation_logs enable row level security;
revoke all on public.listing_moderation_logs from anon, authenticated;
grant select on public.listing_moderation_logs to authenticated;

drop policy if exists listing_moderation_logs_staff_read
  on public.listing_moderation_logs;
create policy listing_moderation_logs_staff_read
  on public.listing_moderation_logs
  for select
  to authenticated
  using (public.is_staff());

create or replace function public.review_lifetime_listing(
  p_listing_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
  v_seller_id uuid;
  v_title text;
  v_status text;
  v_plan text;
  v_due timestamptz;
  v_previous_status text;
  v_reason text;
  v_new_status text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid();

  if coalesce(v_role,'') not in ('Admin','Moderator') then
    raise exception 'Only an Admin or Moderator can review or remove listings';
  end if;

  select seller_id, title, status, lower(coalesce(publication_plan,'')), lifetime_review_due_at
    into v_seller_id, v_title, v_status, v_plan, v_due
  from public.listings
  where id = p_listing_id
  for update;

  if not found then
    raise exception 'Listing not found';
  end if;

  v_reason := coalesce(nullif(trim(p_reason),''),'HarvestHome marketplace policy review');

  if p_action = 'remove' then
    if length(v_reason) < 5 then
      raise exception 'Please provide a clear removal reason';
    end if;
    if v_status = 'deleted' then
      return jsonb_build_object('success',false,'message','This listing has already been removed');
    end if;

    update public.listings
    set status = 'deleted',
        updated_at = now()
    where id = p_listing_id;

    update public.featured_listings
    set ends_at = least(ends_at, now())
    where listing_id = p_listing_id
      and ends_at > now();

    v_new_status := 'deleted';
    insert into public.listing_moderation_logs(
      listing_id,seller_id,listing_title,actor_id,actor_role,action,reason,previous_status,new_status
    ) values (
      p_listing_id,v_seller_id,coalesce(v_title,'Untitled listing'),auth.uid(),v_role,
      'removed',v_reason,v_status,v_new_status
    );

    if v_seller_id is not null then
      insert into public.notifications(user_id,type,title,message,listing_id)
      values (
        v_seller_id,
        'listing_review',
        'Listing removed',
        'Your listing "' || coalesce(v_title,'Untitled listing') || '" was removed by a HarvestHome ' || v_role || '. Reason: ' || v_reason || '. If you believe this was a mistake, contact support@harvesthome.ng.',
        p_listing_id
      );
    end if;

    return jsonb_build_object('success',true,'action','removed','listing_id',p_listing_id);

  elsif p_action = 'keep' then
    if v_plan <> 'lifetime' then
      raise exception 'Annual review renewal applies only to Lifetime Listings';
    end if;
    if v_status <> 'approved' then
      raise exception 'Only a published Lifetime Listing can pass annual review';
    end if;
    if v_due is not null and v_due > now() then
      raise exception 'The annual review is not due yet';
    end if;

    v_due := now() + interval '1 year';
    update public.listings
    set lifetime_review_due_at = v_due,
        updated_at = now()
    where id = p_listing_id;

    insert into public.listing_moderation_logs(
      listing_id,seller_id,listing_title,actor_id,actor_role,action,reason,previous_status,new_status
    ) values (
      p_listing_id,v_seller_id,coalesce(v_title,'Untitled listing'),auth.uid(),v_role,
      'annual_review_kept',v_reason,v_status,v_status
    );

    if v_seller_id is not null then
      insert into public.notifications(user_id,type,title,message,listing_id)
      values (
        v_seller_id,
        'listing_review',
        'Lifetime Listing annual review completed',
        'Your Lifetime Listing "' || coalesce(v_title,'Untitled listing') || '" passed its annual HarvestHome policy review and remains published. Its next review is due ' || to_char(v_due at time zone 'Africa/Lagos','DD Mon YYYY') || '.',
        p_listing_id
      );
    end if;

    return jsonb_build_object('success',true,'action','annual_review_kept','review_due_at',v_due);

  elsif p_action = 'restore' then
    if v_status <> 'deleted' then
      raise exception 'Only a previously removed listing can be restored';
    end if;

    select previous_status into v_previous_status
    from public.listing_moderation_logs
    where listing_id = p_listing_id
      and action = 'removed'
    order by created_at desc
    limit 1;

    if v_previous_status is null or v_previous_status = 'deleted' then
      v_previous_status := 'approved';
    end if;

    if v_plan = 'lifetime' and (v_due is null or v_due <= now()) then
      v_due := now() + interval '1 year';
    end if;

    update public.listings
    set status = v_previous_status,
        lifetime_review_due_at = v_due,
        updated_at = now()
    where id = p_listing_id;

    insert into public.listing_moderation_logs(
      listing_id,seller_id,listing_title,actor_id,actor_role,action,reason,previous_status,new_status
    ) values (
      p_listing_id,v_seller_id,coalesce(v_title,'Untitled listing'),auth.uid(),v_role,
      'restored',v_reason,v_status,v_previous_status
    );

    if v_seller_id is not null then
      insert into public.notifications(user_id,type,title,message,listing_id)
      values (
        v_seller_id,
        'listing_review',
        'Listing restored',
        'Your listing "' || coalesce(v_title,'Untitled listing') || '" has been restored by a HarvestHome ' || v_role || '.',
        p_listing_id
      );
    end if;

    return jsonb_build_object('success',true,'action','restored','listing_id',p_listing_id);

  else
    raise exception 'Invalid listing moderation action';
  end if;
end;
$$;

revoke execute on function public.review_lifetime_listing(uuid,text,text) from public, anon;
grant execute on function public.review_lifetime_listing(uuid,text,text) to authenticated;

-- Protect publication-plan fields from direct seller updates. Trusted paid-activation
-- RPCs set this transaction-local flag only after checking a successful payment.
create or replace function public.prevent_listing_protected_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid_activation boolean :=
    coalesce(current_setting('app.harvesthome_paid_activation', true), '') = '1';
  v_free_renewal boolean;
begin
  v_free_renewal :=
    old.seller_id = auth.uid()
    and old.status = 'approved'
    and new.status = 'approved'
    and lower(coalesce(old.publication_plan,'')) = 'free'
    and lower(coalesce(new.publication_plan,'')) = 'free'
    and (old.publish_expires_at is null or old.publish_expires_at <= now())
    and new.publish_expires_at > now()
    and new.publish_expires_at <= now() + interval '48 hours'
    and new.lifetime_review_due_at is not distinct from old.lifetime_review_due_at;

  if not public.is_staff() then
    if new.seller_id is distinct from old.seller_id
       or new.views is distinct from old.views
       or (
         new.status is distinct from old.status
         and not (
           old.seller_id = auth.uid()
           and new.status = 'deleted'
           and old.status is distinct from 'deleted'
         )
         and not v_paid_activation
       )
       or (
         new.publication_plan is distinct from old.publication_plan
         and not v_paid_activation
       )
       or (
         new.lifetime_review_due_at is distinct from old.lifetime_review_due_at
         and not v_paid_activation
       )
       or (
         new.publish_expires_at is distinct from old.publish_expires_at
         and not (v_paid_activation or v_free_renewal)
       ) then
      raise exception 'Protected listing fields can only be changed by HarvestHome or an authorised publication action';
    end if;
  end if;
  return new;
end;
$$;

-- Existing Featured activation already sets this same trusted transaction flag.
-- Permit that validated activation to record its payment timestamp as well.
create or replace function public.prevent_payment_protected_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null
     and not public.is_staff()
     and coalesce(current_setting('app.harvesthome_paid_activation', true), '') <> '1' then
    raise exception 'Payment records can only be changed by the payment service';
  end if;
  return new;
end;
$$;

create or replace function public.activate_paid_lifetime_listing(p_reference text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_listing public.listings%rowtype;
  v_review_due timestamptz;
  v_already_activated boolean;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  select * into v_payment
  from public.payments
  where reference = p_reference
    and user_id = auth.uid()
    and status = 'success'
  for update;

  if v_payment.id is null then
    raise exception 'Successful Lifetime Listing payment not found';
  end if;
  if v_payment.service <> 'lifetime_listing'
     or v_payment.amount <> 815000
     or upper(coalesce(v_payment.currency,'NGN')) <> 'NGN' then
    raise exception 'Invalid Lifetime Listing payment';
  end if;
  if v_payment.listing_id is null then
    raise exception 'Lifetime Listing payment is missing its listing reference';
  end if;

  select * into v_listing
  from public.listings
  where id = v_payment.listing_id
  for update;

  if v_listing.id is null
     or v_listing.seller_id <> auth.uid()
     or v_listing.status = 'deleted' then
    raise exception 'This listing is not available for Lifetime activation';
  end if;
  if v_listing.status <> 'approved' then
    raise exception 'Only an approved listing can be upgraded to Lifetime Listing';
  end if;

  v_already_activated := v_payment.activated_at is not null;
  v_review_due := coalesce(v_listing.lifetime_review_due_at, now() + interval '1 year');

  perform set_config('app.harvesthome_paid_activation','1',true);

  update public.listings
  set publication_plan = 'lifetime',
      publish_expires_at = null,
      lifetime_review_due_at = v_review_due,
      updated_at = now()
  where id = v_listing.id;

  update public.payments
  set activated_at = coalesce(activated_at, now())
  where id = v_payment.id;

  return jsonb_build_object(
    'activated', true,
    'already_activated', v_already_activated,
    'publication_plan', 'lifetime',
    'review_due_at', v_review_due,
    'listing_id', v_listing.id,
    'reference', p_reference
  );
end;
$$;

revoke execute on function public.activate_paid_lifetime_listing(text) from public, anon;
grant execute on function public.activate_paid_lifetime_listing(text) to authenticated;

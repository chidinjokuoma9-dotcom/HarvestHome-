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

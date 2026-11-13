-- HarvestHome seller reviews and ratings
-- Chat-gated reviews, seller replies, user reports, and staff moderation.
-- This migration is intentionally separate from marketplace payments and listing workflows.

create table if not exists public.seller_reviews (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_id uuid not null references public.profiles(id) on delete cascade,
  reviewer_name text not null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (char_length(trim(comment)) between 10 and 1000),
  seller_reply text,
  seller_replied_at timestamptz,
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seller_id, reviewer_id),
  check (seller_id <> reviewer_id),
  check (seller_reply is null or char_length(trim(seller_reply)) between 1 and 1000)
);

create index if not exists seller_reviews_seller_status_created_idx
  on public.seller_reviews (seller_id, status, created_at desc);
create index if not exists seller_reviews_reviewer_idx
  on public.seller_reviews (reviewer_id, created_at desc);

create table if not exists public.seller_review_reports (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.seller_reviews(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  unique (review_id, reporter_id)
);
create index if not exists seller_review_reports_status_created_idx
  on public.seller_review_reports (status, created_at desc);

alter table public.seller_reviews enable row level security;
alter table public.seller_review_reports enable row level security;

revoke all on table public.seller_reviews from anon, authenticated;
grant select on table public.seller_reviews to anon, authenticated;
revoke all on table public.seller_review_reports from anon, authenticated;
grant select, insert on table public.seller_review_reports to authenticated;

drop policy if exists seller_reviews_public_read on public.seller_reviews;
create policy seller_reviews_public_read on public.seller_reviews
  for select to anon, authenticated using (status = 'published');
drop policy if exists seller_reviews_participant_read on public.seller_reviews;
create policy seller_reviews_participant_read on public.seller_reviews
  for select to authenticated using (
    reviewer_id = (select auth.uid()) or seller_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('Admin','Moderator'))
  );

drop policy if exists seller_review_reports_insert_own on public.seller_review_reports;
create policy seller_review_reports_insert_own on public.seller_review_reports
  for insert to authenticated with check (
    reporter_id = (select auth.uid())
    and exists (select 1 from public.seller_reviews r where r.id = review_id and r.status = 'published')
  );
drop policy if exists seller_review_reports_read_staff on public.seller_review_reports;
create policy seller_review_reports_read_staff on public.seller_review_reports
  for select to authenticated using (
    exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role in ('Admin','Moderator'))
  );

create or replace function public.get_seller_review_summary(p_seller_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $
  select jsonb_build_object(
    'review_count', count(*),
    'average_rating', coalesce(round(avg(r.rating)::numeric, 2), 0)
  )
  from public.seller_reviews r
  where r.seller_id = p_seller_id and r.status = 'published';
$;

create or replace function public.get_seller_review_context(p_seller_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_review public.seller_reviews%rowtype;
  v_eligible boolean := false;
begin
  if v_uid is null or p_seller_id is null or v_uid = p_seller_id then
    return jsonb_build_object('eligible', false, 'has_review', false);
  end if;

  select exists (
    select 1 from public.conversations c
    where c.buyer_id = v_uid and c.seller_id = p_seller_id
  ) into v_eligible;

  select * into v_review
  from public.seller_reviews r
  where r.seller_id = p_seller_id and r.reviewer_id = v_uid
  limit 1;

  return jsonb_build_object(
    'eligible', v_eligible,
    'has_review', v_review.id is not null,
    'review_id', v_review.id,
    'rating', v_review.rating,
    'comment', v_review.comment,
    'status', v_review.status
  );
end;
$$;

create or replace function public.submit_seller_review(
  p_seller_id uuid,
  p_rating integer,
  p_comment text
)
returns public.seller_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_review public.seller_reviews%rowtype;
  v_comment text := trim(coalesce(p_comment, ''));
begin
  if v_uid is null then raise exception 'Please sign in to review a seller.'; end if;
  if p_seller_id is null or p_seller_id = v_uid then raise exception 'You cannot review your own seller account.'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'Choose a rating from 1 to 5 stars.'; end if;
  if char_length(v_comment) < 10 or char_length(v_comment) > 1000 then raise exception 'Your review must be between 10 and 1,000 characters.'; end if;
  if not exists (
    select 1 from public.conversations c
    where c.buyer_id = v_uid and c.seller_id = p_seller_id
  ) then
    raise exception 'You can review this seller only after starting a HarvestHome chat with them.';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'HarvestHome buyer')
    into v_name from public.profiles p where p.id = v_uid;
  v_name := coalesce(v_name, 'HarvestHome buyer');

  insert into public.seller_reviews (seller_id, reviewer_id, reviewer_name, rating, comment, status)
  values (p_seller_id, v_uid, v_name, p_rating, v_comment, 'pending')
  on conflict (seller_id, reviewer_id) do update
    set reviewer_name = excluded.reviewer_name,
        rating = excluded.rating,
        comment = excluded.comment,
        seller_reply = null,
        seller_replied_at = null,
        status = 'pending',
        updated_at = now()
  returning * into v_review;

  return v_review;
end;
$$;

create or replace function public.reply_to_seller_review(p_review_id uuid, p_reply text)
returns public.seller_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reply text := trim(coalesce(p_reply, ''));
  v_review public.seller_reviews%rowtype;
begin
  if v_uid is null then raise exception 'Please sign in.'; end if;
  if char_length(v_reply) < 1 or char_length(v_reply) > 1000 then raise exception 'Your reply must be between 1 and 1,000 characters.'; end if;
  update public.seller_reviews r
    set seller_reply = v_reply, seller_replied_at = now(), updated_at = now()
    where r.id = p_review_id and r.seller_id = v_uid and r.status = 'published'
    returning * into v_review;
  if v_review.id is null then raise exception 'Only the seller can reply to a published review on their account.'; end if;
  return v_review;
end;
$$;

create or replace function public.report_seller_review(p_review_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_reason text := trim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'Please sign in to report a review.'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then raise exception 'Please provide a reason between 5 and 500 characters.'; end if;
  if not exists (select 1 from public.seller_reviews r where r.id = p_review_id and r.status = 'published') then
    raise exception 'This review is not available to report.';
  end if;
  if exists (select 1 from public.seller_reviews r where r.id = p_review_id and (r.reviewer_id = v_uid or r.seller_id = v_uid)) then
    raise exception 'You cannot report a review you wrote or received.';
  end if;

  insert into public.seller_review_reports (review_id, reporter_id, reason)
  values (p_review_id, v_uid, v_reason)
  on conflict (review_id, reporter_id) do update
    set reason = excluded.reason, status = 'open', created_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_seller_review_moderation_queue()
returns table (
  id uuid, seller_id uuid, reviewer_name text, rating smallint, comment text,
  status text, created_at timestamptz, report_count bigint, report_reasons text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('Admin','Moderator')) then
    raise exception 'Only HarvestHome staff can access the seller review queue.';
  end if;

  return query
  select r.id, r.seller_id, r.reviewer_name, r.rating, r.comment, r.status, r.created_at,
         count(rep.id) filter (where rep.status = 'open') as report_count,
         coalesce(string_agg(rep.reason, ' | ') filter (where rep.status = 'open'), '') as report_reasons
  from public.seller_reviews r
  left join public.seller_review_reports rep on rep.review_id = r.id
  where r.status = 'pending'
     or exists (select 1 from public.seller_review_reports open_rep where open_rep.review_id = r.id and open_rep.status = 'open')
  group by r.id
  order by (r.status = 'pending') desc, r.created_at asc;
end;
$$;

create or replace function public.moderate_seller_review(p_review_id uuid, p_decision text)
returns public.seller_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.seller_reviews%rowtype;
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('Admin','Moderator')) then
    raise exception 'Only HarvestHome staff can moderate seller reviews.';
  end if;
  if p_decision not in ('published','hidden') then raise exception 'Choose published or hidden.'; end if;

  update public.seller_reviews r
    set status = p_decision, updated_at = now()
    where r.id = p_review_id
    returning * into v_review;
  if v_review.id is null then raise exception 'Review not found.'; end if;

  update public.seller_review_reports
    set status = 'resolved'
    where review_id = p_review_id and status = 'open';
  return v_review;
end;
$$;

revoke execute on function public.get_seller_review_summary(uuid) from public;
revoke execute on function public.get_seller_review_context(uuid) from public, anon;
revoke execute on function public.submit_seller_review(uuid, integer, text) from public, anon;
revoke execute on function public.reply_to_seller_review(uuid, text) from public, anon;
revoke execute on function public.report_seller_review(uuid, text) from public, anon;
revoke execute on function public.get_seller_review_moderation_queue() from public, anon;
revoke execute on function public.moderate_seller_review(uuid, text) from public, anon;
grant execute on function public.get_seller_review_summary(uuid) to anon, authenticated;
grant execute on function public.get_seller_review_context(uuid) to authenticated;
grant execute on function public.submit_seller_review(uuid, integer, text) to authenticated;
grant execute on function public.reply_to_seller_review(uuid, text) to authenticated;
grant execute on function public.report_seller_review(uuid, text) to authenticated;
grant execute on function public.get_seller_review_moderation_queue() to authenticated;
grant execute on function public.moderate_seller_review(uuid, text) to authenticated;

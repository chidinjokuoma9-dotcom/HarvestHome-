-- HarvestHome News & Insights article comments.
-- Authenticated comments are held for moderator approval before public display.
-- This feature is isolated from marketplace listings, seller reviews and payments.

create table if not exists public.news_article_comments (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.news_articles(id) on delete cascade,
  parent_id uuid references public.news_article_comments(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  comment text not null check (char_length(trim(comment)) between 2 and 2000),
  status text not null default 'pending' check (status in ('pending','published','hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (parent_id is null or parent_id <> id)
);

create index if not exists news_article_comments_public_idx
  on public.news_article_comments (article_id, status, created_at desc);
create index if not exists news_article_comments_parent_idx
  on public.news_article_comments (parent_id, status, created_at asc);
create index if not exists news_article_comments_author_idx
  on public.news_article_comments (author_id, created_at desc);

create table if not exists public.news_article_comment_reports (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.news_article_comments(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  reason text not null check (char_length(trim(reason)) between 5 and 500),
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  unique (comment_id, reporter_id)
);

create index if not exists news_article_comment_reports_status_idx
  on public.news_article_comment_reports (status, created_at desc);

alter table public.news_article_comments enable row level security;
alter table public.news_article_comment_reports enable row level security;

-- All client access is mediated by scoped RPC functions.
revoke all on table public.news_article_comments from anon, authenticated;
revoke all on table public.news_article_comment_reports from anon, authenticated;

create or replace function public.get_news_article_comments(p_slug text)
returns table (
  id uuid,
  parent_id uuid,
  author_name text,
  comment text,
  created_at timestamptz,
  reply_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.parent_id, c.author_name, c.comment, c.created_at,
         (select count(*) from public.news_article_comments replies
          where replies.parent_id = c.id and replies.status = 'published')
  from public.news_article_comments c
  join public.news_articles a on a.id = c.article_id
  where a.slug = p_slug and a.status = 'published'
    and c.status = 'published'
  order by c.created_at asc
  limit 200;
$$;

create or replace function public.submit_news_article_comment(
  p_slug text,
  p_comment text,
  p_parent_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_article_id uuid;
  v_author_name text;
  v_comment text := trim(coalesce(p_comment, ''));
  v_id uuid;
begin
  if v_uid is null then raise exception 'Please sign in to comment.'; end if;
  if char_length(v_comment) < 2 or char_length(v_comment) > 2000 then
    raise exception 'Comments must be between 2 and 2,000 characters.';
  end if;

  select a.id into v_article_id
  from public.news_articles a
  where a.slug = trim(coalesce(p_slug, '')) and a.status = 'published'
  limit 1;
  if v_article_id is null then raise exception 'This published article could not be found.'; end if;

  select nullif(trim(p.full_name), '') into v_author_name
  from public.profiles p where p.id = v_uid;
  if v_author_name is null then
    v_author_name := 'HarvestHome reader';
  end if;

  if p_parent_id is not null and not exists (
    select 1 from public.news_article_comments parent
    where parent.id = p_parent_id
      and parent.article_id = v_article_id
      and parent.parent_id is null
      and parent.status = 'published'
  ) then
    raise exception 'You can reply only to a published comment on this article.';
  end if;

  insert into public.news_article_comments
    (article_id, parent_id, author_id, author_name, comment, status)
  values
    (v_article_id, p_parent_id, v_uid, v_author_name, v_comment, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.report_news_article_comment(
  p_comment_id uuid,
  p_reason text
)
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
  if v_uid is null then raise exception 'Please sign in to report a comment.'; end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'Please provide a reason between 5 and 500 characters.';
  end if;
  if not exists (
    select 1 from public.news_article_comments c
    where c.id = p_comment_id and c.status = 'published'
  ) then
    raise exception 'This comment is not available to report.';
  end if;
  insert into public.news_article_comment_reports (comment_id, reporter_id, reason)
  values (p_comment_id, v_uid, v_reason)
  returning id into v_id;
  return v_id;
exception
  when unique_violation then
    raise exception 'You have already reported this comment.';
end;
$$;

create or replace function public.get_news_comment_moderation_queue()
returns table (
  id uuid,
  article_id uuid,
  article_slug text,
  article_title text,
  parent_id uuid,
  author_name text,
  comment text,
  status text,
  created_at timestamptz,
  report_count bigint,
  report_reasons text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not (
    exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'Admin')
    or exists (select 1 from public.news_staff s where s.user_id = v_uid and s.active = true)
  ) then
    raise exception 'Only active HarvestHome newsroom staff can moderate comments.';
  end if;

  return query
  select c.id, c.article_id, a.slug, a.title, c.parent_id, c.author_name,
         c.comment, c.status, c.created_at,
         count(r.id) filter (where r.status = 'open'),
         string_agg(r.reason, ' · ') filter (where r.status = 'open')
  from public.news_article_comments c
  join public.news_articles a on a.id = c.article_id
  left join public.news_article_comment_reports r on r.comment_id = c.id
  where c.status in ('pending','published','hidden')
    and (c.status = 'pending' or exists (
      select 1 from public.news_article_comment_reports open_report
      where open_report.comment_id = c.id and open_report.status = 'open'
    ))
  group by c.id, c.article_id, a.slug, a.title, c.parent_id,
           c.author_name, c.comment, c.status, c.created_at
  order by (c.status = 'pending') desc, c.created_at desc
  limit 250;
end;
$$;

create or replace function public.moderate_news_article_comment(
  p_comment_id uuid,
  p_decision text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not (
    exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'Admin')
    or exists (select 1 from public.news_staff s where s.user_id = v_uid and s.active = true)
  ) then
    raise exception 'Only active HarvestHome newsroom staff can moderate comments.';
  end if;
  if p_decision not in ('published','hidden') then
    raise exception 'Choose Publish or Hide.';
  end if;

  update public.news_article_comments
  set status = p_decision, updated_at = now()
  where id = p_comment_id;
  if not found then raise exception 'Comment not found.'; end if;

  if p_decision = 'published' then
    update public.news_article_comment_reports
    set status = 'resolved'
    where comment_id = p_comment_id and status = 'open';
  end if;
  return true;
end;
$$;

revoke all on function public.get_news_article_comments(text) from public;
revoke all on function public.submit_news_article_comment(text,text,uuid) from public;
revoke all on function public.report_news_article_comment(uuid,text) from public;
revoke all on function public.get_news_comment_moderation_queue() from public;
revoke all on function public.moderate_news_article_comment(uuid,text) from public;

grant execute on function public.get_news_article_comments(text) to anon, authenticated;
grant execute on function public.submit_news_article_comment(text,text,uuid) to authenticated;
grant execute on function public.report_news_article_comment(uuid,text) to authenticated;
grant execute on function public.get_news_comment_moderation_queue() to authenticated;
grant execute on function public.moderate_news_article_comment(uuid,text) to authenticated;

-- HARVESTHOME NEWS & INSIGHTS — REVIEW DRAFT ONLY
-- This file is NOT applied to the live Supabase database.
-- Apply only after the owner has reviewed and approved the preview.
-- Reuses the existing private.is_hh_partnership_admin() staff check.
-- Creates one isolated table; does not alter marketplace tables.

create table if not exists public.news_articles (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 5 and 180),
  slug text not null unique check (char_length(trim(slug)) between 1 and 180),
  category text not null default 'Other News',
  author_name text not null default 'HarvestHome Editorial Team',
  excerpt text not null check (char_length(trim(excerpt)) between 10 and 360),
  content text not null check (char_length(trim(content)) between 20 and 50000),
  featured_image_url text,
  source_name text,
  source_url text,
  status text not null default 'draft'
    check (status in ('draft','pending_review','published','archived')),
  is_breaking boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists news_articles_public_feed_idx
  on public.news_articles (published_at desc)
  where status = 'published';
create index if not exists news_articles_editorial_idx
  on public.news_articles (updated_at desc, status);

alter table public.news_articles enable row level security;

drop policy if exists "Published news is publicly readable" on public.news_articles;
create policy "Published news is publicly readable"
  on public.news_articles for select
  to anon, authenticated
  using (status = 'published');

drop policy if exists "HarvestHome staff can view all news drafts" on public.news_articles;
create policy "HarvestHome staff can view all news drafts"
  on public.news_articles for select
  to authenticated
  using ((select private.is_hh_partnership_admin()));

drop policy if exists "HarvestHome staff can create news articles" on public.news_articles;
create policy "HarvestHome staff can create news articles"
  on public.news_articles for insert
  to authenticated
  with check (
    (select private.is_hh_partnership_admin())
    and (created_by is null or created_by = (select auth.uid()))
  );

drop policy if exists "HarvestHome staff can update news articles" on public.news_articles;
create policy "HarvestHome staff can update news articles"
  on public.news_articles for update
  to authenticated
  using ((select private.is_hh_partnership_admin()))
  with check ((select private.is_hh_partnership_admin()));

drop policy if exists "HarvestHome staff can delete news articles" on public.news_articles;
create policy "HarvestHome staff can delete news articles"
  on public.news_articles for delete
  to authenticated
  using ((select private.is_hh_partnership_admin()));

grant select on public.news_articles to anon, authenticated;
grant insert, update, delete on public.news_articles to authenticated;

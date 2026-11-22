-- Restrict newsroom article visibility to the authoring Moderator.
-- Admins retain full visibility across all newsroom articles and editorial reviews.
-- Public readers continue to see published stories through the existing public policy.
-- No article content, status, ownership, or existing media is modified.

drop policy if exists "Active newsroom staff can read news articles"
  on public.news_articles;

create policy "Newsroom Admins and article owners can read news articles"
  on public.news_articles
  for select
  to authenticated
  using (
    (select private.is_newsroom_admin())
    or (
      (select private.is_active_newsroom_staff())
      and created_by = (select auth.uid())
    )
  );

drop policy if exists "Newsroom staff can read editorial feedback"
  on public.news_article_reviews;

create policy "Admins and article owners can read editorial feedback"
  on public.news_article_reviews
  for select
  to authenticated
  using (
    (select private.is_newsroom_admin())
    or (
      (select private.is_active_newsroom_staff())
      and exists (
        select 1
        from public.news_articles as article
        where article.id = news_article_reviews.article_id
          and article.created_by = (select auth.uid())
      )
    )
  );

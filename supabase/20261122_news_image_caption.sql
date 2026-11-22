-- Optional caption and photographer credit for the News & Insights featured image.
-- Additive only: existing articles and images remain unchanged.
alter table public.news_articles
  add column if not exists image_caption text;

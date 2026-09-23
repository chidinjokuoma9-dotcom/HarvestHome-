create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text,
 role text not null default 'Buyer' check (role in ('Buyer','Seller','Moderator','Admin')),
 country text default 'Nigeria',
 verified boolean not null default false,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.listings (
 id uuid primary key default gen_random_uuid(), seller_id uuid references public.profiles(id) on delete set null,
 country text not null default 'Nigeria', location text, category text not null, title text not null,
 description text, price numeric, currency text not null default 'NGN', mode text not null default 'Sale',
 status text not null default 'pending' check (status in ('pending','approved','rejected','deleted')),
 cover_url text, video_url text, views integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.listing_media (
 id uuid primary key default gen_random_uuid(), listing_id uuid not null references public.listings(id) on delete cascade,
 media_type text not null check (media_type in ('image','video')), storage_path text not null, created_at timestamptz not null default now()
);

create table if not exists public.favourites (
 user_id uuid references public.profiles(id) on delete cascade, listing_id uuid references public.listings(id) on delete cascade,
 created_at timestamptz not null default now(), primary key(user_id, listing_id)
);

create table if not exists public.enquiries (
 id uuid primary key default gen_random_uuid(), listing_id uuid references public.listings(id) on delete set null,
 buyer_id uuid references public.profiles(id) on delete set null, message text not null, created_at timestamptz not null default now()
);

create table if not exists public.payments (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null,
 reference text unique, service text, amount integer not null, currency text not null default 'NGN', status text not null default 'initialized', created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.profiles(id,full_name,role) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','Buyer'),coalesce(new.raw_user_meta_data->>'role','Buyer')); return new; end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('Admin','Moderator')); $$;

alter table public.profiles enable row level security; alter table public.listings enable row level security; alter table public.listing_media enable row level security; alter table public.favourites enable row level security; alter table public.enquiries enable row level security; alter table public.payments enable row level security;

drop policy if exists profiles_read_self on public.profiles; create policy profiles_read_self on public.profiles for select using (id=auth.uid() or public.is_staff());
drop policy if exists profiles_update_self on public.profiles; create policy profiles_update_self on public.profiles for update using (id=auth.uid());
drop policy if exists listings_public_approved on public.listings; create policy listings_public_approved on public.listings for select using (status='approved' or seller_id=auth.uid() or public.is_staff());
drop policy if exists listings_insert_owner on public.listings; create policy listings_insert_owner on public.listings for insert with check (seller_id=auth.uid());
drop policy if exists listings_update_owner_staff on public.listings; create policy listings_update_owner_staff on public.listings for update using (seller_id=auth.uid() or public.is_staff());
drop policy if exists listings_delete_owner_staff on public.listings; create policy listings_delete_owner_staff on public.listings for delete using (seller_id=auth.uid() or public.is_staff());
drop policy if exists media_public on public.listing_media; create policy media_public on public.listing_media for select using (true);
drop policy if exists media_owner on public.listing_media; create policy media_owner on public.listing_media for all using (exists(select 1 from public.listings l where l.id=listing_id and (l.seller_id=auth.uid() or public.is_staff()))) with check (exists(select 1 from public.listings l where l.id=listing_id and (l.seller_id=auth.uid() or public.is_staff())));
drop policy if exists fav_owner on public.favourites; create policy fav_owner on public.favourites for all using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists enquiries_buyer on public.enquiries; create policy enquiries_buyer on public.enquiries for insert with check (buyer_id=auth.uid());
drop policy if exists enquiries_read on public.enquiries; create policy enquiries_read on public.enquiries for select using (buyer_id=auth.uid() or exists(select 1 from public.listings l where l.id=listing_id and l.seller_id=auth.uid()) or public.is_staff());
drop policy if exists payments_owner on public.payments; create policy payments_owner on public.payments for select using (user_id=auth.uid() or public.is_staff());

insert into storage.buckets (id,name,public) values ('listing-media','listing-media',true) on conflict (id) do nothing;
drop policy if exists listing_media_public_read on storage.objects; create policy listing_media_public_read on storage.objects for select using (bucket_id='listing-media');
drop policy if exists listing_media_authenticated_upload on storage.objects; create policy listing_media_authenticated_upload on storage.objects for insert to authenticated with check (bucket_id='listing-media');
drop policy if exists listing_media_owner_delete on storage.objects; create policy listing_media_owner_delete on storage.objects for delete to authenticated using (bucket_id='listing-media' and owner_id::uuid=auth.uid());

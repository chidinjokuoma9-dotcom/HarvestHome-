create extension if not exists pgcrypto;
alter table public.profiles alter column role set default 'Buyer';
alter table public.profiles add column if not exists avatar_url text;

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

create table if not exists public.conversations (
 id uuid primary key default gen_random_uuid(),
 listing_id uuid not null references public.listings(id) on delete cascade,
 buyer_id uuid not null references public.profiles(id) on delete cascade,
 seller_id uuid not null references public.profiles(id) on delete cascade,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(listing_id,buyer_id,seller_id)
);

create table if not exists public.messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 sender_id uuid not null references public.profiles(id) on delete cascade,
 body text not null check (char_length(trim(body)) between 1 and 2000),
 created_at timestamptz not null default now()
);

create table if not exists public.payments (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles(id) on delete set null,
 reference text unique, service text, amount integer not null, currency text not null default 'NGN', status text not null default 'initialized', created_at timestamptz not null default now()
);
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(id) on delete cascade,
 type text not null default 'system',
 title text not null,
 message text not null,
 listing_id uuid references public.listings(id) on delete set null,
 is_read boolean not null default false,
 created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles(id,full_name,role)
  values(
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name','Buyer'),
    case when (new.raw_user_meta_data->>'role') in ('Buyer','Seller')
      then new.raw_user_meta_data->>'role'
      else 'Buyer'
    end
  );
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role in ('Admin','Moderator')); $$;

alter table public.profiles enable row level security; alter table public.notifications enable row level security; alter table public.conversations enable row level security; alter table public.messages enable row level security; alter table public.listings enable row level security; alter table public.listing_media enable row level security; alter table public.favourites enable row level security; alter table public.enquiries enable row level security; alter table public.payments enable row level security;

drop policy if exists notifications_read_own on public.notifications;
create policy notifications_read_own on public.notifications for select using (user_id=auth.uid() or public.is_staff());
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications for update using (user_id=auth.uid()) with check (user_id=auth.uid());
drop policy if exists notifications_insert_self_or_staff on public.notifications;
create policy notifications_insert_self_or_staff on public.notifications for insert with check (user_id=auth.uid() or public.is_staff());

drop policy if exists profiles_read_self on public.profiles; create policy profiles_read_self on public.profiles for select using (id=auth.uid() or public.is_staff());
drop policy if exists profiles_read_listing_sellers on public.profiles;
create policy profiles_read_listing_sellers on public.profiles for select using (
  exists (
    select 1 from public.listings l
    where l.seller_id=public.profiles.id
      and l.status='approved'
  )
);
drop policy if exists profiles_update_self on public.profiles; create policy profiles_update_self on public.profiles for update using (id=auth.uid());
drop policy if exists listings_public_approved on public.listings; create policy listings_public_approved on public.listings for select using (status='approved' or seller_id=auth.uid() or public.is_staff());
drop policy if exists listings_insert_owner on public.listings; create policy listings_insert_owner on public.listings for insert with check (seller_id=auth.uid());
drop policy if exists listings_update_owner_staff on public.listings; create policy listings_update_owner_staff on public.listings for update using (seller_id=auth.uid() or public.is_staff());
drop policy if exists listings_delete_owner_staff on public.listings; create policy listings_delete_owner_staff on public.listings for delete using (seller_id=auth.uid() or public.is_staff());
drop policy if exists media_public on public.listing_media; create policy media_public on public.listing_media for select using (true);
drop policy if exists media_owner on public.listing_media; create policy media_owner on public.listing_media for all using (exists(select 1 from public.listings l where l.id=listing_id and (l.seller_id=auth.uid() or public.is_staff()))) with check (exists(select 1 from public.listings l where l.id=listing_id and (l.seller_id=auth.uid() or public.is_staff())));
drop policy if exists fav_owner on public.favourites; create policy fav_owner on public.favourites for all using (user_id=auth.uid()) with check (user_id=auth.uid());


drop policy if exists conversations_participants on public.conversations;
create policy conversations_participants on public.conversations for select using (buyer_id=auth.uid() or seller_id=auth.uid() or public.is_staff());
drop policy if exists conversations_buyer_insert on public.conversations;
create policy conversations_buyer_insert on public.conversations for insert
with check (
  buyer_id=auth.uid()
  and exists (
    select 1 from public.listings l
    where l.id=listing_id
      and l.seller_id=seller_id
      and l.status='approved'
  )
);

create or replace function public.prevent_conversation_participant_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $
begin
  if new.buyer_id <> old.buyer_id
     or new.seller_id <> old.seller_id
     or new.listing_id <> old.listing_id then
    raise exception 'Conversation participants cannot be changed';
  end if;
  return new;
end;
$;

drop trigger if exists protect_conversation_participants on public.conversations;
create trigger protect_conversation_participants
before update on public.conversations
for each row execute function public.prevent_conversation_participant_change();

revoke execute on function public.prevent_conversation_participant_change() from public, anon, authenticated;

drop policy if exists conversations_participant_update on public.conversations;
create policy conversations_participant_update on public.conversations for update
using (buyer_id=auth.uid() or seller_id=auth.uid() or public.is_staff())
with check (buyer_id=auth.uid() or seller_id=auth.uid() or public.is_staff());

drop policy if exists messages_participants on public.messages;
create policy messages_participants on public.messages for select using (exists(select 1 from public.conversations c where c.id=conversation_id and (c.buyer_id=auth.uid() or c.seller_id=auth.uid() or public.is_staff())));
drop policy if exists messages_participant_update on public.messages;
create policy messages_participant_update on public.messages for update
using (sender_id=auth.uid())
with check (sender_id=auth.uid());

drop policy if exists messages_participant_delete on public.messages;
create policy messages_participant_delete on public.messages for delete
using (sender_id=auth.uid());

drop policy if exists messages_participant_insert on public.messages;
create policy messages_participant_insert on public.messages for insert with check (sender_id=auth.uid() and exists(select 1 from public.conversations c where c.id=conversation_id and (c.buyer_id=auth.uid() or c.seller_id=auth.uid() or public.is_staff())));

drop policy if exists profiles_read_conversation_participants on public.profiles;
create policy profiles_read_conversation_participants on public.profiles for select using (
  exists(select 1 from public.conversations c where (c.buyer_id=public.profiles.id or c.seller_id=public.profiles.id) and (c.buyer_id=auth.uid() or c.seller_id=auth.uid() or public.is_staff()))
);

create index if not exists notifications_user_created_idx on public.notifications(user_id,created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications(user_id,is_read);

create index if not exists conversations_buyer_updated_idx on public.conversations(buyer_id,updated_at desc);
create index if not exists conversations_seller_updated_idx on public.conversations(seller_id,updated_at desc);
create index if not exists messages_conversation_created_idx on public.messages(conversation_id,created_at);

drop policy if exists enquiries_buyer on public.enquiries; create policy enquiries_buyer on public.enquiries for insert with check (buyer_id=auth.uid());
drop policy if exists enquiries_read on public.enquiries; create policy enquiries_read on public.enquiries for select using (buyer_id=auth.uid() or exists(select 1 from public.listings l where l.id=listing_id and l.seller_id=auth.uid()) or public.is_staff());
drop policy if exists payments_owner on public.payments; create policy payments_owner on public.payments for select using (user_id=auth.uid() or public.is_staff());
drop policy if exists payments_owner_insert on public.payments; create policy payments_owner_insert on public.payments for insert with check (user_id=auth.uid() or public.is_staff());
drop policy if exists payments_owner_update on public.payments; create policy payments_owner_update on public.payments for update using (user_id=auth.uid() or public.is_staff()) with check (user_id=auth.uid() or public.is_staff());

insert into storage.buckets (id,name,public) values ('listing-media','listing-media',true) on conflict (id) do nothing;
insert into storage.buckets (id,name,public) values ('profile-media','profile-media',true) on conflict (id) do nothing;
drop policy if exists profile_media_public_read on storage.objects;
create policy profile_media_public_read on storage.objects for select using (bucket_id='profile-media');
drop policy if exists profile_media_authenticated_upload on storage.objects;
create policy profile_media_authenticated_upload on storage.objects for insert to authenticated with check (bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists profile_media_owner_update on storage.objects;
create policy profile_media_owner_update on storage.objects for update to authenticated using (bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists profile_media_owner_delete on storage.objects;
create policy profile_media_owner_delete on storage.objects for delete to authenticated using (bucket_id='profile-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists listing_media_public_read on storage.objects; create policy listing_media_public_read on storage.objects for select using (bucket_id='listing-media');
drop policy if exists listing_media_authenticated_upload on storage.objects; create policy listing_media_authenticated_upload on storage.objects for insert to authenticated with check (bucket_id='listing-media');
drop policy if exists listing_media_owner_delete on storage.objects; create policy listing_media_owner_delete on storage.objects for delete to authenticated using (bucket_id='listing-media' and owner_id::uuid=auth.uid());

create index if not exists listings_status_country_idx on public.listings(status,country);
create index if not exists listings_seller_created_idx on public.listings(seller_id,created_at desc);
create index if not exists listings_category_mode_idx on public.listings(category,mode);

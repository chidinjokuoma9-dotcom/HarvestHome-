-- HarvestHome VTU order-safety schema DESIGN DRAFT ONLY.
-- Do not run against Supabase or rename into supabase/migrations until reviewed.
-- This is for direct per-order payments (no customer/reseller wallet in phase 1).
-- Production handlers must verify Paystack server-side, atomically create orders,
-- persist one provider request ID before sending, and never auto-resubmit pending requests.

create table if not exists public.vtu_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null unique,
  payment_reference text unique,
  payment_status text not null default 'awaiting_payment'
    check (payment_status in ('awaiting_payment','verified','failed','cancelled','refunded','manual_review')),
  order_status text not null default 'awaiting_payment'
    check (order_status in ('awaiting_payment','payment_verified','provider_pending','succeeded','failed','refund_pending','refunded','manual_review')),
  network text not null check (network in ('MTN','AIRTEL','GLO','9MOBILE')),
  product_type text not null check (product_type in ('data','airtime')),
  service_id text not null,
  variation_code text,
  product_label text not null,
  recipient_phone text not null,
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  provider_cost_kobo bigint check (provider_cost_kobo is null or provider_cost_kobo >= 0),
  payment_fee_kobo bigint check (payment_fee_kobo is null or payment_fee_kobo >= 0),
  provider_request_id text unique,
  provider_attempt_count integer not null default 0 check (provider_attempt_count between 0 and 1),
  provider_status text,
  provider_response_code text,
  provider_response jsonb,
  payment_verified_at timestamptz,
  provider_submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (payment_status <> 'verified' or payment_verified_at is not null),
  check (provider_attempt_count = 0 or provider_request_id is not null)
);

create table if not exists public.vtu_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.vtu_orders(id) on delete restrict,
  event_key text not null,
  event_type text not null,
  source text not null check (source in ('system','paystack','vtpass','moderator')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (order_id, event_key)
);

create index if not exists vtu_orders_user_created_idx
  on public.vtu_orders (user_id, created_at desc);
create index if not exists vtu_orders_status_created_idx
  on public.vtu_orders (order_status, created_at);
create index if not exists vtu_order_events_order_created_idx
  on public.vtu_order_events (order_id, created_at);

alter table public.vtu_orders enable row level security;
alter table public.vtu_order_events enable row level security;

-- Explicitly remove default/direct client write privileges. Only trusted server-side
-- functions should mutate orders and append audit events. Authenticated clients get
-- read permission only, then RLS limits reads to their own order.
revoke all on table public.vtu_orders from anon, authenticated;
revoke all on table public.vtu_order_events from anon, authenticated;
grant select on table public.vtu_orders to authenticated;
grant select on table public.vtu_order_events to authenticated;

-- Customers can inspect only their own order records. Do not add client INSERT/UPDATE
-- policies: order creation, payment verification, provider calls and state changes
-- must be performed by trusted server-side handlers.
drop policy if exists "Customers can read their own VTU orders" on public.vtu_orders;
create policy "Customers can read their own VTU orders"
  on public.vtu_orders for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Customers can read their own VTU order events" on public.vtu_order_events;
create policy "Customers can read their own VTU order events"
  on public.vtu_order_events for select to authenticated
  using (exists (
    select 1 from public.vtu_orders o
    where o.id = vtu_order_events.order_id
      and o.user_id = (select auth.uid())
  ));

-- Atomic single-attempt reservation. A trusted server handler must call this and
-- confirm exactly one row was returned before it sends the VTpass purchase.
-- The unique request ID is persisted first. Repeated/concurrent calls return no row.
-- This function is part of the review draft only; do not deploy before code review.
create or replace function public.claim_vtu_provider_attempt(
  p_order_id uuid,
  p_provider_request_id text
)
returns table (
  order_id uuid,
  provider_request_id text,
  amount_kobo bigint,
  network text,
  product_type text,
  service_id text,
  variation_code text,
  recipient_phone text
)
language sql
security invoker
set search_path = ''
as $
  update public.vtu_orders as o
  set order_status = 'provider_pending',
      provider_request_id = p_provider_request_id,
      provider_attempt_count = 1,
      updated_at = now()
  where o.id = p_order_id
    and o.payment_status = 'verified'
    and o.payment_verified_at is not null
    and o.order_status = 'payment_verified'
    and o.provider_request_id is null
    and o.provider_attempt_count = 0
    and p_provider_request_id is not null
    and length(trim(p_provider_request_id)) > 0
  returning
    o.id, o.provider_request_id, o.amount_kobo, o.network,
    o.product_type, o.service_id, o.variation_code, o.recipient_phone;
$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Restrict it.
revoke all on function public.claim_vtu_provider_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_vtu_provider_attempt(uuid, text) to service_role;

-- Before production use, review table grants/Data API exposure, RLS advisors,
-- phone-number retention, refund workflow, provider request-ID format, and atomic
-- request creation. Do not grant direct table writes to anon/authenticated.

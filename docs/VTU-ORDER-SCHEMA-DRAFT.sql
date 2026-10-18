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
-- Expose only customer-safe order fields. Provider cost, payment fee, provider IDs,
-- raw provider response and internal reconciliation data remain server-side.
grant select (
  id, user_id, product_type, network, product_label, recipient_phone,
  amount_kobo, currency, payment_status, order_status, created_at, updated_at, completed_at
) on table public.vtu_orders to authenticated;
-- No direct client SELECT grant on the internal audit/event table.
-- The trusted Edge Function service role needs only the operations used by the
-- server-side order and audit handlers. Never expose this role to a browser.
grant select, insert, update on table public.vtu_orders to service_role;
grant select, insert on table public.vtu_order_events to service_role;
grant usage, select on sequence public.vtu_order_events_id_seq to service_role;

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

-- Idempotent order creation plus initial audit event. The caller must be a trusted
-- Edge Function that authenticates the user and resolves an approved catalogue row
-- and server-calculated price before calling this function. This SQL function does
-- not itself approve catalogue entries or determine retail prices.
create or replace function public.create_vtu_order(
  p_user_id uuid,
  p_idempotency_key text,
  p_network text,
  p_product_type text,
  p_service_id text,
  p_variation_code text,
  p_product_label text,
  p_recipient_phone text,
  p_amount_kobo bigint
)
returns table (
  order_id uuid,
  order_status text,
  payment_status text,
  amount_kobo bigint,
  currency text,
  created_at timestamptz,
  was_created boolean
)
language plpgsql
security invoker
set search_path = ''
as $vtu$
declare
  created public.vtu_orders%rowtype;
  existing public.vtu_orders%rowtype;
begin
  if p_user_id is null
     or p_idempotency_key is null
     or length(trim(p_idempotency_key)) < 16
     or length(trim(p_idempotency_key)) > 160
     or p_network not in ('MTN', 'AIRTEL', 'GLO', '9MOBILE')
     or p_product_type not in ('data', 'airtime')
     or p_service_id is null or length(trim(p_service_id)) = 0
     or p_product_label is null or length(trim(p_product_label)) = 0
     or p_recipient_phone is null or length(trim(p_recipient_phone)) = 0
     or p_amount_kobo is null or p_amount_kobo <= 0
     or (p_product_type = 'data' and (p_variation_code is null or length(trim(p_variation_code)) = 0))
     or (p_product_type = 'airtime' and p_variation_code is not null)
  then
    raise exception 'Invalid VTU order input';
  end if;

  insert into public.vtu_orders (
    user_id, idempotency_key, network, product_type, service_id,
    variation_code, product_label, recipient_phone, amount_kobo
  ) values (
    p_user_id, trim(p_idempotency_key), p_network, p_product_type, trim(p_service_id),
    nullif(trim(coalesce(p_variation_code, '')), ''), trim(p_product_label),
    trim(p_recipient_phone), p_amount_kobo
  )
  on conflict (idempotency_key) do nothing
  returning * into created;

  if found then
    insert into public.vtu_order_events (
      order_id, event_key, event_type, source, details
    ) values (
      created.id,
      'order_created',
      'order_created',
      'system',
      jsonb_build_object(
        'product_type', created.product_type,
        'network', created.network,
        'amount_kobo', created.amount_kobo,
        'currency', created.currency
      )
    );

    return query select created.id, created.order_status, created.payment_status,
      created.amount_kobo, created.currency, created.created_at, true;
    return;
  end if;

  -- A repeated idempotency key returns the existing order only when every
  -- material field matches. Reusing a key for a different purchase is rejected.
  select o.* into existing
  from public.vtu_orders as o
  where o.idempotency_key = trim(p_idempotency_key)
  for update;

  if not found then
    raise exception 'Could not resolve existing VTU order for idempotency key';
  end if;

  if existing.user_id is distinct from p_user_id
     or existing.network is distinct from p_network
     or existing.product_type is distinct from p_product_type
     or existing.service_id is distinct from trim(p_service_id)
     or existing.variation_code is distinct from nullif(trim(coalesce(p_variation_code, '')), '')
     or existing.product_label is distinct from trim(p_product_label)
     or existing.recipient_phone is distinct from trim(p_recipient_phone)
     or existing.amount_kobo is distinct from p_amount_kobo
  then
    raise exception 'Idempotency key was already used for a different VTU order';
  end if;

  return query select existing.id, existing.order_status, existing.payment_status,
    existing.amount_kobo, existing.currency, existing.created_at, false;
end;
$vtu$;

revoke all on function public.create_vtu_order(uuid, text, text, text, text, text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.create_vtu_order(uuid, text, text, text, text, text, text, text, bigint)
  to service_role;

-- Atomic single-attempt reservation plus audit event. A trusted server handler
-- must confirm exactly one row was returned before it sends the VTpass purchase.
-- The request ID is reserved, not yet marked as submitted. The order update and
-- audit event commit or roll back together. Repeated/concurrent calls return no row.
-- This remains a review draft; do not deploy before SQL and integration testing.
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
language plpgsql
security invoker
set search_path = ''
as $vtu$
declare
  claimed public.vtu_orders%rowtype;
begin
  if p_provider_request_id is null or length(trim(p_provider_request_id)) = 0 then
    return;
  end if;

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
  returning o.* into claimed;

  if not found then
    return;
  end if;

  insert into public.vtu_order_events (
    order_id, event_key, event_type, source, details
  ) values (
    claimed.id,
    'provider_attempt_reserved',
    'provider_attempt_reserved',
    'system',
    jsonb_build_object(
      'provider_request_id', claimed.provider_request_id,
      'note', 'Request ID reserved before provider submission; submission is not yet confirmed.'
    )
  );

  return query
  select claimed.id, claimed.provider_request_id, claimed.amount_kobo,
         claimed.network, claimed.product_type, claimed.service_id,
         claimed.variation_code, claimed.recipient_phone;
end;
$vtu$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Restrict it.
revoke all on function public.claim_vtu_provider_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_vtu_provider_attempt(uuid, text) to service_role;

-- Before production use, review table grants/Data API exposure, RLS advisors,
-- phone-number retention, refund workflow, provider request-ID format, and atomic
-- request creation. Do not grant direct table writes to anon/authenticated.

-- HarvestHome Universal Wallet foundation
-- DRAFT ONLY: do not run against production until server-side deposit verification,
-- webhook idempotency, and wallet purchase orchestration have been reviewed.
-- Amounts are stored as integer kobo to match Paystack's minor-unit API.

begin;

create table if not exists public.wallet_accounts (
  user_id uuid primary key references auth.users(id) on delete restrict,
  balance_kobo bigint not null default 0 check (balance_kobo >= 0),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'active' check (status in ('active', 'frozen')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('deposit', 'purchase', 'refund', 'reversal')),
  amount_kobo bigint not null check (amount_kobo > 0),
  balance_after_kobo bigint not null check (balance_after_kobo >= 0),
  reference text not null unique,
  provider_reference text unique,
  service text,
  status text not null default 'posted' check (status = 'posted'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists wallet_transactions_user_created_idx
  on public.wallet_transactions (user_id, created_at desc);

alter table public.wallet_accounts enable row level security;
alter table public.wallet_transactions enable row level security;

revoke all on public.wallet_accounts from anon, authenticated;
revoke all on public.wallet_transactions from anon, authenticated;
grant select on public.wallet_accounts to authenticated;
grant select on public.wallet_transactions to authenticated;
grant all on public.wallet_accounts to service_role;
grant all on public.wallet_transactions to service_role;

drop policy if exists "Users can read their own wallet" on public.wallet_accounts;
create policy "Users can read their own wallet"
  on public.wallet_accounts for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own wallet transactions" on public.wallet_transactions;
create policy "Users can read their own wallet transactions"
  on public.wallet_transactions for select to authenticated
  using ((select auth.uid()) = user_id);

-- Credits a wallet after a trusted server has independently verified the exact
-- successful Paystack transaction. Idempotent by local and provider reference.
create or replace function public.wallet_credit_deposit(
  p_user_id uuid,
  p_amount_kobo bigint,
  p_reference text,
  p_provider_reference text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_existing public.wallet_transactions%rowtype;
begin
  if p_user_id is null or p_amount_kobo is null or p_amount_kobo <= 0
     or coalesce(trim(p_reference), '') = ''
     or coalesce(trim(p_provider_reference), '') = '' then
    raise exception 'Invalid wallet deposit details';
  end if;

  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_existing
  from public.wallet_transactions
  where reference = p_reference
  for update;

  if found then
    if v_existing.user_id = p_user_id
       and v_existing.kind = 'deposit'
       and v_existing.amount_kobo = p_amount_kobo
       and v_existing.provider_reference = p_provider_reference then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'transaction_id', v_existing.id,
        'balance_after_kobo', v_existing.balance_after_kobo
      );
    end if;
    raise exception 'Wallet reference has already been used';
  end if;

  select * into v_existing
  from public.wallet_transactions
  where provider_reference = p_provider_reference
  for update;

  if found then
    raise exception 'Provider payment reference has already been credited';
  end if;

  select balance_kobo into v_balance
  from public.wallet_accounts
  where user_id = p_user_id and status = 'active'
  for update;

  if not found then
    raise exception 'Wallet is unavailable';
  end if;

  update public.wallet_accounts
  set balance_kobo = balance_kobo + p_amount_kobo,
      updated_at = now()
  where user_id = p_user_id
  returning balance_kobo into v_balance;

  insert into public.wallet_transactions (
    user_id, kind, amount_kobo, balance_after_kobo,
    reference, provider_reference, service, metadata
  ) values (
    p_user_id, 'deposit', p_amount_kobo, v_balance,
    p_reference, p_provider_reference, 'wallet_funding',
    jsonb_build_object('source', 'verified_paystack')
  );

  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'balance_after_kobo', v_balance
  );
end;
$$;

-- Debits are server-only. The calling purchase service must verify user identity,
-- current retail price, service availability, and idempotency before calling.
create or replace function public.wallet_debit_purchase(
  p_user_id uuid,
  p_amount_kobo bigint,
  p_reference text,
  p_service text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance bigint;
  v_existing public.wallet_transactions%rowtype;
begin
  if p_user_id is null or p_amount_kobo is null or p_amount_kobo <= 0
     or coalesce(trim(p_reference), '') = ''
     or coalesce(trim(p_service), '') = '' then
    raise exception 'Invalid wallet purchase details';
  end if;

  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into v_existing
  from public.wallet_transactions
  where reference = p_reference
  for update;

  if found then
    if v_existing.user_id = p_user_id
       and v_existing.kind = 'purchase'
       and v_existing.amount_kobo = p_amount_kobo
       and v_existing.service = p_service then
      return jsonb_build_object(
        'ok', true, 'idempotent', true,
        'transaction_id', v_existing.id,
        'balance_after_kobo', v_existing.balance_after_kobo
      );
    end if;
    raise exception 'Wallet reference has already been used';
  end if;

  update public.wallet_accounts
  set balance_kobo = balance_kobo - p_amount_kobo,
      updated_at = now()
  where user_id = p_user_id
    and status = 'active'
    and balance_kobo >= p_amount_kobo
  returning balance_kobo into v_balance;

  if not found then
    raise exception 'Insufficient balance or wallet unavailable';
  end if;

  insert into public.wallet_transactions (
    user_id, kind, amount_kobo, balance_after_kobo,
    reference, service, metadata
  ) values (
    p_user_id, 'purchase', p_amount_kobo, v_balance,
    p_reference, p_service, coalesce(p_metadata, '{}'::jsonb)
  );

  return jsonb_build_object(
    'ok', true, 'idempotent', false,
    'balance_after_kobo', v_balance
  );
end;
$$;

-- SECURITY DEFINER functions are not browser APIs. Only trusted server-side
-- code using the service_role may invoke these RPCs.
revoke all on function public.wallet_credit_deposit(uuid, bigint, text, text)
  from public, anon, authenticated;
revoke all on function public.wallet_debit_purchase(uuid, bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.wallet_credit_deposit(uuid, bigint, text, text)
  to service_role;
grant execute on function public.wallet_debit_purchase(uuid, bigint, text, text, jsonb)
  to service_role;

commit;

-- HarvestHome wallet deposit intents and verified credit path
-- DRAFT ONLY: review with the base supabase/HarvestHome_Wallet_Foundation.sql.
-- Do not apply to production or deploy the Edge Functions until reviewed/tested.
-- Requires public.wallet_accounts and public.wallet_transactions from the base draft.

begin;

create table if not exists public.wallet_deposit_intents (
  reference text primary key,
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_kobo bigint not null check (amount_kobo between 10000 and 50000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  status text not null default 'pending'
    check (status in ('pending', 'initialized', 'success', 'failed', 'cancelled')),
  provider_reference text unique,
  authorization_url text,
  access_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists wallet_deposit_intents_user_created_idx
  on public.wallet_deposit_intents (user_id, created_at desc);

alter table public.wallet_deposit_intents enable row level security;
revoke all on public.wallet_deposit_intents from anon, authenticated;
grant all on public.wallet_deposit_intents to service_role;
drop policy if exists "Users can read own wallet deposit intents" on public.wallet_deposit_intents;
create policy "Users can read own wallet deposit intents"
  on public.wallet_deposit_intents for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.wallet_deposit_intents to authenticated;

-- Replaces the base draft function with a deposit-intent-bound, idempotent credit.
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
  v_intent public.wallet_deposit_intents%rowtype;
begin
  if p_user_id is null or p_amount_kobo is null or p_amount_kobo <= 0
     or coalesce(trim(p_reference), '') = ''
     or coalesce(trim(p_provider_reference), '') = '' then
    raise exception 'Invalid wallet deposit details';
  end if;

  select * into v_intent
  from public.wallet_deposit_intents
  where reference = p_reference
  for update;

  if not found or v_intent.user_id <> p_user_id
     or v_intent.amount_kobo <> p_amount_kobo
     or v_intent.currency <> 'NGN'
     or v_intent.provider_reference <> p_provider_reference
     or v_intent.status not in ('initialized', 'success') then
    raise exception 'Wallet deposit intent does not match verified payment';
  end if;

  select * into v_existing
  from public.wallet_transactions
  where reference = p_reference
  for update;

  if found then
    if v_existing.user_id = p_user_id and v_existing.kind = 'deposit'
       and v_existing.amount_kobo = p_amount_kobo
       and v_existing.provider_reference = p_provider_reference then
      return jsonb_build_object('ok', true, 'idempotent', true,
        'transaction_id', v_existing.id, 'balance_after_kobo', v_existing.balance_after_kobo);
    end if;
    raise exception 'Wallet reference has already been used';
  end if;

  if exists (select 1 from public.wallet_transactions
             where provider_reference = p_provider_reference) then
    raise exception 'Provider payment reference has already been credited';
  end if;

  insert into public.wallet_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select balance_kobo into v_balance
  from public.wallet_accounts
  where user_id = p_user_id and status = 'active'
  for update;
  if not found then raise exception 'Wallet is unavailable'; end if;

  update public.wallet_accounts
  set balance_kobo = balance_kobo + p_amount_kobo, updated_at = now()
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

  update public.wallet_deposit_intents
  set status = 'success', paid_at = coalesce(paid_at, now()), updated_at = now()
  where reference = p_reference;

  return jsonb_build_object('ok', true, 'idempotent', false, 'balance_after_kobo', v_balance);
end;
$$;

revoke all on function public.wallet_credit_deposit(uuid, bigint, text, text)
  from public, anon, authenticated;
grant execute on function public.wallet_credit_deposit(uuid, bigint, text, text)
  to service_role;

commit;

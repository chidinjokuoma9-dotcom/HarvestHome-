# HarvestHome Wallet Database Review

**Review status: NOT APPROVED FOR PRODUCTION.** This is a source-level review of draft SQL only. No SQL was executed and no Supabase schema was changed.

## Scope reviewed

- `supabase/HarvestHome_Wallet_Foundation.sql`
- `supabase/HarvestHome_Wallet_Deposit_Intents_DRAFT.sql`
- Wallet deposit initialize, verify, and webhook Edge Function drafts.

## Positive safeguards already present

- Wallet amounts use integer kobo and constrain balances to non-negative values.
- Wallet account rows are locked during balance updates.
- Wallet transaction references are unique; provider references are unique when present.
- The deposit-intent credit function locks the intent and atomically updates the wallet balance, writes the ledger row, and marks the intent successful.
- RLS is enabled and authenticated users have own-row read policies; browser roles are not granted direct table writes.
- Credit/debit RPC execution is revoked from public, anonymous, and authenticated roles and granted to `service_role`.
- Edge Function drafts verify user identity and server-side payment details; CI now runs `deno check`.

## Findings that block launch

### 1. SQL deployment order must be controlled

The base SQL defines `wallet_credit_deposit` without requiring a deposit intent. The second SQL file replaces it with the safer intent-bound implementation. If the base file were deployed alone, the weaker credit RPC would remain available to the server-side service role.

**Required:** Treat both files as one reviewed migration set; validate the final function definition in the isolated database before any test payment. Never apply the base file alone.

### 2. Deposit webhook can race initialization

The webhook only credits an intent once its provider reference and initialized status are saved. If Paystack's webhook arrives before the initialization update commits, the RPC rejects the credit. The draft returns an error so a provider retry may recover it, but this timing path has not been tested and cannot be assumed to recover automatically.

**Required:** In isolated Paystack test mode, test webhook-before-update, repeated webhook delivery, and a failed/timeout initialization update. Add a reconciliation path that re-verifies the transaction server-side and safely completes the intent; never credit from webhook metadata alone.

### 3. A successful Paystack initialization followed by a database-save failure needs reconciliation

The initialize function intentionally does not return a checkout URL unless the initialized intent update is confirmed. If Paystack initialized the transaction but the database update failed, the intent may remain pending while a provider transaction exists.

**Required:** Add an operator-safe reconciliation procedure for pending intents; verify status directly with Paystack and match exact reference, amount, currency, and metadata before repairing an intent. Do not blindly retry or credit a pending intent.

### 4. Wallet purchase debit is not a complete purchase workflow

The debit RPC can reduce balance and write a purchase ledger row, but it does not atomically create a supplier order, represent a pending provider outcome, reserve funds, or perform a refund/reversal after a supplier failure or timeout. Its idempotent response only proves a ledger reference exists, not that supplier delivery succeeded.

**Required:** Do not call this RPC from a customer purchase flow until a transaction/order state machine and audited refund/reversal process have been designed and tested. Never retry a supplier purchase blindly after an ambiguous timeout.

### 5. Ledger lifecycle and reconciliation are incomplete

The current ledger schema only permits `status = 'posted'`. It does not represent pending, failed, refunded, or reversed transactions as lifecycle states. A refund/reversal needs a separately referenced compensating ledger entry and consistent atomic balance update, not an edit or deletion of historical posted rows.

**Required:** Design the complete transaction/order schema and reconciliation reports before launching wallet spending. Define support procedures for duplicate, delayed, failed, and disputed provider results.

### 6. Runtime integration tests remain outstanding

Deno type-check and static source checks do not execute the SQL functions or prove Supabase RLS, RPC grants, Paystack signatures, or provider behavior.

**Required:** In an isolated test environment only, validate grants/RLS with different roles and test duplicate/concurrent credit, duplicate/concurrent debit, frozen wallets, wrong payment details, duplicate webhook, webhook race, and reconciliation. Keep production untouched.

## Required test matrix before any launch

- Apply the reviewed SQL to a disposable/approved test database and inspect the final `wallet_credit_deposit` definition and grants.
- Confirm anonymous and authenticated roles cannot write wallet tables or call credit/debit RPCs.
- Confirm users can read only their own account, ledger, and deposit intents.
- Submit the same verified deposit twice sequentially and concurrently; confirm exactly one ledger credit.
- Attempt to reuse a provider reference with a different local reference; confirm no second credit.
- Test frozen wallet, missing wallet, database failure, amount mismatch, currency mismatch, metadata mismatch, and uninitialized intent.
- Deliver webhook before, during, and after initialization persistence; confirm safe retry/reconciliation without duplicate credit.
- Test debit idempotency and insufficient balance; then test supplier success, failure, timeout, and refund/reversal using a separate order state machine.
- Reconcile provider transactions against intent records, wallet ledger, and account balances.

## Decision

**NOT READY FOR CUSTOMER PAYMENTS.** Keep wallet funding and spending disabled. This review does not authorize a production migration, Edge Function deployment, or Paystack webhook configuration. Any future isolated test deployment requires reviewed test credentials and an explicit go-ahead; production requires a separate explicit approval.

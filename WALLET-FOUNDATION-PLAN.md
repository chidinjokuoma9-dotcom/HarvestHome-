# HarvestHome Universal Wallet — Foundation Plan

Status: design and preview only. Do not deploy this to the live database or enable customer funding until the server-side payment and transaction flow is implemented and tested.

## Alignment with HarvestHome

- Keep all work on `feature/harvesthome-data-airtime-foundation` and its isolated Cloudflare preview.
- Preserve the public property marketplace, authentication, listings, media, enquiries, favourites, maps, moderation, rewards, and existing Paystack flows.
- Use the existing Supabase project architecture and Paystack integration, but do not replace or modify the live payment functions without reviewing their current behaviour.
- The universal wallet is intended to support approved services over time: airtime, data, eligible property listing promotions, and other supported HarvestHome services.
- Wallet balances are customer liabilities, never revenue or profit.

## Proposed flow

1. A signed-in user requests a wallet deposit. The server creates a unique reference and stores a pending deposit intent with the expected user, NGN amount, and reference.
2. Paystack initializes checkout server-side. Amounts must use Paystack's minor unit (kobo) in the provider request; the app must consistently distinguish naira from kobo.
3. After checkout, a server verifies the reference directly with Paystack and checks success status, exact amount, NGN currency, expected user/metadata, and the local pending intent.
4. A single database transaction credits the wallet ledger idempotently. A browser redirect alone must never credit a wallet. The Paystack webhook must be verified and use the same idempotent credit path.
5. A server-authorized service purchase checks current prices and supplier state, reserves/debits funds atomically, and records the order. A customer must never be able to set the balance, price, status, or supplier result from frontend code.
6. Uncertain supplier responses remain pending and are reconciled; they must not cause duplicate purchases or repeat charges. Failed purchases follow an audited refund/reversal process.
7. Wallet history shows transaction reference, type, amount, status, and time. Customer balance is derived/maintained only by trusted database functions.

## Security requirements before any live launch

- No public client may insert, update, or delete wallet balances or ledger rows.
- Row Level Security on wallet tables; signed-in users can read only their own wallet and history.
- Trusted credit/debit functions must be unavailable to anon/authenticated roles and callable only by the server-side service role.
- Use unique references and database transactions for idempotency and concurrent spending protection.
- Never store or expose Paystack secret, Supabase service-role key, or VTpass credentials in HTML, `Config.js`, GitHub, or chat.
- No cash withdrawal or wallet-to-wallet transfer in the first version. Those require separate fraud, reconciliation, and regulatory review.
- Clearly disclose any deposit/payment fees before a customer confirms a deposit.
- Reconcile Paystack deposits, wallet ledger, VTpass orders, refunds, and provider settlement.
- Test duplicate webhooks, duplicate verify requests, mismatched amount/currency/user, insufficient balance, concurrent spending, supplier timeouts, and refund retries.

## Staged files

- `wallet-preview.html`: UI-only design with disabled actions and sample numbers; no payment is collected.
- `supabase/HarvestHome_Wallet_Foundation.sql`: proposed database tables and server-only idempotent credit/debit functions. This is a draft for review and is NOT applied to Supabase.
- Next implementation step: build isolated wallet deposit-intent/Paystack verification functions and wallet history endpoint; review them alongside the existing payment and webhook functions before deployment. Then add wallet purchase orchestration for VTpass only after the product catalogue and pricing are confirmed.

## Launch gate

Do not launch or expose wallet funding on harvesthome.ng until the complete server-side path is implemented, test cases pass, and the owner explicitly approves moving the feature out of preview.

## Deposit implementation drafts added (not deployed)

- `supabase/functions/wallet-deposit-initialize/index.ts`: signed-in-user check, amount bounds (₦100–₦500,000), server-side Paystack initialization, unique HarvestHome reference, and server-side intent storage.
- `supabase/functions/wallet-deposit-verify/index.ts`: signed-in-user check, server-to-server Paystack verification, exact reference/amount/NGN/user metadata checks, and idempotent credit through the database RPC.
- `supabase/HarvestHome_Wallet_Deposit_Intents_DRAFT.sql`: pending deposit intent table and replacement credit RPC that binds the wallet credit to a matching verified deposit intent and marks it successful in the same database transaction.

These are source drafts only. They have **not** been deployed to Supabase, and no database schema has been applied. Before deployment, review production CORS origins, callback routing, SQL against the existing schema, webhook reuse of the same credit RPC, and the test checklist. Never enable customer deposits until duplicate/concurrent verification and failure paths have been tested in an isolated environment.


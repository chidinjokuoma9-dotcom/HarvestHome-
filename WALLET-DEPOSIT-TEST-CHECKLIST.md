# HarvestHome Wallet Deposit Test Checklist

**Status: NOT READY FOR CUSTOMER PAYMENTS.** This checklist documents required tests only; it is not evidence that tests have passed. The wallet SQL and Edge Function files are drafts and have not been applied or deployed.

## Before any test deployment
- [ ] Create an isolated test environment without paying for a Supabase branch unless the owner explicitly approves the cost.
- [ ] Review both SQL drafts against the actual schema and current RLS/Data API settings.
- [ ] Use Paystack test credentials only; keep all secrets in server-side environment secrets.
- [ ] Set `WALLET_ALLOWED_ORIGIN` to the exact test preview origin and `WALLET_CALLBACK_URL` to a HarvestHome-owned HTTPS URL.
- [ ] Confirm live marketplace payment functions and the existing Paystack webhook are unchanged.
- [ ] Compile/lint the Edge Functions using a pinned, reviewed toolchain.

## Deposit initialization tests
- [ ] Unauthenticated request is rejected.
- [ ] Amounts below ₦100, above ₦500,000, fractional naira, strings, and unsafe integers are rejected.
- [ ] Valid amount creates one pending intent with a unique `HHW_` reference.
- [ ] Paystack initialization must return the exact requested reference and a checkout URL.
- [ ] Failed provider initialization marks the intent failed where possible and does not return a checkout URL.
- [ ] Database update failure after provider initialization does not expose a success response; reconcile the orphan intent before retrying.
- [ ] Disallowed browser origins are rejected; no wildcard CORS is emitted.
- [ ] Callback URL is server-controlled and cannot be overridden by request data.

## Verification and credit tests
- [ ] User can verify only an intent belonging to their own account.
- [ ] Pending/uninitialized intent is rejected without attempting to credit.
- [ ] Provider timeout, invalid response, pending transaction, failed transaction, wrong reference, wrong amount, wrong currency, or mismatched metadata never credits the wallet.
- [ ] A successful exact-match test payment credits the wallet once.
- [ ] Repeating verification does not credit twice.
- [ ] Two concurrent verification requests credit only once.
- [ ] Existing provider reference cannot be reused for another deposit.
- [ ] Frozen/missing wallet and database failures do not produce a false success response.

## Webhook tests
- [ ] Invalid or missing HMAC-SHA512 signature is rejected.
- [ ] Non-`charge.success` events are safely ignored.
- [ ] Unrelated references are ignored and never credited.
- [ ] Unknown wallet reference, mismatched amount/currency/metadata, and uninitialized intent do not credit.
- [ ] Duplicate webhook delivery is idempotent.
- [ ] Webhook arriving before the initialization intent update is durably saved is retried/reconciled safely; it must never cause duplicate credit.
- [ ] Existing live `paystack-webhook` remains untouched.

## Wallet ledger and operational checks
- [ ] RLS allows a signed-in user to read only their own wallet and transactions.
- [ ] Anonymous/authenticated users cannot directly insert/update wallet balances or ledger rows.
- [ ] Only server-side service role can execute the credit RPC.
- [ ] Balance updates and ledger insertion occur atomically under row lock.
- [ ] Support can reconcile provider reference, internal reference, intent status, ledger row, and Paystack dashboard.
- [ ] Refund, reversal, timeout, and manual support procedures are documented before launch.

## Launch gate
Do not enable customer funding, wallet spending, airtime/data purchases, or real payments until the isolated end-to-end tests above pass, all unresolved findings are reviewed, and the owner explicitly approves launch.

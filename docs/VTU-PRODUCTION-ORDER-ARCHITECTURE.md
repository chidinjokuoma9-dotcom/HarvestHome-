# HarvestHome VTU — Production Order Architecture (Review Draft)

Status: **design only — not deployed, not a migration, and not enabled for customers.**

This draft records the minimum server-side controls required before any live VTpass order is accepted. It is deliberately separate from the working property marketplace and existing Paystack payment flows.

## Read-only project inventory (18 October 2026)

The connected HarvestHome Supabase project was inspected read-only before any schema implementation:

- The existing `public.payments` table is the marketplace's generic Paystack ledger. It has a unique nullable `reference`, integer `amount`, currency/status fields, and listing/seller references. Keep it and its existing payment handlers unchanged; do not repurpose its records for VTU purchases without a separate compatibility review.
- No existing public VTU order, provider-attempt, or customer-wallet tables were present in the public schema inventory.
- The active Edge Function list includes the sandbox-only `vtpass-test-airtime`, `vtpass-test-catalog`, and `vtpass-test-data-variations` functions, plus the status-only test function. No production VTpass customer-purchase function was listed.
- The existing `paystack-initialize`, `paystack-verify`, and `paystack-webhook` functions are active and serve existing HarvestHome flows. Do not modify them as part of VTU work until a separate integration design has been reviewed.
- The Supabase security advisor also reports existing marketplace-wide findings unrelated to VTU. They are not changed by this work and should not be bulk-fixed during this isolated integration.

This inventory was read-only. No table, policy, function, secret, or production setting was changed.

## Order record

Use one durable order row per intended customer purchase. Suggested fields:

- `id`: UUID generated server-side.
- `user_id`: authenticated owner.
- `product_type`: `airtime` or `data`.
- `network`, `service_id`, and a snapshot of the approved variation code/label.
- `customer_amount_kobo`: integer, positive; never floating-point currency.
- `currency`: currently `NGN`.
- `status`: controlled state such as `awaiting_payment`, `payment_verified`, `provider_pending`, `succeeded`, `failed`, `refund_pending`, `refunded`, or `manual_review`.
- `payment_reference`: unique Paystack reference.
- `payment_verified_at`: set only after trusted server-side verification.
- `provider_request_id`: generated once and protected by a unique constraint.
- `provider_attempt_count`: must not be incremented by a client; only a trusted server-side operation can claim an attempt.
- `provider_status`, `provider_response_code`, and a redacted provider-response snapshot for reconciliation.
- `created_at`, `updated_at`, and terminal timestamps.

Store the approved selling-price and catalogue snapshot with the order so later catalogue changes cannot alter an in-flight purchase. Never accept the price, owner ID, payment status, provider status, or commission from browser input.

## Database constraints and concurrency

Before production, a reviewed migration should enforce at least:

1. Positive integer customer amount and supported product/status values.
2. Unique payment reference where present.
3. Unique provider request ID where present.
4. Unique internal idempotency key per intended order.
5. Foreign key to the authenticated user where appropriate.
6. No direct client insert/update of orders, payments, provider attempts, refunds, or audit events.
7. A server-side atomic claim/transition operation that locks the order row and checks its current state before claiming the only provider attempt.

A generated request ID alone is not idempotency. The unique database constraint and atomic claim are the controls that prevent two concurrent requests from sending the same order twice.

## Required transaction flow

1. Create an order on the server from a server-approved catalogue item and price.
2. Initialize Paystack from the server using that stored order amount and reference.
3. Verify payment through a trusted server-side Paystack verification call and/or a correctly verified webhook. Enforce the exact reference, currency, amount, and successful status.
4. In a database transaction, atomically mark payment verified and claim the single provider attempt, recording the provider request ID before sending the purchase request.
5. Submit the VTpass request only after that claim succeeds.
6. Record the full result needed for reconciliation, with secrets and unnecessary personal data removed.
7. If delivered and payment is verified, mark succeeded exactly once.
8. If pending, timeout, network error, or contradictory status occurs, keep the order unresolved and re-query the same provider request ID. Never auto-submit a replacement purchase.
9. If provider reports failure after payment, reconcile the provider record and refund/reversal policy before closing the order.
10. Record every state change and reconciliation decision in an append-only audit/event table.

## Access control

- Keep order mutations in server-side Edge Functions only.
- Enable RLS on all exposed tables; do not create broad authenticated write policies.
- Prefer keeping audit and provider-response data in a private schema or deny direct client access entirely.
- Never expose Supabase service-role keys, Paystack secret keys, or VTpass credentials to the browser.
- A customer-facing status endpoint must return only that customer's own order and only the minimum safe fields.
- Do not mark an order fulfilled from the browser redirect or client-supplied status.

## Outstanding decisions before implementation

- Confirm the current project schema and any existing transaction tables to avoid duplicating or conflicting with them.
- Confirm the correct Paystack checkout/reference integration point without changing existing marketplace payments.
- Confirm VTpass live debit/commission rules, catalogue eligibility, and the three conflicting variation codes.
- Review applicable legal/payment requirements before introducing stored reseller balances; reseller wallets are a later, separate project.
- Agree the exact support/refund process and operational ownership.

## Explicit non-actions

This document does not create or alter database tables, deploy functions, configure live secrets, send live requests, activate customer checkout, or modify the production HarvestHome marketplace. Implementation requires a separate review against the actual schema and sandbox evidence.

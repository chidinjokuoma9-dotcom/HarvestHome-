# VTpass fulfilment safety contract

**Scope:** Development branch only. No production checkout, marketplace, or live provider configuration is changed by this document or the pure helper tests.

## Required separation of states

- `providerReportsDelivered` means the provider response was HTTP-successful, has provider code `000`, and reports status `delivered`.
- `paymentVerified` must be supplied independently by a trusted payment-verification step. A provider response cannot establish that a customer paid.
- `customerMayBeMarkedDelivered` is true only when both provider delivery and the explicit `paymentVerified: true` input are present.
- Pending, incomplete, HTTP-error, and contradictory provider responses remain pending/review and do not authorize customer fulfilment.
- Automatic retries remain disallowed by the helper. A pending/unclear result must be re-queried using the same request ID and reconciled before any further attempt.

## Tests

`scripts/vtpass-transaction-utils.test.mjs` verifies:
1. Provider delivery by itself does **not** authorize customer fulfilment.
2. The fulfilment signal requires both provider delivery and an explicit verified-payment flag.
3. Pending, failed, contradictory, HTTP-error, and incomplete responses never authorize fulfilment.
4. Automatic retries remain disabled in all tested outcomes.

This is a pure safety helper for development and review. It is not yet wired into a customer checkout or order-fulfilment flow. Do not treat these tests as proof of live VTpass delivery, live pricing, payment verification, or production readiness.

## Launch gate

Before customer sales are enabled, implement and test an order state machine that independently records the customer payment state and provider transaction state, uses idempotent order/request IDs, re-queries pending transactions without duplicate purchases, and reconciles refunds/reversals. Keep live purchases disabled until provider costs/commission and applicable payment fees are confirmed in writing and the owner explicitly approves launch.

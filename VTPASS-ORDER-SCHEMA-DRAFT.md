# HarvestHome VTU order persistence design (draft only)

**Status: design review; not applied to Supabase.** This draft is for the isolated VTU development branch. It does not enable checkout, create tables, alter existing marketplace tables, or touch Paystack production flows.

## Goals

- Persist one internal order before any provider purchase.
- Enforce unique payment references, internal idempotency keys, and non-null provider request IDs at the database level.
- Keep customer order reads restricted to the authenticated owner.
- Prevent browser clients from writing trusted payment/provider states.
- Keep ambiguous provider results pending/reviewable; never automatically submit a second purchase after timeout.
- Keep reseller balances out of the first direct-purchase launch.

## Proposed order fields

| Field | Purpose |
| --- | --- |
| `id uuid primary key` | Internal order ID, generated before payment initialization |
| `user_id uuid not null references auth.users(id)` | Authenticated purchaser |
| `idempotency_key text not null unique` | Stable internal key for create-order/payment initialization |
| `payment_reference text unique` | Paystack reference; assigned and verified server-side |
| `payment_status text` | `awaiting_payment / verified / failed / review` |
| `amount_minor bigint not null` | Exact customer amount in minor units (kobo); positive integer |
| `currency text not null default 'NGN'` | Currency |
| `service_type text not null` | `airtime / data` |
| `network text not null` | Allowlisted network identifier |
| `product_code text` | Allowlisted provider variation code for data |
| `phone_e164 text not null` | Validated recipient phone number |
| `provider_cost_minor bigint` | Nullable until wholesale debit is confirmed; server-only |
| `provider_request_id text unique` | Persist before/with first provider submission where the provider API permits |
| `provider_attempt_count integer not null default 0` | Audited attempt counter; enforce one purchase attempt in the initial launch |
| `provider_status text` | Normalized status from provider responses |
| `order_status text not null` | Controlled lifecycle listed below |
| `provider_response jsonb` | Sanitized response; never store secrets or credentials |
| `created_at / updated_at timestamptz` | Audit timestamps |

All money values must be integer minor units, never floating point. Product name, variation code, and price must be looked up and validated server-side from an approved catalogue; the browser cannot choose the provider cost or alter a confirmed order amount.

## Controlled states

- Payment: `awaiting_payment`, `verified`, `failed`, `review`
- Order: `awaiting_payment`, `payment_verified`, `provider_pending`, `succeeded`, `failed`, `refund_pending`, `refunded`, `manual_review`

State transitions must happen in trusted server-side handlers only. A browser redirect is not proof of payment. Verify Paystack status server-side, check the exact expected amount/currency/reference, and make webhook handling idempotent before moving an order to `payment_verified`.

## Required database protections

1. `UNIQUE(idempotency_key)` prevents duplicate order creation for the same client intent.
2. `UNIQUE(payment_reference)` where not null prevents a payment reference from attaching to multiple orders.
3. `UNIQUE(provider_request_id)` where not null prevents a provider request ID from being reused across orders.
4. Check constraints for positive amount, supported currency, allowed service type, allowed states, and non-negative attempt count.
5. Enable RLS. Authenticated users receive SELECT only for their own orders. No direct INSERT/UPDATE/DELETE grants or policies for browser clients. Trusted Edge Functions use server credentials and enforce authorization.
6. Avoid returning full provider response bodies to users; store a sanitized audit record.
7. Create order and request identifiers before contacting the provider. Use an atomic server-side claim/lock and unique constraint to ensure only one worker can submit the purchase.
8. For timeout, HTTP error, pending, or contradictory provider results, query the same provider request/reference and reconcile. Never automatically send a new purchase.
9. Persist an audit trail for payment verification, provider submission, status queries, refund/reversal and moderator intervention. Do not put API secrets, auth tokens, or unnecessary personal data in logs.

## Required flow before launch

1. Server creates an order using an allowlisted product and exact server-calculated selling price.
2. Server initializes Paystack with that order's unique reference and exact amount.
3. Server verifies payment with Paystack and validates reference, amount, currency, and status.
4. A transaction-safe claim marks the order eligible for exactly one provider attempt and persists the stable provider request ID.
5. Server submits one VTpass request.
6. Server stores a sanitized response and normalizes provider state.
7. Pending/ambiguous outcomes trigger status-only re-query of the existing request and reconciliation.
8. Customer is shown success only after verified payment plus confirmed provider delivery.
9. If the provider fails after payment, apply a documented refund/reversal procedure; do not silently retry the purchase.

## Explicit blockers / not yet approved

- VTpass has not yet confirmed the conflicting catalogue codes and actual live wallet debit/commission.
- Final retail prices and any target-profit claims are not approved until verified cost and payment-fee data are available.
- The existing test helpers do not replace a database lock, durable unique constraints, or server-side payment verification.
- No production schema, new live VTpass function, live credentials, or customer checkout is enabled by this draft.
- This draft must be reviewed against the actual Edge Function architecture, Supabase RLS/grants, and provider request semantics before conversion into a migration.
- Reseller wallet balances and reseller storefronts are intentionally deferred until ordinary direct purchases are reliable and compliance requirements for stored value have been reviewed.

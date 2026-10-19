# HarvestHome VTU order lifecycle — development only

**Scope:** Isolated Edge Function source, design contract and offline tests. The handlers are not deployed and customer purchases remain disabled. This work does not change the property marketplace or its existing Paystack handlers.

## Implemented in the development branch

- `supabase/functions/vtu-order-create/index.ts`: authenticates the user, validates the Nigerian phone and idempotency key, resolves the product key against a server-only approved catalogue configuration, and calls the idempotent `create_vtu_order` database function. The browser cannot set the amount, provider service ID or variation code.
- `supabase/functions/vtu-paystack-initialize/index.ts`: verifies order ownership, uses the stored order amount, reserves/reuses one Paystack reference, and initializes Paystack with VTU-specific metadata.
- `supabase/functions/vtu-paystack-verify/index.ts`: verifies Paystack server-side against the stored reference, integer-kobo amount, NGN currency, user ID, order ID and `service: vtu`; then calls the atomic payment-state transition function. It deliberately does not contact VTpass.
- `supabase/functions/vtu-vtpass-sandbox-fulfil/index.ts`: sandbox-only, feature-flagged fulfilment/re-query handler. It reserves a single request ID before a purchase, re-queries an existing request ID instead of submitting again, stores a redacted response snapshot, and calls an atomic database function to persist the result and audit event.
- `supabase/functions/_shared/vtu-config.ts`: validates server-side catalogue entries and Nigerian phone numbers, and provides an explicit browser-origin allowlist.
- `scripts/vtu-order-create-safety.test.mjs` and `scripts/vtu-edge-handler-safety.test.mjs`: offline safeguards included in the GitHub Actions workflow.
- `docs/VTU-ORDER-SCHEMA-DRAFT.sql`: still a review-only draft with idempotent order creation, payment-reference reservation, payment-verification transition, one-time provider-attempt reservation, and atomic provider-result/audit recording. It stores retail `amount_kobo` separately from `provider_amount_kobo`; the latter is the amount passed in the VTpass request and is not the same as actual provider wallet cost.

## Safe order sequence

1. **Create an internal order record first.** The client sends only a product key, phone and idempotency key. The server must resolve all price and provider fields from approved server-side configuration.
2. **Initialize Paystack against the stored order.** The server reserves one reference, uses the stored integer-kobo amount, and attaches the exact order/user/service metadata.
3. **Verify payment server-side.** Never trust a browser redirect or front-end success message. Verify exact reference, amount, currency, owner, order and service metadata with Paystack, then persist the transition atomically.
4. **Submit one provider purchase only after a separate fulfillment handler is reviewed.** The provider request ID must be reserved in the database before the first VTpass call.
5. **Handle provider outcomes conservatively.** Delivered requires the provider's success code and delivered status. Pending/timeout/contradictory results require re-query of the same request ID and reconciliation; never auto-submit a replacement purchase.
6. **Persist an audit trail.** Record order ID, payment reference and verification result, provider request ID, response code/status, timestamps and state changes. Never log API secrets or unnecessary personal information.
7. **Notify only from persisted state.** Customer-facing success requires both verified payment and confirmed provider delivery.

## Required environment configuration (not set or enabled here)

- `VTU_CHECKOUT_ENABLED` must remain unset/false until all release gates are approved.
- `VTPASS_VTU_CATALOGUE_JSON` must contain only reviewed, active catalogue entries and server-approved retail prices in integer kobo. Do not treat VTpass `variation_amount` as wholesale cost until VTpass confirms the actual wallet debit.
- `VTU_ALLOWED_ORIGINS` must explicitly list the approved website origins.
- `VTU_CALLBACK_URL` must be an HTTPS callback on HarvestHome's approved domain.
- Existing Supabase and Paystack credentials must remain server-side; no service-role or provider secrets belong in the browser.

## What is not finished yet

- The schema has **not** been run against Supabase, and the new handlers have **not** been deployed.
- The sandbox-only VTpass fulfillment handler is source code only; it is not deployed, its feature flags remain off, and it cannot call the live VTpass API.
- No customer checkout UI or payment callback page has been connected.
- The exact VTpass request amount/payload still needs provider confirmation; the fulfilment handler requires an explicit approved payload flag before it can send even a sandbox request.
- Provider wallet debits, commissions, live commercial resale approval and final retail prices remain unconfirmed.
- Database-level concurrency, transition, failure/refund, RLS/grant and retention checks are still required before a migration or launch.

## Release gates

- Confirm VTpass commercial API resale approval and actual account-specific wallet debits/commission in writing.
- Confirm Paystack permits the intended airtime/data sales model.
- Complete the legal/regulatory and business/tax review; do not add reseller deposits or stored-value wallets in phase one.
- Review the SQL draft and test it against an isolated database; verify RLS, grants and security advisors.
- Confirm VTpass request payload semantics and actual wallet debit/commission; then exercise the sandbox-only fulfillment/status-reconciliation path, including timeout and duplicate callback tests.
- Test duplicate taps, duplicate payment callbacks, concurrent provider claims, payment success/provider failure, timeout/pending, refund review and manual reconciliation.
- Keep all customer purchases disabled until the owner explicitly approves the release.

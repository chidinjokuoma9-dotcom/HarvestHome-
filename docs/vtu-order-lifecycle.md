# HarvestHome VTU order lifecycle — development only

**Scope:** Design contract and offline tests only. This document does not activate customer purchases, connect Paystack checkout, or change the property marketplace.

## Safe order sequence

1. **Create an internal order record first.** Use a unique HarvestHome order ID and persist a single provider request ID before the first provider call. Enforce a database uniqueness constraint for the internal order ID and provider request ID so duplicate taps/retries cannot create another purchase.
2. **Verify payment server-side.** Never trust a browser redirect, client-supplied boolean, or front-end success message. A trusted server-side Paystack verification must match the internal order, amount, currency, and reference.
3. **Submit one provider purchase.** Only a verified paid order may become eligible. The actual provider call must use the persisted request ID and approved catalogue variation. Do not expose provider credentials in the browser.
4. **Handle the result conservatively.**
   - Provider code 000 plus status delivered: record provider delivery, then reconcile with verified payment.
   - Pending/initiated/processing: keep pending and re-query the same request ID; do not buy again.
   - HTTP timeout, missing fields, or conflicting code/status: mark for review and query the same request ID.
   - Provider failure after successful payment: mark for reconciliation/refund review. Do not automatically repeat the provider purchase.
5. **Persist an audit trail.** Record order ID, payment reference and verification result, provider request ID, provider transaction ID, response code/status, timestamps, and state changes. Do not log API secrets or unnecessary customer information.
6. **Notify only from persisted state.** Customer-facing success must be based on server-side persisted payment verification and provider delivery, not a client-side response alone.

## Offline safeguards added

- scripts/vtu-order-state.mjs expresses conservative state decisions.
- scripts/vtu-paystack-verification.mjs strictly validates Paystack's server verification response against the stored reference, integer-kobo amount, NGN currency, expected user, order ID, and explicit VTU service metadata. It is pure testable logic and is not yet wired into an Edge Function.
- scripts/vtu-order-state.test.mjs tests unpaid orders, request-ID prerequisite, successful delivery, pending, failed, contradictory and HTTP-error cases.
- scripts/vtpass-transaction-utils.mjs and its tests keep provider delivery separate from payment verification.
- GitHub Actions workflow .github/workflows/vtpass-catalogue-tests.yml runs catalogue, transaction-safety and order-state tests.

These handlers are **not deployed and not wired into the production/customer order flow**. They remain disabled unless an environment flag is explicitly set, and cannot work until the reviewed database schema is migrated. No VTpass fulfillment handler or customer UI is enabled. Passing offline tests cannot prove a live provider transaction, Paystack verification, database uniqueness, or refund handling. Those require integration tests in the isolated development environment.

## Next integration gates

- Confirm the current Supabase schema and existing payment/order paths before adding tables or changing production code.
- Finish and review the server-approved catalogue/price source before accepting any order; provider `variation_amount` has not been confirmed as wholesale cost.
- Add and test failure/cancellation/refund transitions, state constraints, and timestamp/retention handling.
- Add a server-approved catalogue/price source and isolated order-creation endpoint; current provider costs are not yet confirmed.
- Implement and test the separate VTpass fulfillment/re-query/reconciliation handler; the current Paystack verifier intentionally stops after payment verification.
- Run database-level tests for duplicate references, concurrent claims and duplicate callbacks before considering a migration.
- Test duplicate clicks, webhook retries, provider timeouts, pending re-query, payment success/provider failure, and reconciliation.
- Keep VTpass live credentials and customer purchases disabled until provider costs/commission are clarified, pricing is approved, and the owner explicitly authorizes launch.

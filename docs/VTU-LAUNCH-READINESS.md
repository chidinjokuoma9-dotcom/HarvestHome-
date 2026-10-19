# HarvestHome VTpass launch-readiness register

**Updated:** 2026-10-19  
**Branch:** `feature/harvesthome-data-airtime-foundation`  
**Decision:** NOT READY for public checkout. Keep customer purchases disabled.

## What has been verified

- The isolated VTpass preview deployment workflow completed successfully.
- The offline catalogue, order lifecycle, Paystack verification, order creation, fulfilment safety, customer-preview safety, and Deno type-check workflow completed successfully on commit `1054c0f5f60ef7fcd14d6d6659ddd11676b747ed`.
- A read-only inspection of the connected HarvestHome Supabase project confirmed there are currently no `public.vtu_*` tables or functions. The production database currently has existing marketplace tables and functions, so the VTU schema draft has not been applied.
- The deployed Supabase Edge Function inventory does not include the new `vtu-order-create`, `vtu-paystack-initialize`, `vtu-paystack-verify`, or `vtu-vtpass-sandbox-fulfil` handlers. They remain development source only.
- The isolated Cloudflare preview workflow succeeded; it is not the production HarvestHome Worker.

## Release gates — all must be closed

### A. Commercial/provider confirmation — BLOCKED

- [ ] Obtain written VTpass approval to resell airtime/data through the API to HarvestHome customers.
- [ ] Confirm the actual account-specific VTpass wallet debit for each product and clarify the airtime sandbox discrepancy.
- [ ] Confirm product variation codes, payload fields, sandbox/live differences, and official pending/failed/requery/refund handling.
- [ ] Confirm any Paystack terms or approvals needed for the airtime/data sales model.
- [ ] Do not approve retail prices until provider debit and Paystack fees are known. Target contribution is at least ₦30 only where verified costs allow a customer-friendly price.

The draft support request is `docs/vtpass-support-clarification-request.md`. It has been prepared in the repository but has **not** been sent to VTpass.

### B. Database design and migration — BLOCKED

- [ ] Finish the SQL state machine, including explicit payment failure/cancellation/refund transitions and valid state-combination constraints.
- [ ] Correctly distinguish request-ID reservation from actual provider submission time.
- [ ] Review all function signatures and privileges against the Edge Function source.
- [ ] Test RLS, column grants, security-definer/invoker behaviour, idempotency and concurrent claims in an isolated database.
- [ ] Review phone-number retention, provider-response redaction, audit-event access, and Supabase security advisors.
- [ ] Only then prepare a migration and apply it in a safe test environment first.

**Cost constraint:** no paid Supabase branch or other paid resource should be created without explicit agreement to the cost. Do not apply the draft to the production marketplace database as a shortcut.

### C. Payment-to-delivery integration — BLOCKED

- [ ] Deploy only the VTU-specific handlers after the schema and secrets are approved; do not modify the existing marketplace Paystack functions.
- [ ] Keep live VTpass endpoints unavailable in the sandbox handler.
- [ ] Test order creation, Paystack initialization and server-side verification, duplicate callbacks, concurrent provider claims, provider timeout, re-query, failure/refund review, and manual reconciliation.
- [ ] Ensure a timeout or uncertain status never triggers a second purchase request.
- [ ] Confirm successful customer status only after both payment verification and provider delivery are persisted.
- [ ] Obtain the owner's explicit approval before enabling customer checkout or live credentials.

## Product and architecture decisions already made

- Phase 1 uses direct Paystack payment per order; no customer wallet.
- Reseller wallets, deposits, reseller links and storefronts are later-phase work, after provider/commercial/legal review.
- VTpass only; the customer preview must not direct users back to the retired MELE DATA diagnostic.
- Keep the property marketplace, seller verification, chat, existing feature-listing payments, and AdSense untouched.
- Do not publish final prices based on sandbox `variation_amount` or assumed commission.

## Current customer-facing status

The customer shop is a visual preview only. It does not create an order, collect payment, or fulfil a VTpass purchase. The signed-in data catalogue page is a read-only test surface. No live VTU purchases are enabled.

## Useful development links

- Preview shop: https://vtpass-test-harvesthome.chidinjokuoma9.workers.dev/shop.html
- Read-only data catalogue: https://vtpass-test-harvesthome.chidinjokuoma9.workers.dev/vtpass-data-test.html
- Development branch: https://github.com/chidinjokuoma9-dotcom/HarvestHome-/tree/feature/harvesthome-data-airtime-foundation
- Latest successful safety workflow: https://github.com/chidinjokuoma9-dotcom/HarvestHome-/actions/runs/39322553018
- Successful isolated preview deployment: https://github.com/chidinjokuoma9-dotcom/HarvestHome-/actions/runs/39321969836

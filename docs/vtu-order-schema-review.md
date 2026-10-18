# HarvestHome VTU Order Schema — Pre-Migration Review

**Status:** Review notes only. No SQL has been run against Supabase, no migration has been created, and no customer checkout or live VTpass fulfilment has been enabled.

## Scope and protections

This draft supports direct per-order customer payments in phase 1. It must remain isolated from HarvestHome's existing property marketplace, feature-listing Paystack payments, seller verification, chat, and AdSense.

## Findings from review of `docs/VTU-ORDER-SCHEMA-DRAFT.sql`

### Good safeguards already present

- Customer and provider amounts are represented as integer kobo, with currency constrained to NGN.
- Order idempotency key, Paystack payment reference, and provider request ID have unique constraints.
- Provider attempts are capped at one in the schema, and the claim function only accepts a verified payment in the expected pre-fulfilment state.
- The provider request ID is reserved in the database before the caller should make a VTpass purchase request.
- Client roles have no direct insert/update permissions; RLS restricts customer reads to the customer's own orders.
- Provider cost, payment fee, provider identifiers, and raw provider responses are not in the customer's column-level SELECT grant.
- The provider-attempt claim function is not executable by anon/authenticated roles.

### Required before this draft becomes a migration

1. **Tie payment and order states together.** Add constraints or enforceable transition logic so invalid combinations (for example, a failed payment with an order marked `payment_verified`) cannot be stored. Define the allowed transitions for payment verification, cancellation, provider pending, success, failure, refund, and manual review.
2. **Make attempt reservation and audit logging atomic.** The current claim function updates the order but does not insert a matching `vtu_order_events` row in the same transaction. Revise it so a successful claim and its audit event either both commit or both roll back.
3. **Clarify timestamps.** `provider_submitted_at` should mean the actual provider request was sent, not merely that a request ID was reserved. Track reservation separately or document a precise lifecycle; a process crash between reservation and HTTP submission must go to manual reconciliation rather than an automatic retry.
4. **Define server-side state transition rules.** Only trusted handlers should change statuses. Make the handler verify Paystack server-side, validate the order amount/currency and ownership, and make duplicate payment webhooks idempotent before it can claim an attempt.
5. **Set and test `updated_at`.** The draft has no trigger, so every trusted update must set it explicitly or a controlled trigger must be added.
6. **Keep raw provider data private.** Store only what reconciliation needs, redact secrets and unnecessary personal data from raw responses/events, and define a retention period for recipient phone numbers.
7. **Check grants and RLS in the actual project.** Before any migration, confirm role grants, exposed-schema/Data API settings, RLS behavior, and database advisors against the connected Supabase project. Do not broaden client privileges to fix a server-side permission issue.
8. **Test the exact concurrency and failure cases.** Verify two simultaneous claim attempts yield exactly one winner; a repeated Paystack webhook does not create a second order; provider timeout/pending responses never trigger an automatic duplicate vend; and refunds/reconciliation are explicit states rather than inferred success.

## Current decision

Keep this SQL as a design draft. Do not run it in Supabase, do not enable live provider credentials, and do not publish final customer prices until the above issues are resolved and the VTpass wallet debit and applicable Paystack fees are confirmed. The target remains at least ₦30 contribution on eligible plans after verified costs, not an assumed profit on every catalogue item.

## Verified isolated preview

The dedicated development-only Cloudflare Worker deployment completed successfully on 2026-10-18. The production Worker and `harvesthome.ng` were not deployed. Customer purchases remain disabled.

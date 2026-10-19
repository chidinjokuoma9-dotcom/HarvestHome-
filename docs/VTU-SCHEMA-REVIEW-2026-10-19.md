# VTU SQL draft review — 2026-10-19

**Scope:** Static review of `docs/VTU-ORDER-SCHEMA-DRAFT.sql` and its current test coverage.
**Environment:** Source-only review. No production SQL was executed and no Supabase schema was changed.
**Decision:** Keep the draft out of migrations and do not deploy the VTU Edge Functions yet.

## Findings to fix before migration

### 1. Payment and order states can contradict each other — HIGH

The table checks each status against its own list, but does not constrain valid combinations. For example, the schema can represent a `payment_status='awaiting_payment'` order with `order_status='succeeded'`, or a `payment_status='verified'` order with `order_status='refunded'` without a corresponding payment refund state.

**Required:** Add a reviewed state-transition model and table-level combination constraints. Define explicit, audited transitions for payment failure, cancellation, refund requested, refund confirmed, and manual review. Reject impossible transitions in SQL, not only in Edge Function code.

### 2. Provider reservation is marked pending before submission — HIGH

`claim_vtu_provider_attempt` changes `order_status` to `provider_pending` before the external HTTP request is made. The draft comment correctly says the request ID is only reserved, but the stored status can mislead reconciliation and support.

**Required:** Separate request-ID reservation from confirmed submission. Add distinct reservation and submission timestamps/events; only mark submission after the handler is ready to issue the request, and preserve a safe “outcome unknown” path if the network fails after the request may have left the server. Never automatically send a second purchase for an uncertain outcome.

### 3. Provider-result transitions are too permissive — HIGH

`record_vtu_provider_result` accepts updates from `provider_pending`, `manual_review`, and `refund_pending` to any allowed result, including `succeeded`. This can move a refund-review order back to succeeded, or overwrite a manual-review state without a deliberately authorized reconciliation transition.

**Required:** Specify allowed transitions by current state and action. Keep ordinary re-query updates separate from moderator reconciliation and refund actions. Make event keys unique and deterministic, and define how duplicate re-query results are handled without losing the audit trail.

### 4. Provider response and phone privacy — HIGH

The draft stores a provider response JSON object and recipient phone number. It does not enforce response redaction or define retention/deletion limits. A raw provider response could include more personal or operational data than the customer needs.

**Required:** Sanitize responses in the Edge Function before persistence; never store credentials, authorization headers, secrets, or unnecessary personal data. Document role-based access, retention periods, phone masking in customer views/logs, and deletion/retention obligations.

### 5. Provider-attempt invariant is one-directional — MEDIUM

The current constraint ensures an attempt count above zero has a request ID, but does not ensure a non-null request ID implies an attempt count of one.

**Required:** Enforce both directions (or use a stronger state/attempt record design) and test invalid combinations. Confirm provider request-ID uniqueness and the provider's accepted format/length before finalizing the column.

### 6. Input validation is incomplete at the database boundary — MEDIUM

The order creation function validates required text and product type, but does not itself validate normalized Nigerian phone format, approved `service_id`/variation combinations, or a server-owned approved catalogue version. The comments rely on the trusted Edge Function to do this.

**Required:** Keep price and catalogue selection server-side; add the strongest feasible SQL validation without duplicating a fast-changing provider catalogue unsafely. Test that unapproved service IDs and mismatched product/variation pairs cannot be purchased through the trusted path.

### 7. Failure and refund paths are not implemented — HIGH

The draft currently lacks complete SQL transitions for payment failure/cancellation, refund initiation/confirmation, provider definitive failure, provider timeout/uncertain result, and manual reconciliation.

**Required:** Design idempotent functions and atomic audit events for these paths before connecting real payments. Never report a customer refund as complete until the payment provider confirms it.

### 8. Current tests are mainly source-text assertions — MEDIUM

The schema tests check for expected SQL strings, not actual PostgreSQL execution, row-level security behaviour, grants, transaction rollback, or concurrent calls.

**Required:** Run the migration draft in a disposable local PostgreSQL/Supabase-compatible test database at no additional cloud cost where possible. Test role grants/RLS, duplicate idempotency keys, duplicate payment references, concurrent provider claims, audit-event rollback, invalid state combinations, and duplicate callbacks. Then run Supabase security advisors before any migration approval.

## Provider/commercial gate remains separate

Even a correct schema does not authorize live sales. Written VTpass confirmation is still needed for commercial resale, account-specific wallet debit, catalogue mapping, airtime commission fields, pending/re-query/refund rules, and live API provisioning. Paystack terms and applicable business requirements must also be checked. Retail prices remain unapproved until actual costs are known.

## Protected scope

Do not modify the live property marketplace, existing property-feature Paystack handlers, seller verification, chat, or AdSense for this work. No customer or reseller wallet is introduced in phase one. Customer checkout and live VTpass calls remain disabled pending explicit owner approval.

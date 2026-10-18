# HarvestHome VTU — VTpass Sandbox Integration Plan

Status: **sandbox validation in progress; customer checkout and live purchases remain disabled.** This document and the associated code are on the development branch and isolated preview only.

## Current safety gates

- Keep VTU work on `feature/harvesthome-data-airtime-foundation` and the isolated Cloudflare preview.
- Do not deploy VTU purchase code to the public HarvestHome marketplace yet.
- Never put provider credentials, Paystack secret keys, service-role keys, or customer payment details in browser code or GitHub.
- Do not switch to VTpass live endpoints or fund a live provider wallet during sandbox testing.
- Do not charge customers or deliver real airtime/data until supplier costs, product catalogue, pricing, payment verification, duplicate protection, and support/refund handling are reviewed.
- Existing HarvestHome marketplace listings, seller verification, chat, payments, and AdSense must remain untouched.

## Completed sandbox evidence (18 October 2026)

Four fixed ₦100 airtime requests were sent to the VTpass **sandbox** using the test recipient configured in the isolated test page. The responses reported code `000` and status `delivered`.

| Network | Sandbox request ID | Reported commission | Reported `total_amount` | Evidence |
|---|---|---:|---:|---|
| MTN | `202610182116aacecef8a1` | Conflicting: initial response about ₦3.50; status response ₦4 | ₦96.50 | Sandbox response and status re-query returned delivered |
| Airtel | `2026101821392ca6fa8713` | ₦3 (3%) | ₦97 | Sandbox response and status re-query returned delivered |
| Glo | `20261018215009e7af09ed` | ₦3 (3%) | ₦97 | Initial sandbox response returned delivered; status re-query still to be recorded |
| 9mobile | `202610182141c09701eabc` | ₦3 (3%) | ₦97 | Initial sandbox response returned delivered; separate status re-query still to be recorded |

These are **sandbox-reported values only**. They do not establish live-account debit, live commissions, customer eligibility, or real-world delivery. In particular, VTpass must explain the differing MTN commission fields and confirm how `total_amount` relates to the actual wallet debit.

The isolated test page supports one attempted test per network per page session and status-only re-query. This is a testing guard, not durable production idempotency.

## Data catalogue duplicate handling

The read-only preview fetches the canonical `content.variations` array only and does not merge the provider's misspelled `varations` alias. Exact duplicate rows are collapsed; conflicting variation codes are quarantined as a whole; ambiguous plans receive no customer price and remain unpublished. The reusable helper now compares variation codes case-insensitively, with regression coverage.

Known conflicts quarantined from candidate plans until VTpass clarifies them:

- MTN: `mtn-xtratalk-300` — weekly ₦300 and 3-day ₦200 descriptions share one code.
- Glo: `glo-mega-75000` — conflicting 675GB/₦75,000 and 1TB/₦100,000 descriptions share one code.
- 9mobile: `eti-1000` — conflicting 1.5GB/30-day and 4GB (including night data) descriptions share one code.

Do not publish these plans or infer which description is correct. Special, SME, night, app-specific, video, voice, and combined bundles need clear labels and provider eligibility confirmation. Catalogue amounts must not be assumed to be wholesale cost just because they are shown as a variation amount or marked fixed-price.

## Transaction lifecycle safety work (development branch only)

Added pure review helpers in `scripts/vtu-transaction-state.mjs` and offline regression tests in `scripts/vtu-transaction-state.test.mjs`. The helpers define allowed state transitions, preserve core transaction identity fields, require verified payment and an exact amount match before a provider attempt, reject a second attempt when a provider request already exists, and direct pending/timeouts to status re-query rather than automatic resubmission. The local Node test run passed all 8 tests.

**Important limitation:** these helpers are not a production transaction system. They do not persist orders, lock rows atomically, verify Paystack payments, or guarantee provider idempotency. Production still requires a reviewed database schema with unique constraints and atomic server-side handling. No Supabase schema, production function, live provider call, or live customer checkout was changed or enabled by this work.

## Acceptance checklist

- [x] Server-side sandbox requests work without exposing provider credentials in browser code.
- [x] Correct sandbox host used for the four airtime test requests.
- [x] One initial successful sandbox airtime response for each of MTN, Airtel, Glo, and 9mobile.
- [x] Status re-query confirmed delivered for MTN and Airtel without submitting a new purchase.
- [x] Duplicate variation-code handling and offline regression tests pass; GitHub Actions run 39166187558 completed successfully.
- [x] The isolated preview has no customer checkout/purchase action.
- [ ] Record a status-only re-query for Glo and 9mobile, without sending new purchases.
- [ ] VTpass support confirms actual live wallet debit, commission calculations, and the three conflicting catalogue codes.
- [ ] Verify eligible product categories and restrictions for SME, night, social/app-specific, TV/VOD, binge, combined, and long-validity bundles.
- [ ] Review the full data catalogue for sizes, validity, duplicates, and labels.
- [ ] Confirm provider costs and calculate retail prices after the actual applicable payment fees; target at least ₦30 contribution only where the verified economics permit it.
- [ ] Exercise provider pending, failed, timeout, and no-response paths without duplicate fulfillment or automatic purchase retries.
- [ ] Implement persistent server-side order/request IDs, unique constraints/idempotency, safe status re-query, reconciliation, and audit records before any customer purchase.
- [ ] Integrate Paystack only after the above: server-side initialization, trusted verification/webhook, exact amount matching, one-time fulfillment, and safe pending/failed handling.
- [ ] Document customer support, refunds/reversals, and reconciliation.
- [ ] Obtain explicit approval before any live provider credentials, live provider requests, production integration, or customer checkout are enabled.

## Provider support questions still open

A support response received so far only says the complaint was forwarded to the appropriate department. It does not resolve the issues. Follow up for written confirmation of:
1. Whether `variation_amount` is customer retail amount, reseller debit, or another catalogue value.
2. The actual wallet debit and commission calculation for airtime, including the MTN discrepancy.
3. The three duplicate/conflicting variation codes listed above.
4. Eligibility/restrictions and sandbox-versus-live differences for special bundle categories.

## Previous MELE DATA issue

MELE DATA's sandbox airtime request returned “Insufficient wallet balance” despite the dashboard displaying a ₦1,000,000 test balance. That discrepancy remains unresolved. VTpass is the current sandbox candidate; do not switch to live credentials to investigate the MELE issue.

## Launch rule

A working-looking page or a successful sandbox response is not proof of a safe live VTU service. Keep customer purchase buttons disabled until the remaining acceptance items above are verified. The public HarvestHome marketplace and its existing live Paystack features must not be changed as part of sandbox work.

# HarvestHome VTU — VTpass Sandbox Integration Plan

Status: preparation only. This document is on the development branch; it does not enable live transactions.

## Current safety gates

- Keep all VTU work on `feature/harvesthome-data-airtime-foundation` and the isolated Cloudflare preview.
- Do not deploy VTU code to the public HarvestHome marketplace yet.
- Do not put provider credentials, Paystack secret keys, service-role keys, or customer payment details in browser code or GitHub.
- Do not switch to VTpass live endpoints or fund a live provider wallet during sandbox testing.
- Do not charge customers or deliver real airtime/data until sandbox results, pricing, payment verification, duplicate protection, and support/refund handling are reviewed.

## Why VTpass is the next candidate

VTpass publishes a sandbox environment and API documentation for Nigerian airtime and data. Its official integration guide says to complete sandbox tests before requesting live provisioning. This is a candidate to test, not a claim that it is already approved or reliable for HarvestHome.

Official references:
- https://vtpass.com/documentation/integrating-api/
- https://vtpass.com/documentation/introduction/
- https://vtpass.com/documentation/
- https://sandbox.vtpass.com/

## Required account setup

1. Create a VTpass sandbox account at https://sandbox.vtpass.com/register.
2. Sign in and request/access the sandbox API credentials from the sandbox developer area.
3. Keep the credentials private. Never paste them into this file, a GitHub issue, frontend HTML, or a public chat.
4. Once available, store them only as server-side secrets for the HarvestHome Supabase project, using separate sandbox-only secret names. Do not add live credentials.
5. Verify the sandbox base URL is `https://sandbox.vtpass.com/api/` before running any request.

HarvestHome still needs to review provider terms, fees, product coverage, funding requirements, and support arrangements before any production decision.

## Integration sequence

1. Read the current official authentication, request-ID, product variation, purchase, and transaction-requery documentation.
2. Implement a server-side-only adapter; the browser must never call VTpass with credentials.
3. Fetch supported product/variation information in sandbox and compare provider cost, plan name, data size, and validity with HarvestHome's catalogue.
4. Test only with VTpass's documented sandbox scenarios and sandbox credentials. Never send test calls to the live base URL.
5. Persist an internal transaction reference and use idempotency/duplicate protection before provider requests.
6. Treat success, pending, timeout, no-response, and failed responses as distinct states. Query status before retrying ambiguous transactions; never blindly repeat a purchase.
7. Reconcile provider cost and any fees before calculating retail prices. Do not publish prices until provider costs are confirmed.
8. Only after sandbox evidence is reviewed, design the Paystack payment flow: server-side payment initialization, verified webhook/status, amount matching, one-time fulfillment, and safe handling of pending/failed payments.
9. Conduct a final review and obtain explicit approval before any production credentials, live provider requests, or customer checkout are enabled.

## Sandbox acceptance checklist

- [ ] Sandbox credentials are configured as server-side secrets only.
- [ ] Correct sandbox host and authentication verified.
- [ ] Airtime test success scenario verified.
- [ ] Airtime failure and pending scenarios verified.
- [ ] Timeout/no-response scenario handled without duplicate fulfillment.
- [ ] Data catalogue/variation list and pricing reconciled.
- [ ] Transaction requery/status handling verified.
- [ ] Duplicate submission/idempotency tests pass.
- [ ] Provider errors do not expose credentials or internal details to customers.
- [ ] No customer payment or live delivery can be triggered from the preview.
- [ ] Paystack flow tested separately in its own test mode and server-side verification confirmed.
- [ ] Manual support, reversal/refund, and reconciliation procedure documented.

## Current known blocker

MELE DATA's sandbox airtime request returned “Insufficient wallet balance” even though its dashboard reported a ₦1,000,000 test balance. That discrepancy remains unresolved, so do not use MELE DATA as the sole launch dependency or switch to live credentials to investigate it.

## Launch rule

A working-looking page is not proof of a safe VTU service. Keep the customer purchase button disabled until the supplier sandbox, prices, payment verification, transaction-state handling, and support process have all passed review.

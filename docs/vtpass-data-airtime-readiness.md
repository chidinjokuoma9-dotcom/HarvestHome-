# HarvestHome VTpass Data & Airtime Readiness

**Environment:** Development branch and VTpass sandbox only  
**Production status:** Unchanged  
**Customer purchases:** Disabled  
**Live provider credentials:** Not enabled  
**Last review:** 2026-10-18

## Current result

- **Data catalogue retrieval:** Sandbox responses succeeded for MTN, Airtel, Glo and 9mobile (service ID 'etisalat-data'), each with provider code '000', HTTP 200, and read-only/purchases-disabled flags in the response shared during testing.
- **Airtime sandbox test:** A ₦100 MTN airtime sandbox test previously returned provider code '000', status 'delivered', commission '3.5', and total_amount '96.5'. This is evidence that the specific sandbox test worked; it is not proof of live delivery or live commission terms.
- **Offline helper tests:** The branch contains a Node.js test suite and a GitHub Actions workflow to run it. Do not describe CI as passed unless a completed green run is visible in GitHub Actions.

## Latest engineering checks — 2026-10-18

- The isolated Cloudflare preview deployment completed successfully for commit `63ac2d9ce223e85b79dd58b2d47b10dbdf7cf288`; the latest airtime page with the status-only button is included in that deployment.
- GitHub Actions validation passed for the preview page and safety guards at commit `b94232d3196e3f9746773b3f9bca203ec409ca2a`.
- The VTpass catalogue helper test workflow passed for commit `a2395ceb9cd53a6d11b8baf998b1be76b21d95a3`.
- Supabase lists `vtpass-test-airtime-status` as ACTIVE, version 1, with JWT verification enabled. Its code calls the sandbox `/api/requery` endpoint only and contains no purchase endpoint.
- **Not yet confirmed:** a live call to the status-only endpoint against the previously returned request ID. No repeat airtime purchase has been sent to verify it. Do not claim status re-query has passed until the provider returns a response for that request ID.

## Catalogue review snapshot

The user-shared catalogue responses included approximately:
- MTN data: 37 entries
- Airtel data: 26 entries
- Glo: 60+ entries
- 9mobile data: 18 entries

These are counts from the responses reviewed, not a guarantee that VTpass's current catalogue has the same entries. Use only canonical 'content.variations'; do not merge the repeated misspelled 'varations' property.

### Variation codes that must stay quarantined

- MTN: 'mtn-xtratalk-300' — two different Xtratalk descriptions/amounts.
- Glo: 'glo-mega-75000' — conflicting 675GB/₦75,000 and 1TB/₦100,000 descriptions.
- 9mobile: 'eti-1000' — conflicting 1.5GB and 4GB-with-night-data descriptions.

Additional review flags:
- MTN 'mtn-1tb-110000': name and variation code appear inconsistent about the amount.
- Airtel voice bundle codes must not appear in the ordinary data list.
- Glo TV/VOD, social/app-specific, night, SME, special and voice-style bundles must be correctly separated and labelled.
- Confirm plan capacity, validity, restrictions, variation code and actual provider charge with VTpass before publishing.

## Pricing gate

HarvestHome's target is at least **₦30 contribution on eligible plans after applicable Paystack fees and other transaction costs**, while remaining competitive. This is a target, not a promise that every catalogue item can meet it.

Calculate only after confirming the actual provider cost and current applicable Paystack fee:

'estimated contribution = customer price - confirmed provider cost - applicable Paystack fee - other transaction costs'

Use tiered pricing rather than one flat markup. Keep original decimal provider amounts for reconciliation. Do not mark prices final based solely on catalogue amounts or the sample fee function in the offline unit test.

## Before customer-facing launch

1. Re-fetch and compare each complete canonical catalogue against the saved review; quarantine any newly conflicting variation codes.
2. Confirm wholesale/provider charges, bundle eligibility, size, validity and special restrictions with VTpass.
3. Confirm Paystack fee calculations using the current applicable fee rules and account setup.
4. Test sandbox airtime and data purchase paths, status re-query, duplicate-request/idempotency protection, timeouts, failed/reversed transactions and reconciliation. The restricted airtime page includes a separate status-only endpoint; it does not submit another airtime purchase. The restricted airtime page now includes a status-only re-query button for the saved test request ID.
5. Ensure a failed or pending provider transaction cannot silently be shown as delivered or cause a duplicate customer charge.
6. Confirm secrets remain server-side and are never exposed in the browser or committed to GitHub.
7. Keep the test page noindex and isolated from the production marketplace.
8. Obtain the owner's explicit approval before any live credentials, live purchases or production deployment are enabled.

## Scope protection

This review is documentation only. Do not alter HarvestHome's existing marketplace listings, Paystack feature-listing payments, seller verification, chat, or AdSense integration as part of VTpass testing.

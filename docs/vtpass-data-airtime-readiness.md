# HarvestHome VTpass Data & Airtime Readiness

**Environment:** Development branch and VTpass sandbox only  
**Production status:** Unchanged  
**Customer purchases:** Disabled  
**Live provider credentials:** Not enabled  
**Last review:** 2026-10-18

## Current result

- **Data catalogue retrieval:** Sandbox responses succeeded for MTN, Airtel, Glo and 9mobile (service ID 'etisalat-data'), each with provider code '000', HTTP 200, and read-only/purchases-disabled flags in the response shared during testing.
- **Airtime sandbox tests:** Two user-shared ₦100 MTN sandbox responses reported provider code `000`, status `delivered`, commission `3.5`, and `total_amount` `96.5`. Request IDs: `2026101808275045f5dbc5` and the earlier test request ID was not retained in the latest pasted result. These are sandbox results only; they do not prove live delivery or live commission terms.
- **Existing airtime transaction status re-query confirmed by user:** Request ID `2026101808275045f5dbc5` returned HTTP 200, provider code `000`, description `TRANSACTION SUCCESSFUL`, and status `delivered`. The status-only check did not submit a new purchase. The re-query response reports MTN Airtime VTU, test recipient `08011111111`, amount ₦100, `total_amount` 96.5, `commission` 4, and `commission_details.rate` `3.50` percent. These are sandbox-only results, not proof of live delivery or live commercial terms. The returned commission amount and rate details are not fully consistent; confirm the provider's commission/settlement interpretation before using it in pricing.\n- **Offline helper tests:** The branch contains a Node.js test suite and a GitHub Actions workflow to run it. Do not describe CI as passed unless a completed green run is visible in GitHub Actions.

## Latest engineering checks — 2026-10-18

- The VTU hub link was corrected so the data catalogue button opens `/vtpass-data-test.html` instead of the old root page.
- The preview deployment completed successfully for commit `8eccf5e17382211454dae92c86befd3168d80802`; the updated VTU hub is included in the isolated preview. The production Worker and `harvesthome.ng` were not deployed.
- The first validation run after the hub-link correction failed because the safety validator still expected the old root-page link. The validator was updated to require the correct VTpass data test link, and the new validation run passed for commit `2f5ff9b327ba9672ca013021203d7fb5242b0e6b`.

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

Paystack's official Nigeria pricing currently states local transactions are 1.5% + ₦100, with the ₦100 component waived for transactions under ₦2,500 and local transaction fees capped at ₦2,000. The exact fee must still be verified against HarvestHome's configured payment channel and checkout behavior before final prices are published. Official reference: https://support.paystack.com/en/articles/2130306

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

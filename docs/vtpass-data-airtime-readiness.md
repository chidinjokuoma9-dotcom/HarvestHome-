# HarvestHome VTpass Data & Airtime Readiness

**Environment:** Development branch and VTpass sandbox only  
**Production status:** Unchanged  
**Customer purchases:** Disabled  
**Live provider credentials:** Not enabled  
**Last review:** 2026-10-18

## Current result

- **Data catalogue retrieval:** Sandbox responses succeeded for MTN, Airtel, Glo and 9mobile (service ID 'etisalat-data'), each with provider code '000', HTTP 200, and read-only/purchases-disabled flags in the response shared during testing.
- **Airtime sandbox tests:** Two user-shared ₦100 MTN sandbox responses reported provider code `000`, status `delivered`, commission `3.5`, and `total_amount` `96.5`. Request IDs: `2026101808275045f5dbc5` and the earlier test request ID was not retained in the latest pasted result. These are sandbox results only; they do not prove live delivery or live commission terms.
- **Existing airtime transaction status re-query confirmed by user:** Request ID `2026101808275045f5dbc5` returned HTTP 200, provider code `000`, description `TRANSACTION SUCCESSFUL`, and status `delivered`. The status-only check did not submit a new purchase. The re-query response reports MTN Airtime VTU, test recipient `08011111111`, amount ₦100, `total_amount` 96.5, `commission` 4, and `commission_details.rate` `3.50` percent. These are sandbox-only results, not proof of live delivery or live commercial terms. The returned commission amount and rate details are not fully consistent: `amount` ₦100 minus `total_amount` ₦96.50 implies a ₦3.50 deduction, while `commission` and `commission_details.amount` report ₦4 and the rate is 3.50%. VTpass's own published re-query example also illustrates that commission fields can differ in displayed examples; its commission guide says `commission_details.amount` is the actual discount applied. Treat the transaction's actual net wallet debit/ledger and written VTpass clarification as authoritative before pricing. References: https://vtpass.com/documentation/re-query-services/ and https://vtpass.com/documentation/understanding-how-vtpass-commission-works.\n- **Offline helper tests:** The branch contains a Node.js test suite and a GitHub Actions workflow to run it. Do not describe CI as passed unless a completed green run is visible in GitHub Actions.

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

These are counts from the responses reviewed, not a guarantee that VTpass's current catalogue has the same entries. Use only canonical `content.variations`; do not merge the repeated misspelled `varations` property.

### MTN catalogue review — user-shared sandbox response (2026-10-18)

The response's canonical `content.variations` array contains **37 entries**. The repeated misspelled `varations` property was not counted as a second catalogue and must not be merged.

Keep these entries unavailable for publication until checked:
- **Duplicate-code conflict:** `mtn-xtratalk-300` appears twice: `MTN N300 Xtratalk Weekly Bundle` at ₦300 and `MTN N200 Xtratalk - 3 days` at ₦200. The code cannot safely identify one plan.
- **Name/code size conflicts:** `mtn-100mb-1000` is named 1.5GB; `mtn-500mb-2000` is named 4.5GB; `mtn-20hrs-1500` is named 6GB; `mtn-1gb-3500` is named 10GB; `mtn-100hr-5000` is named 15GB; and `mtn-3gb-6000` is named 20GB. Confirm provider mapping rather than trusting code fragments.
- **Amount/code conflict:** `mtn-1tb-110000` is named ₦100,000 for 1TB but the code suggests ₦110,000.
- **Category separation:** Xtratalk and Xtradata entries are not ordinary data bundles and should be labelled/separated according to their actual service benefit. The `mtn-120gb-22000` plan also mentions 80 minutes and needs accurate combined-plan labelling.
- **Large/long-validity offers:** SME plans, 100GB/2-month, 160GB/2-month, 400GB/3-month, 600GB/3-month and 1TB/1-year offers need explicit validity/eligibility confirmation.

The catalogue shows `variation_amount` values such as ₦100, ₦1,000 and ₦2,500, but it does **not** establish that these are HarvestHome's wholesale debit costs or our reseller net costs. Keep customer prices null and publication disabled until VTpass confirms the actual amount debited for each variation and the plan identity is verified.

### Airtel catalogue review — user-shared sandbox response (2026-10-18)

The canonical `content.variations` array contains **26 entries**: 22 data/binge-data entries and 4 voice bundles. The repeated misspelled `varations` property duplicates the same catalogue and must not be counted or merged.

Review findings:
- **Separate voice bundles:** `airt-voice-100`, `airt-voice-200`, `airt-voice-500`, and `airt-voice-1000` are voice bundles, not data plans. Exclude them from the data catalogue.
- **Keep different validity periods separate:** Examples include 1.5GB for 30 days (`airt-1000`) versus 1.5GB for 7 days (`airt-1000-7)); 7GB for 7 days (`airt-2000-7`) differs from the 4.5GB 30-day plan (`airt-2000`).
- **Binge plan:** `airt-1500-2` is described as 6GB for 7 days; retain its distinct name/validity rather than merging it with the standard 3GB 30-day `airt-1500`.
- **Fractional amounts:** Several returned `variation_amount` values are decimals slightly below their rounded marketing amounts (for example, `airt-50` is 49.99 and `airt-200` is 199.03). Preserve the exact returned amount for reconciliation; do not round it or assume it is HarvestHome's wholesale debit cost.
- **No obvious repeated variation code** appears in the canonical 26-row Airtel array, but this is only a review of the user-shared snapshot; re-check the live sandbox catalogue before publication.
- **Pricing and plan verification:** The catalogue labels entries `fixedPrice: Yes`, but that does not establish HarvestHome's wholesale cost, net commission, customer price, or final eligibility. Keep all customer prices null and plans unpublished until provider charges, exact bundle terms, and payment fees are confirmed.

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

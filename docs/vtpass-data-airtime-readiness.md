# HarvestHome VTpass Data & Airtime Readiness

**Environment:** Development branch and VTpass sandbox only  
**Production status:** Unchanged  
**Customer purchases:** Disabled  
**Live provider credentials:** Not enabled  
**Last review:** 2026-10-18
**Owner decision:** Three ambiguous variation codes are excluded from HarvestHome's candidate catalogue, not awaiting resolution.

## Current result

- **Data catalogue retrieval:** Sandbox responses succeeded for MTN, Airtel, Glo and 9mobile (service ID 'etisalat-data'), each with provider code '000', HTTP 200, and read-only/purchases-disabled flags in the response shared during testing.
- **Airtime sandbox tests:** Two user-shared ₦100 MTN sandbox responses reported provider code `000`, status `delivered`, commission `3.5`, and `total_amount` `96.5`. Request IDs: `2026101808275045f5dbc5` and the earlier test request ID was not retained in the latest pasted result. These are sandbox results only; they do not prove live delivery or live commission terms.
- **Existing airtime transaction status re-query confirmed by user:** Request ID `2026101808275045f5dbc5` returned HTTP 200, provider code `000`, description `TRANSACTION SUCCESSFUL`, and status `delivered`. The status-only check did not submit a new purchase. The re-query response reports MTN Airtime VTU, test recipient `08011111111`, amount ₦100, `total_amount` 96.5, `commission` 4, and `commission_details.rate` `3.50` percent. These are sandbox-only results, not proof of live delivery or live commercial terms. The returned commission amount and rate details are not fully consistent: `amount` ₦100 minus `total_amount` ₦96.50 implies a ₦3.50 deduction, while `commission` and `commission_details.amount` report ₦4 and the rate is 3.50%. VTpass's own published re-query example also illustrates that commission fields can differ in displayed examples; its commission guide says `commission_details.amount` is the actual discount applied. Treat the transaction's actual net wallet debit/ledger and written VTpass clarification as authoritative before pricing. References: https://vtpass.com/documentation/re-query-services/ and https://vtpass.com/documentation/understanding-how-vtpass-commission-works.
- **Offline helper tests:** GitHub Actions run **39110375547** completed successfully for commit `c2e7e463222afcd5cfd7f8e20b06952ab0c1ce4a` (workflow run #11). The tests include combined data-and-voice classification and separate Xtradata classification. This confirms offline helper tests passed; it does not validate live VTpass costs or transactions.
- **Support clarification draft:** `docs/vtpass-support-clarification-request.md` contains the questions to send VTpass about actual wallet debit, the airtime commission discrepancy, plan restrictions, and sandbox-versus-live terms. The three conflicting variation codes are excluded by owner decision and are no longer being submitted for correction. No support ticket has been submitted from this workflow.

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
- **Owner-excluded code:** `mtn-xtratalk-300` is permanently excluded from HarvestHome's candidate catalogue because it appeared against two different Xtratalk offers. Do not offer either row.
- **Name/code size conflicts:** `mtn-100mb-1000` is named 1.5GB; `mtn-500mb-2000` is named 4.5GB; `mtn-20hrs-1500` is named 6GB; `mtn-1gb-3500` is named 10GB; `mtn-100hr-5000` is named 15GB; and `mtn-3gb-6000` is named 20GB. Confirm provider mapping rather than trusting code fragments.
- **Amount/code conflict:** `mtn-1tb-110000` is named ₦100,000 for 1TB but the code suggests ₦110,000.
- **Category separation:** Xtratalk and Xtradata entries are not ordinary data bundles and should be labelled/separated according to their actual service benefit. The `mtn-120gb-22000` plan also mentions 80 minutes and needs accurate combined-plan labelling.
- **Large/long-validity offers:** SME plans, 100GB/2-month, 160GB/2-month, 400GB/3-month, 600GB/3-month and 1TB/1-year offers need explicit validity/eligibility confirmation.

The catalogue shows `variation_amount` values such as ₦100, ₦1,000 and ₦2,500, but it does **not** establish that these are HarvestHome's wholesale debit costs or our reseller net costs. Keep customer prices null and publication disabled until VTpass confirms the actual amount debited for each variation and the plan identity is verified.

### Airtel catalogue review — user-shared sandbox response (2026-10-18)

The canonical `content.variations` array contains **26 entries**: 22 data/binge-data entries and 4 voice bundles. The repeated misspelled `varations` property duplicates the same catalogue and must not be counted or merged.

Review findings:
- **Separate voice bundles:** `airt-voice-100`, `airt-voice-200`, `airt-voice-500`, and `airt-voice-1000` are voice bundles, not data plans. Exclude them from the data catalogue.
- **Keep different validity periods separate:** Examples include 1.5GB for 30 days (`airt-1000`) versus 1.5GB for 7 days (`airt-1000-7`); 7GB for 7 days (`airt-2000-7`) differs from the 4.5GB 30-day plan (`airt-2000`).
- **Binge plan:** `airt-1500-2` is described as 6GB for 7 days; retain its distinct name/validity rather than merging it with the standard 3GB 30-day `airt-1500`.
- **Fractional amounts:** Several returned `variation_amount` values are decimals slightly below their rounded marketing amounts (for example, `airt-50` is 49.99 and `airt-200` is 199.03). Preserve the exact returned amount for reconciliation; do not round it or assume it is HarvestHome's wholesale debit cost.
- **No obvious repeated variation code** appears in the canonical 26-row Airtel array, but this is only a review of the user-shared snapshot; re-check the live sandbox catalogue before publication.
- **Pricing and plan verification:** The catalogue labels entries `fixedPrice: Yes`, but that does not establish HarvestHome's wholesale cost, net commission, customer price, or final eligibility. Keep all customer prices null and plans unpublished until provider charges, exact bundle terms, and payment fees are confirmed.

### Glo catalogue review — user-shared sandbox response (2026-10-18)

The canonical `content.variations` array was reviewed from the user's sandbox response. The repeated misspelled `varations` property duplicates the same catalogue and must not be counted or merged. This response contains a mixed catalogue, not just ordinary data bundles.

Review findings:
- **Owner-excluded code:** `glo-mega-75000` is permanently excluded because it appeared against both a 675GB/₦75,000 offer and a 1TB/₦100,000 offer. Do not offer either row.
- **Keep SME separate:** Codes such as `glo-dg-70`, `glo-dg-320`, `glo-dg-960`, `glo-dg-3100`, `glo-dg-640`, `glo-dg-160-14`, and `glo-dg-1600` are explicitly labelled SME and should be identified as such, with eligibility/transfer restrictions confirmed before sale.
- **Separate night and time-limited offers:** `glo-daily-*`, `glo-2days-*`, `glo-2weeks-*`, and `glo-monthly-*` include combined day/night data or specific one-off validity. Do not advertise combined data as fully anytime data; verify the validity wording.
- **Separate special, weekend, and mega offers:** `glo-special-*`, `glo-weekend-500`, and `glo-mega-*` should retain their category and restrictions in the customer-facing label.
- **Exclude non-general-data products from ordinary data bundles:** `glo-tv-*` are TV/VOD offers; `glo-wtf-*`, `glo-telegram-*`, `glo-insta-*`, `glo-tiktok-*`, `glo-opera-*`, `glo-youtube-*`, and `glo-social-oneoff-*` are app-, service-, or social-specific offers and need clear category labels. Do not mix them into a plain anytime-data list.
- **Price is not wholesale cost:** Even where `variation_amount` is a round naira amount and `fixedPrice` is `Yes`, this response does not prove HarvestHome's provider debit or net reseller cost. Keep customer prices null and publication disabled pending provider confirmation.
- **No other duplicate code was confirmed in this snapshot** beyond `glo-mega-75000`; re-check the canonical array before publication.

### 9mobile catalogue review — user-shared sandbox response (2026-10-18)

The canonical `content.variations` array contains **18 entries**. The repeated misspelled `varations` property repeats the same rows and must not be counted or merged.

Review findings:
- **Owner-excluded code:** `eti-1000` is permanently excluded because it appeared against both a 1.5GB/30-day offer and a 4GB bundle with night data. Do not offer either row.
- **Different offer terms must stay distinct:** `eti-500` is described as 500MB for 30 days, while `eti-200` is 650MB for 1 day. Preserve each plan's exact stated size and validity rather than infer from code or price.
- **Night-data bundle:** `eti-2500` is 11GB total with 7GB + 4GB night; `eti-1500-7` is 7GB with 6GB + 1GB night. Clearly explain any time-of-day restrictions.
- **Combined bundle:** `eti-150-1` is described as 200MB (100MB + 100MB night) plus 300 seconds, so it must not be presented as a plain data-only plan without disclosing the voice component and restrictions.
- **Long-validity plans:** `eti-27500` (30GB/90 days), `eti-55000` (60GB/180 days), and `eti-110000` (120GB/365 days) need their exact validity and eligibility verified before listing.
- **Catalogue is not wholesale pricing:** `variation_amount` and `fixedPrice: Yes` do not establish HarvestHome's actual provider debit or net reseller cost. Keep customer prices null and publication disabled until VTpass confirms the charge and plan mapping.
- No other duplicate variation code is evident in this 18-row canonical snapshot, but re-check before publication.

### Variation codes permanently excluded by owner decision

- MTN: `mtn-xtratalk-300` — excluded entirely; neither offer should appear.
- Glo: `glo-mega-75000` — excluded entirely; neither offer should appear.
- 9mobile: `eti-1000` — excluded entirely; neither offer should appear.

The catalogue helper now enforces this owner blocklist even if a future provider response contains only one row for a blocked code. This is a candidate-catalogue safety rule; no live checkout is enabled.

Additional review flags:
- MTN 'mtn-1tb-110000': name and variation code appear inconsistent about the amount.
- Airtel voice bundle codes must not appear in the ordinary data list.
- Glo TV/VOD, social/app-specific, night, SME, special and voice-style bundles must be correctly separated and labelled.
- Confirm plan capacity, validity, restrictions, variation code and actual provider charge with VTpass before publishing.

## VTpass clarification required before final prices

Ask VTpass support to confirm these items in writing before customer prices or live transactions are enabled:

1. For each data `variation_code`, is `variation_amount` the end-user retail amount, the reseller debit, or another reference amount? What exact amount will be deducted from HarvestHome's VTpass wallet for one successful vend?
2. What is HarvestHome's actual airtime commission/net debit on a ₦100 MTN VTU transaction? The sandbox re-query returned `total_amount: 96.5` but `commission: 4` and `commission_details.rate: 3.50`; please explain which ledger field determines the actual wallet debit.
4. Confirm whether the SME, night-data, social/app-specific, TV/VOD, binge, combined data/voice and long-validity offers are available to this account and disclose their exact restrictions.
5. Confirm whether sandbox commission and variation values match live account pricing, and provide the live fee/commission schedule for this account.

Until these answers are received and reconciled against a test transaction's actual wallet ledger, the catalogue helper must keep customer prices null and all plans unpublished.

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


## Additional transaction-outcome safeguards — 2026-10-18

- Added pure helper `scripts/vtpass-transaction-utils.mjs` and offline tests. The helper classifies a response as delivered only when the HTTP request succeeded, provider code is `000`, and provider status is `delivered`.
- Pending/in-progress responses require status re-query; provider-reported failed responses are not marked delivered; contradictory or incomplete responses remain in review. Automatic retry is always disallowed by this helper to avoid duplicate transactions.
- This is a tested safety utility, not yet wired into customer checkout or production fulfilment. It does not verify Paystack payment, prove a provider wallet debit, or authorize live purchases. Existing marketplace and production configuration remain unchanged.
- The GitHub Actions workflow now runs both catalogue helper tests and transaction-outcome safety tests on relevant development-branch changes.

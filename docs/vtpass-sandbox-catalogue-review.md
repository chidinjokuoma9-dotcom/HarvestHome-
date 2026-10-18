# HarvestHome VTpass Sandbox Catalogue Review

**Status:** Development-only review notes, based on the four read-only sandbox responses shared during testing.  
**Scope:** MTN Data, Airtel Data, Glo Data, and 9mobile Data.  
**Safety:** This document does not enable purchases, change provider credentials, alter Paystack, or deploy to the production site. All retail prices remain unapproved.

## Sandbox request results

All four shared responses reported:
- `ok: true`
- `mode: sandbox`
- `readOnly: true`
- `purchasesEnabled: false`
- Provider HTTP status 200
- Provider response code `000`

This confirms that catalogue retrieval worked in sandbox for all four networks. It does **not** prove that every plan can be purchased or delivered successfully.

## Required catalogue-cleanup rules

1. Use the canonical `content.variations` array only. The provider response also repeats the same catalogue under the misspelled `varations` property; do not concatenate both arrays.
2. Treat `variation_code` as a provider identifier, not as a label. Never silently map one code to two different products.
3. Reject or quarantine conflicting codes until provider support confirms the correct mapping.
4. Parse amounts as numeric naira values but preserve the provider's original value for audit.
5. Keep bundle types distinct: standard data, SME, night-bonus bundles, social/app-specific bundles, video/streaming bundles, voice bundles, and other special products.
6. Do not invent validity periods. If the catalogue does not specify validity clearly, mark it for verification and do not publish the plan until confirmed.
7. Keep provider catalogue cost separate from HarvestHome's customer-facing retail price.
8. Do not publish a plan until its network, size, validity, type, variation code, provider cost, retail price, and eligibility are reviewed.
9. Before any eventual live rollout, test transaction status re-query, duplicate request/idempotency protection, timeouts, failed/reversed transactions, and customer support/reconciliation.
10. Keep purchases disabled until the owner explicitly approves live-launch work and all safeguards have been verified.

## Network-specific review flags

### MTN
- The response included both data plans and Xtratalk/voice-style products. Do not show voice bundles in the ordinary data catalogue.
- `mtn-xtratalk-300` appeared with conflicting descriptions and amounts (₦300 weekly Xtratalk and ₦200 three-day Xtratalk). Quarantine this code pending provider confirmation.
- The listed `mtn-1tb-110000` name indicated ₦100,000 while its code contained `110000`; confirm the authoritative amount and product mapping.
- Verify all plan names, capacities, validity, and eligibility with the provider before publishing.

### Airtel
- Voice bundle codes (`airt-voice-100`, `airt-voice-200`, `airt-voice-500`, `airt-voice-1000`) must not appear in the ordinary data catalogue.
- Keep plans with the same data size but different validity as separate products.
- Confirm unusual/large short-validity offers (including 7GB for 7 days and 25GB for 7 days) before publishing.
- Catalogue amounts such as 49.99 or 299.02 must not be rounded for provider reconciliation without preserving the original amount.

### Glo
- `glo-mega-75000` appears for two different products: 675GB for ₦75,000 and 1TB for ₦100,000. Quarantine both conflicting entries until VTpass confirms the correct code.
- The catalogue mixes standard data, SME, night-bonus, social/app-specific, Glo TV/VOD and other specialised bundles. Separate them into clearly labelled categories; do not present all as unrestricted general-purpose data.
- Some special plans do not state validity clearly. Verify before publication.

### 9mobile (provider service ID: `etisalat-data`)
- `eti-1000` appears for both 1.5GB (30 days) and 4GB (including 2GB night data). Quarantine both entries until VTpass confirms the correct variation code.
- Some products include night data or voice minutes. Label included bonuses accurately and do not imply all data is available at all times.
- The catalogue includes long-validity plans (90, 180 and 365 days); retain their stated validity only after verification.

## Pricing gate

HarvestHome's target is customer-friendly pricing with a goal of at least **₦30 net contribution on eligible plans after applicable Paystack fees and other transaction costs**. This is a target, not a guarantee. Calculate:

`estimated contribution = customer price - confirmed VTpass cost - applicable Paystack fee - other applicable transaction costs`

Do not approve a retail price until the applicable fee formula and actual provider cost are confirmed. Use tiered markups rather than a single flat markup, and avoid pricing plans out of line with comparable offers.

## Next steps before customer-facing implementation

- Capture the complete canonical variation list for each network and compare it with the raw sandbox response.
- Deduplicate the repeated `variations`/`varations` payload.
- Quarantine the conflicting variation codes listed above.
- Verify plan size, validity, bundle restrictions, provider cost, and code with VTpass.
- Build and test the catalogue normalisation and pricing calculation in the isolated development branch.
- Keep the test page noindex and isolated; do not alter the production marketplace, payments, seller verification, chat, or AdSense.
- Do not enable customer purchases or switch to live provider credentials without explicit approval.

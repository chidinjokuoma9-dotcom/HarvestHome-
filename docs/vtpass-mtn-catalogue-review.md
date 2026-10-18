# VTpass MTN Data Catalogue Review — Sandbox Snapshot

**Environment:** VTpass sandbox only  
**Service ID:** `mtn-data`  
**Observed response:** HTTP 200, provider response code `000`  
**Endpoint flags:** `mode: sandbox`, `readOnly: true`, `purchasesEnabled: false`  
**Decision:** Catalogue read succeeds. No plan in this snapshot is approved for customer sale yet.

## Important duplicate-code conflict

The same variation code, `mtn-xtratalk-300`, appears twice with contradictory details:

- `MTN N300 Xtratalk Weekly Bundle`, amount `300.00`
- `MTN N200 Xtratalk - 3 days`, amount `200.00`

**Action:** Quarantine this code from any customer-facing catalogue until VTpass confirms the correct unique variation code and product details. Do not choose either row arbitrarily.

## Catalogue classification

The response contains ordinary data, SME plans, long-validity plans, combined data/voice, Xtradata, and Xtratalk voice bundles. These must not all be treated as standard mobile data.

Examples visible in the snapshot:

| Variation code | Provider label | Amount shown | Review |
|---|---|---:|---|
| `mtn-10mb-100` | 100MB, 24 hours | ₦100 | Review provider cost and exact plan terms |
| `mtn-50mb-200` | 200MB, 2 days | ₦200 | Review provider cost and exact plan terms |
| `mtn-100mb-1000` | 1.5GB, 30 days | ₦1,000 | Code text does not match displayed size; use provider label only pending confirmation |
| `mtn-500mb-2000` | 4.5GB, 30 days | ₦2,000 | Code text does not match displayed size; use provider label only pending confirmation |
| `mtn-20hrs-1500` | 6GB, 7 days | ₦1,500 | Confirm actual eligibility and provider cost |
| `mtn-3gb-2500` | 6GB, 30 days | ₦2,500 | Code text does not match displayed size; review |
| `mtn-120gb-22000` | 120GB + 80 minutes, monthly | ₦22,000 | Combined bundle; keep separate from data-only plans |
| `mtn-25gb-sme-10000` | 25GB SME, 1 month | ₦10,000 | SME category; confirm recipient/eligibility restrictions |
| `mtn-4-5tb-450000` | 4.5TB, 1 year | ₦450,000 | Long-validity/high-value plan; require explicit confirmation |
| `mtn-1tb-110000` | Label says ₦100,000, 1TB, 1 year | ₦100,000 | Name/code mismatch; clarify with provider |
| `mtn-xtradata-200` | Xtradata | ₦200 | Special product; not ordinary data unless terms confirmed |
| `mtn-xtratalk-300` | Conflicting Xtratalk entries | ₦200 / ₦300 | **Quarantined — conflicting code and details** |

## Duplicate-array handling

The payload also contains the misspelled `varations` property duplicating the canonical `variations` array. Treat `content.variations` as canonical and never merge/count `varations` as a second set of products.

## Pricing and launch gate

- `variation_amount` and `fixedPrice: Yes` are not sufficient proof of HarvestHome's actual reseller debit/cost.
- Do not publish a retail price or claim ₦30 profit based on this catalogue alone.
- Before approving any plan, confirm unique variation code, exact bundle name/size/validity, customer eligibility, actual VTpass debit/commission, applicable Paystack fees, and failure/pending reconciliation.
- The sandbox catalogue request is read-only. No purchase was attempted and no live customer purchase is enabled.

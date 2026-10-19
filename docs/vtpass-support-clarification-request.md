# VTpass support clarification request — HarvestHome

**Purpose:** Confirm commercial API authorization, catalogue mapping, account-specific provider costs, and airtime settlement before pricing or enabling customer transactions.

Hello VTpass Support,

We are preparing our VTpass integration for HarvestHome and have reviewed the sandbox data and airtime catalogues. Before setting customer prices or enabling live transactions, please clarify the following for our account.

## 1. Commercial API and resale authorization

Please confirm in writing whether our account is approved to use the VTpass API commercially to sell airtime and data to HarvestHome's own customers, including whether any additional business verification, reseller agreement, account tier, licence or approval is required before production use. Please identify any restrictions on the product categories or customer model.

We may consider a separate reseller/agent feature in a later phase. Please confirm whether that requires a separate agreement or onboarding. We will not accept reseller deposits or hold reseller balances unless the model has been reviewed and approved.

## 2. Actual wallet debit and reseller cost

For each data plan returned by the variations endpoint, what is the exact amount that will be deducted from our VTpass wallet for one successful transaction? Is `variation_amount` the end-user price, the reseller debit, or another reference amount? Please provide the appropriate endpoint/field or account-specific pricing schedule for determining our actual cost.

## 3. Airtime commission discrepancy

For a ₦100 MTN Airtime VTU sandbox request, our response reported `total_amount: 96.5`, while a status re-query reported `commission: 4`, `commission_details.amount: 4`, and `commission_details.rate: 3.50`. Please explain which field represents the actual wallet debit/discount and confirm the live commission and net debit applicable to our account.

Request ID for the status-only re-query: `2026101808275045f5dbc5`. This was a sandbox transaction; we are not treating it as proof of live commercial terms.

## 4. Eligibility and restrictions

Please confirm availability and restrictions for SME, night-data, social/app-specific, TV/VOD, binge, combined data/voice, and long-validity plans (90 days, 180 days and 365 days). We need to display all data restrictions and validity accurately.

## 5. Sandbox versus live

Please confirm whether the variation codes, charges and commissions shown in sandbox match the live products and commercial terms available to our account. Please provide any account-specific setup steps required before live use.

## 6. Failed transactions, re-query and refunds

Please confirm the official procedure for pending, timed-out, failed, or contradictory provider responses; how long to wait before re-querying; whether re-querying the same request ID is the correct reconciliation path; and the process and expected timing for any applicable reversal/refund.

We will keep customer purchases disabled until these points are confirmed and reconciled against transaction status and the actual wallet ledger.

Thank you.

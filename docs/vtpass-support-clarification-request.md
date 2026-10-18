# VTpass support clarification request — HarvestHome

**Purpose:** Confirm catalogue mapping, account-specific provider costs, and airtime settlement before pricing or enabling customer transactions.

Hello VTpass Support,

We are preparing our VTpass integration for HarvestHome and have reviewed the sandbox data and airtime catalogues. We have decided to exclude three ambiguous variation codes from our candidate catalogue. Before setting customer prices or enabling live transactions, please clarify the following for our account.

## 1. Actual wallet debit and reseller cost
For each data plan returned by the variations endpoint, what is the exact amount that will be deducted from our VTpass wallet for one successful transaction? Is `variation_amount` the end-user price, the reseller debit, or another reference amount? Please provide the appropriate endpoint/field or account-specific pricing schedule for determining our actual cost.

## 2. Airtime commission discrepancy
For a ₦100 MTN Airtime VTU sandbox request, our response reported `total_amount: 96.5`, while a status re-query reported `commission: 4`, `commission_details.amount: 4`, and `commission_details.rate: 3.50`. Please explain which field represents the actual wallet debit/discount and confirm the live commission and net debit applicable to our account.

Request ID for the status-only re-query: `2026101808275045f5dbc5`. This was a sandbox transaction; we are not treating it as proof of live commercial terms.

## 3. Eligibility and restrictions
Please confirm availability and restrictions for SME, night-data, social/app-specific, TV/VOD, binge, combined data/voice, and long-validity plans (90 days, 180 days and 365 days). We need to display all data restrictions and validity accurately.

## 4. Sandbox versus live
Please confirm whether the variation codes, charges and commissions shown in sandbox match the live products and commercial terms available to our account. Please provide any account-specific setup steps required before live use.

We will keep customer purchases disabled until these points are confirmed and reconciled against transaction status and the actual wallet ledger.

Thank you.

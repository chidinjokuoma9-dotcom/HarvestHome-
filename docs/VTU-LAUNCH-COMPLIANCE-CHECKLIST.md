# HarvestHome VTU launch checklist — review required

**Status: development checklist only. This is not legal advice and does not certify regulatory compliance.**

## Phase 1 — direct customer purchases (no stored-value wallet)

- [ ] Obtain written confirmation from VTpass that HarvestHome's planned commercial API use, customer resale, product categories and production account status are approved under the applicable VTpass agreement.
- [ ] Confirm VTpass production onboarding/KYC requirements and keep the account/business details accurate.
- [ ] Obtain written confirmation from Paystack that the described airtime/data digital-service sales are permitted under HarvestHome's merchant account and payment terms.
- [ ] Confirm the approved settlement and refund/failed-fulfilment process with both providers.
- [ ] Confirm business registration, tax, receipts, record-retention and consumer-disclosure obligations with a qualified Nigerian adviser / relevant authority.
- [ ] Review whether the exact commercial model triggers any NCC registration/licensing or other regulatory obligations; do not assume aggregator access alone answers this.
- [ ] Keep customer purchases disabled until provider approval, pricing reconciliation, security review and explicit owner approval are complete.

## Phase 2 — reseller business features (not part of Phase 1)

- [ ] Do not accept reseller deposits or hold reseller balances until the legal/regulatory treatment has been reviewed and VTpass/Paystack have confirmed the model in writing.
- [ ] Obtain Nigerian legal advice on whether stored value, pooled funds, transfers, withdrawals, agent/reseller settlement or wallet-like functionality could trigger CBN/payment-service requirements.
- [ ] Define reseller KYC, fraud controls, transaction limits, disputes, refund responsibility, recordkeeping and terms before implementation.
- [ ] Prefer a non-custodial or provider-approved settlement model if professional advice and provider terms support it; do not represent HarvestHome as a bank or licensed payment service provider unless authorised.

## Product and security release gates

- [ ] Keep VTU orders and payments isolated from HarvestHome property-listing payments and seller verification.
- [ ] Verify Paystack transactions server-side against stored order ID, exact reference, integer amount, NGN currency, user and service metadata.
- [ ] Create orders idempotently; reserve one VTpass request ID before submission; never automatically submit a second purchase after a timeout or uncertain response.
- [ ] Re-query the same VTpass request ID for pending/uncertain outcomes and route contradictions to manual review.
- [ ] Reconcile actual VTpass wallet debits/commissions against response fields before setting retail prices. Do not treat a catalogue amount as wholesale cost without confirmation.
- [ ] Test duplicate requests, payment success with provider failure, provider timeout, webhook/requery retries, access control and audit events in an isolated environment.
- [ ] Run database security/performance advisors and verify RLS/grants before any schema rollout.

## Written confirmations to collect

1. **VTpass:** Is this account approved for commercial airtime/data resale to HarvestHome users via API? Which products are enabled in production? What is the exact wallet debit and commission for each transaction, and what is the official reconciliation/refund procedure?
2. **Paystack:** Does our merchant approval and agreement permit this digital airtime/data sales model, including direct sales now and reseller functionality later? What restrictions or disclosures apply?
3. **Qualified Nigerian adviser / regulator:** Does the planned direct-resale model require any additional registration/licence, and how would the answer change if HarvestHome later holds reseller balances or accepts deposits?

## Current boundary

This document and the development branch do not activate customer purchases, run the draft VTU schema against Supabase, deploy new live purchase handlers, or enable reseller wallets. Production release requires the gates above and explicit owner approval.

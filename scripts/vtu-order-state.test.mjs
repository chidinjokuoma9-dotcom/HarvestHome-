import test from "node:test";
import assert from "node:assert/strict";
import { decideVtuOrderState } from "./vtu-order-state.mjs";

test("unverified payment never allows a provider purchase or fulfilment", () => {
  const result = decideVtuOrderState({ paymentStatus: "pending" });
  assert.equal(result.state, "awaiting_payment");
  assert.equal(result.canFulfil, false);
  assert.equal(result.canSubmitProviderPurchase, false);
});

test("verified payment without persisted request ID does not submit a provider purchase", () => {
  const result = decideVtuOrderState({ paymentStatus: "verified", hasRequestId: false });
  assert.equal(result.state, "paid_ready_for_provider");
  assert.equal(result.canFulfil, false);
  assert.equal(result.canSubmitProviderPurchase, false);
  assert.equal(result.requiresIdempotentRequestCreation, true);
});

test("verified payment and delivered provider response permit fulfilment", () => {
  const result = decideVtuOrderState({
    paymentStatus: "verified",
    hasRequestId: true,
    providerHttpOk: true,
    providerCode: "000",
    providerStatus: "delivered"
  });
  assert.equal(result.state, "delivered");
  assert.equal(result.canFulfil, true);
  assert.equal(result.canSubmitProviderPurchase, false);
});

test("pending provider response is re-queried, never purchased again", () => {
  const result = decideVtuOrderState({
    paymentStatus: "paid",
    hasRequestId: true,
    providerHttpOk: true,
    providerCode: "099",
    providerStatus: "pending"
  });
  assert.equal(result.state, "provider_pending");
  assert.equal(result.canFulfil, false);
  assert.equal(result.canSubmitProviderPurchase, false);
  assert.equal(result.needsReconciliation, true);
});

test("provider failure after payment requires reconciliation, not automatic retry", () => {
  const result = decideVtuOrderState({
    paymentStatus: "verified",
    hasRequestId: true,
    providerHttpOk: true,
    providerCode: "999",
    providerStatus: "failed"
  });
  assert.equal(result.state, "payment_reconciliation");
  assert.equal(result.canFulfil, false);
  assert.equal(result.canSubmitProviderPurchase, false);
  assert.equal(result.needsReconciliation, true);
});

test("provider HTTP error or contradictory code/status remains under review", () => {
  const httpError = decideVtuOrderState({
    paymentStatus: "verified",
    hasRequestId: true,
    providerHttpOk: false,
    providerCode: "000",
    providerStatus: "delivered"
  });
  const conflict = decideVtuOrderState({
    paymentStatus: "verified",
    hasRequestId: true,
    providerHttpOk: true,
    providerCode: "099",
    providerStatus: "delivered"
  });
  assert.equal(httpError.state, "provider_review");
  assert.equal(conflict.state, "provider_review");
  assert.equal(httpError.canFulfil, false);
  assert.equal(conflict.canFulfil, false);
  assert.equal(httpError.canSubmitProviderPurchase, false);
  assert.equal(conflict.canSubmitProviderPurchase, false);
});

test("failed or cancelled payment never triggers a provider purchase", () => {
  for (const paymentStatus of ["failed", "cancelled", "expired"]) {
    const result = decideVtuOrderState({ paymentStatus });
    assert.equal(result.state, "cancelled");
    assert.equal(result.canSubmitProviderPurchase, false);
    assert.equal(result.canFulfil, false);
  }
});

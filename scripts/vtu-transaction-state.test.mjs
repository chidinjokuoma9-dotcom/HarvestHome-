import test from "node:test";
import assert from "node:assert/strict";
import {
  VTU_STATUSES, canTransitionVtuStatus, transitionVtuTransaction,
  canSubmitProviderPurchase, buildVtuIdempotencyKey, nextActionForVtuResult,
} from "./vtu-transaction-state.mjs";

test("declares the controlled transaction status set", () => {
  assert.deepEqual(VTU_STATUSES, [
    "awaiting_payment", "payment_verified", "provider_pending", "succeeded",
    "failed", "refund_pending", "refunded", "manual_review",
  ]);
});
test("allows only explicitly defined status transitions", () => {
  assert.equal(canTransitionVtuStatus("awaiting_payment", "payment_verified"), true);
  assert.equal(canTransitionVtuStatus("payment_verified", "provider_pending"), true);
  assert.equal(canTransitionVtuStatus("provider_pending", "succeeded"), true);
  assert.equal(canTransitionVtuStatus("succeeded", "provider_pending"), false);
  assert.equal(canTransitionVtuStatus("refunded", "succeeded"), false);
  assert.equal(canTransitionVtuStatus("unknown", "succeeded"), false);
});
test("preserves transaction identity and payment references", () => {
  const original = {
    id: "order-1", userId: "user-1", amountKobo: 50000,
    paymentReference: "pay-1", providerRequestId: null, status: "payment_verified",
  };
  const next = transitionVtuTransaction(original, "provider_pending", { updatedAt: "test-time" });
  assert.equal(next.status, "provider_pending");
  assert.equal(next.id, original.id);
  assert.equal(next.updatedAt, "test-time");
  assert.throws(() => transitionVtuTransaction(original, "provider_pending", { amountKobo: 1 }), /identity field/);
});
test("rejects illegal transitions and missing transaction records", () => {
  assert.throws(() => transitionVtuTransaction(null, "failed"), /transaction object/);
  assert.throws(() => transitionVtuTransaction({ status: "succeeded" }, "provider_pending"), /Invalid VTU transaction transition/);
});
test("provider preflight permits only one matched, verified order", () => {
  const valid = {
    status: "payment_verified", paymentVerified: true, providerRequestId: null,
    providerAttemptCount: 0, amountKobo: 50000, paymentAmountKobo: 50000,
  };
  assert.equal(canSubmitProviderPurchase(valid), true);
  assert.equal(canSubmitProviderPurchase({ ...valid, paymentVerified: false }), false);
  assert.equal(canSubmitProviderPurchase({ ...valid, paymentAmountKobo: 40000 }), false);
  assert.equal(canSubmitProviderPurchase({ ...valid, providerRequestId: "existing-id" }), false);
  assert.equal(canSubmitProviderPurchase({ ...valid, providerAttemptCount: 1 }), false);
  assert.equal(canSubmitProviderPurchase({ ...valid, status: "provider_pending" }), false);
  assert.equal(canSubmitProviderPurchase({ ...valid, amountKobo: 1.5 }), false);
});
test("idempotency key is stable and requires an internal order ID", () => {
  assert.equal(buildVtuIdempotencyKey(" order-123 "), "harvesthome-vtu:order-123");
  assert.equal(buildVtuIdempotencyKey("order-123"), buildVtuIdempotencyKey("order-123"));
  assert.throws(() => buildVtuIdempotencyKey("  "), /order ID/);
  assert.throws(() => buildVtuIdempotencyKey(null), /order ID/);
});
test("pending and timeout outcomes only re-query the existing request", () => {
  assert.equal(nextActionForVtuResult({ status: "provider_pending", timedOut: true }), "requery_existing_request");
  assert.equal(nextActionForVtuResult({ status: "provider_pending" }), "requery_existing_request");
  assert.notEqual(nextActionForVtuResult({ status: "provider_pending", timedOut: true }), "submit_new_purchase");
});
test("confirmed provider outcomes require verification or reconciliation, never a new purchase", () => {
  assert.equal(nextActionForVtuResult({ status: "provider_pending", providerStatus: "delivered" }), "mark_succeeded_after_verification");
  assert.equal(nextActionForVtuResult({ status: "provider_pending", providerStatus: "failed" }), "verify_failure_and_refund_policy");
  assert.equal(nextActionForVtuResult({ status: "provider_pending", providerStatus: "unknown" }), "requery_existing_request");
  assert.equal(nextActionForVtuResult({ status: "provider_pending", providerStatus: "delivered", timedOut: true }), "requery_existing_request");
});
test("terminal and ambiguous outcomes fail closed", () => {
  assert.equal(nextActionForVtuResult({ status: "manual_review" }), "manual_reconciliation");
  assert.equal(nextActionForVtuResult({ status: "succeeded" }), "no_purchase_action");
  assert.equal(nextActionForVtuResult({ status: "refunded" }), "no_purchase_action");
  assert.equal(nextActionForVtuResult({ status: "failed", providerStatus: "unknown" }), "inspect_transaction_without_resubmitting");
});

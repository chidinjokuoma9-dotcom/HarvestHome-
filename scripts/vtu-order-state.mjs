export function decideVtuOrderState({ paymentStatus = "unverified", providerHttpOk = false, providerCode = "", providerStatus = "", hasRequestId = false } = {}) {
 const payment = String(paymentStatus).trim().toLowerCase();
 const code = String(providerCode).trim();
 const provider = String(providerStatus).trim().toLowerCase();
 if (payment !== "verified" && payment !== "paid") {
  if (["failed", "cancelled", "expired"].includes(payment)) return { state: "cancelled", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: false, reason: "Payment was not verified and is terminal; do not send a provider purchase." };
  return { state: "awaiting_payment", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: false, reason: "Wait for trusted server-side payment verification before any provider purchase." };
 }
 if (!hasRequestId) return { state: "paid_ready_for_provider", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: true, needsReconciliation: false, reason: "Payment is verified. Create and persist one idempotent provider request ID before any purchase submission; this helper does not authorize or submit the purchase." };
 if (!providerHttpOk) return { state: "provider_review", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: true, reason: "Provider outcome is unknown. Re-query the same request ID; never submit a duplicate purchase." };
 if (code === "000" && provider === "delivered") return { state: "delivered", canFulfil: true, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: false, reason: "Payment is verified and provider reports delivered. Persist both verified states and the provider response before confirming to the customer." };
 if (["pending", "initiated", "processing", "in progress"].includes(provider)) return { state: "provider_pending", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: true, reason: "Provider is still processing. Re-query this request ID; do not submit another purchase." };
 if (["failed", "failure", "declined", "reversed"].includes(provider)) return { state: "payment_reconciliation", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: true, reason: "Payment was verified but provider reports a non-delivered result. Reconcile transaction and refund policy manually; do not retry automatically." };
 return { state: "provider_review", canFulfil: false, canSubmitProviderPurchase: false, requiresIdempotentRequestCreation: false, needsReconciliation: true, reason: "Provider code/status is incomplete or contradictory. Re-query the same request ID and reconcile; no automatic retry." };
}

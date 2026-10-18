/**
 * HarvestHome VTU transaction lifecycle rules.
 * Pure review/test helpers only. These rules do NOT provide persistence,
 * atomic locking, Paystack verification, or provider idempotency by themselves.
 * Production use requires server-side database constraints and audited handlers.
 */
export const VTU_STATUSES = Object.freeze([
  "awaiting_payment", "payment_verified", "provider_pending", "succeeded",
  "failed", "refund_pending", "refunded", "manual_review",
]);
const ALLOWED_TRANSITIONS = Object.freeze({
  awaiting_payment: new Set(["payment_verified", "failed", "manual_review"]),
  payment_verified: new Set(["provider_pending", "failed", "manual_review"]),
  provider_pending: new Set(["succeeded", "failed", "manual_review"]),
  succeeded: new Set(["manual_review"]),
  failed: new Set(["refund_pending", "manual_review"]),
  refund_pending: new Set(["refunded", "manual_review"]),
  refunded: new Set(["manual_review"]),
  manual_review: new Set(),
});
export function canTransitionVtuStatus(from, to) {
  if (!VTU_STATUSES.includes(from) || !VTU_STATUSES.includes(to)) return false;
  return ALLOWED_TRANSITIONS[from].has(to);
}
export function transitionVtuTransaction(transaction, nextStatus, metadata = {}) {
  if (!transaction || typeof transaction !== "object") throw new TypeError("A transaction object is required.");
  const currentStatus = transaction.status;
  if (!canTransitionVtuStatus(currentStatus, nextStatus)) {
    throw new Error(`Invalid VTU transaction transition: ${currentStatus} -> ${nextStatus}`);
  }
  const next = { ...transaction, ...metadata, status: nextStatus };
  for (const key of ["id", "userId", "amountKobo", "paymentReference", "providerRequestId"]) {
    if (Object.hasOwn(transaction, key) && next[key] !== transaction[key]) {
      throw new Error(`Transaction identity field cannot be changed: ${key}`);
    }
  }
  return next;
}
/**
 * Conservative preflight gate for a provider purchase attempt.
 * A durable database lock/unique constraint must enforce this atomically in production.
 */
export function canSubmitProviderPurchase({
  status, paymentVerified, providerRequestId = null, providerAttemptCount = 0,
  amountKobo, paymentAmountKobo,
} = {}) {
  return status === "payment_verified"
    && paymentVerified === true
    && typeof amountKobo === "number"
    && Number.isSafeInteger(amountKobo)
    && amountKobo > 0
    && paymentAmountKobo === amountKobo
    && (providerRequestId === null || providerRequestId === "")
    && providerAttemptCount === 0;
}
/**
 * Stable internal idempotency key for an order. Persist it with a UNIQUE constraint;
 * do not treat a generated key alone as duplicate protection.
 */
export function buildVtuIdempotencyKey(orderId) {
  if (typeof orderId !== "string" || !orderId.trim()) throw new TypeError("A non-empty internal order ID is required.");
  return `harvesthome-vtu:${orderId.trim()}`;
}
/** Decide whether to inspect status or require reconciliation. Never auto-resubmit. */
export function nextActionForVtuResult({ status, providerStatus, timedOut = false } = {}) {
  if (timedOut || status === "provider_pending") return "requery_existing_request";
  if (status === "manual_review") return "manual_reconciliation";
  if (providerStatus === "delivered" && status === "provider_pending") return "mark_succeeded_after_verification";
  if (providerStatus === "failed" && status === "provider_pending") return "verify_failure_and_refund_policy";
  if (status === "succeeded" || status === "refunded") return "no_purchase_action";
  return "inspect_transaction_without_resubmitting";
}

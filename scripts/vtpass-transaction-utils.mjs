/**
 * Conservative interpretation of VTpass transaction responses.
 * Pure helper for tests/review only; it does not call providers, process payment,
 * fulfil customer orders, or authorize automatic retries.
 */
export function interpretVtpassResult({ httpOk = false, providerResponse = {} } = {}) {
  const response = providerResponse && typeof providerResponse === "object" ? providerResponse : {};
  const tx = response?.content?.transactions && typeof response.content.transactions === "object"
    ? response.content.transactions
    : {};
  const code = String(response.code ?? response.response_code ?? response.responseCode ?? "").trim();
  const status = String(tx.status ?? response.status ?? response.transaction_status ?? "").trim().toLowerCase();
  const description = String(
    response.response_description ?? response.responseDescription ?? response.message ?? ""
  ).trim();

  let decision = "review";
  let reason = "Provider result is incomplete or unrecognized; check transaction status before any further action.";

  if (!httpOk) {
    decision = "review";
    reason = "HTTP request was not successful; provider transaction outcome is not established.";
  } else if (code === "000" && status === "delivered") {
    decision = "delivered";
    reason = "Provider reports code 000 and delivered status. This alone does not prove customer payment was verified.";
  } else if (["pending", "initiated", "processing", "in progress"].includes(status)) {
    decision = "pending";
    reason = "Provider reports a pending/in-progress state. Re-query the same request ID; do not submit a duplicate.";
  } else if (["failed", "failure", "declined", "reversed"].includes(status)) {
    decision = "failed";
    reason = "Provider reports a non-delivered terminal state. Reconcile provider history and payment state before any new attempt.";
  } else if (status === "delivered" && code && code !== "000") {
    decision = "review";
    reason = "Provider code conflicts with delivered status. Do not fulfil or retry automatically; reconcile the transaction.";
  }

  return {
    decision,
    providerCode: code || null,
    providerStatus: status || null,
    description: description || null,
    customerMayBeMarkedDelivered: decision === "delivered",
    requiresStatusRequery: decision === "pending" || decision === "review",
    automaticRetryAllowed: false,
    reason
  };
}

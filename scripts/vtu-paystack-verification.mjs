/**
 * Strict Paystack transaction validation for the future HarvestHome VTU flow.
 * Pure function only: it does not call Paystack, update the database, or fulfil orders.
 * Do not reuse it to change existing marketplace payment behavior without a separate review.
 */
export function verifyVtuPaystackTransaction({
  apiResponse,
  expectedReference,
  expectedAmountKobo,
  expectedCurrency = "NGN",
  expectedUserId,
  expectedOrderId
} = {}) {
  const fail = (reason) => ({
    verified: false,
    reason,
    reference: null,
    amountKobo: null,
    currency: null
  });

  if (!apiResponse || apiResponse.status !== true || !apiResponse.data || typeof apiResponse.data !== "object") {
    return fail("Paystack verification API did not return a successful, structured response.");
  }

  const tx = apiResponse.data;
  if (String(tx.status ?? "").trim().toLowerCase() !== "success") {
    return fail("Paystack transaction is not in the successful state.");
  }

  const reference = String(tx.reference ?? "").trim();
  if (!expectedReference || reference !== String(expectedReference).trim()) {
    return fail("Paystack reference does not exactly match the stored VTU order reference.");
  }

  const amount = Number(tx.amount);
  const expectedAmount = Number(expectedAmountKobo);
  if (!Number.isSafeInteger(amount) || amount <= 0
      || !Number.isSafeInteger(expectedAmount) || expectedAmount <= 0
      || amount !== expectedAmount) {
    return fail("Paystack amount does not exactly match the stored VTU order amount in kobo.");
  }

  const currency = String(tx.currency ?? "").trim().toUpperCase();
  const wantedCurrency = String(expectedCurrency ?? "NGN").trim().toUpperCase();
  if (currency !== wantedCurrency || currency !== "NGN") {
    return fail("Paystack currency does not match the expected NGN currency.");
  }

  const metadata = tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
  if (!expectedUserId || String(metadata.user_id ?? "") !== String(expectedUserId)) {
    return fail("Paystack metadata user does not match the authenticated order owner.");
  }
  if (!expectedOrderId || String(metadata.order_id ?? "") !== String(expectedOrderId)) {
    return fail("Paystack metadata order ID does not match the stored VTU order.");
  }
  if (String(metadata.service ?? "").trim().toLowerCase() !== "vtu") {
    return fail("Paystack transaction is not explicitly tagged as a HarvestHome VTU order.");
  }

  return {
    verified: true,
    reason: "Paystack transaction matches the stored VTU order reference, amount, NGN currency, user, order ID, and service metadata.",
    reference,
    amountKobo: amount,
    currency
  };
}

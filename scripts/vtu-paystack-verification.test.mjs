import test from "node:test";
import assert from "node:assert/strict";
import { verifyVtuPaystackTransaction } from "./vtu-paystack-verification.mjs";

const expected = {
  expectedReference: "vtu_ref_abc123",
  expectedAmountKobo: 13300,
  expectedCurrency: "NGN",
  expectedUserId: "user-123",
  expectedOrderId: "order-456"
};

function response(overrides = {}) {
  return {
    status: true,
    data: {
      status: "success",
      reference: "vtu_ref_abc123",
      amount: 13300,
      currency: "NGN",
      metadata: { service: "vtu", user_id: "user-123", order_id: "order-456" },
      ...overrides
    }
  };
}

test("accepts a fully matching successful VTU payment", () => {
  const result = verifyVtuPaystackTransaction({ ...expected, apiResponse: response() });
  assert.equal(result.verified, true);
  assert.equal(result.reference, expected.expectedReference);
  assert.equal(result.amountKobo, 13300);
  assert.equal(result.currency, "NGN");
});

test("rejects unsuccessful verification API responses and unpaid transactions", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: { status: false } }).verified, false);
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ status: "abandoned" }) }).verified, false);
});

test("requires the exact stored Paystack reference", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ reference: "other-ref" }) }).verified, false);
});

test("requires exact integer amount in kobo", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ amount: 13299 }) }).verified, false);
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ amount: 13300.5 }) }).verified, false);
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ amount: "NaN" }) }).verified, false);
});

test("rejects non-NGN or mismatched currency", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ currency: "USD" }) }).verified, false);
  assert.equal(verifyVtuPaystackTransaction({ ...expected, expectedCurrency: "USD", apiResponse: response({ currency: "USD" }) }).verified, false);
});

test("requires matching owner and order metadata", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ metadata: { service: "vtu", user_id: "other", order_id: "order-456" } }) }).verified, false);
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ metadata: { service: "vtu", user_id: "user-123", order_id: "other" } }) }).verified, false);
});

test("rejects a generic marketplace payment even when amount and reference match", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, apiResponse: response({ metadata: { service: "featured", user_id: "user-123", order_id: "order-456" } }) }).verified, false);
});

test("does not accept missing expected order identity", () => {
  assert.equal(verifyVtuPaystackTransaction({ ...expected, expectedOrderId: "", apiResponse: response() }).verified, false);
  assert.equal(verifyVtuPaystackTransaction({ ...expected, expectedUserId: "", apiResponse: response() }).verified, false);
});

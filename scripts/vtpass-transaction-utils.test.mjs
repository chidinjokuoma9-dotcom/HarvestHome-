import test from "node:test";
import assert from "node:assert/strict";
import { interpretVtpassResult } from "./vtpass-transaction-utils.mjs";

test("provider-delivered status alone never authorizes customer fulfilment", () => {
  const result = interpretVtpassResult({
    httpOk: true,
    providerResponse: { code: "000", response_description: "TRANSACTION SUCCESSFUL", content: { transactions: { status: "delivered" } } }
  });
  assert.equal(result.decision, "delivered");
  assert.equal(result.providerReportsDelivered, true);
  assert.equal(result.paymentVerified, false);
  assert.equal(result.customerMayBeMarkedDelivered, false);
  assert.equal(result.automaticRetryAllowed, false);
  assert.match(result.reason, /payment verification was not supplied/i);
});

test("customer fulfilment signal requires provider delivery and verified payment", () => {
  const result = interpretVtpassResult({
    httpOk: true,
    paymentVerified: true,
    providerResponse: { code: "000", response_description: "TRANSACTION SUCCESSFUL", content: { transactions: { status: "delivered" } } }
  });
  assert.equal(result.decision, "delivered");
  assert.equal(result.providerReportsDelivered, true);
  assert.equal(result.paymentVerified, true);
  assert.equal(result.customerMayBeMarkedDelivered, true);
});

test("pending result requires re-query and never permits automatic retry", () => {
  const result = interpretVtpassResult({
    httpOk: true,
    providerResponse: { code: "099", response_description: "PENDING", content: { transactions: { status: "pending" } } }
  });
  assert.equal(result.decision, "pending");
  assert.equal(result.providerReportsDelivered, false);
  assert.equal(result.customerMayBeMarkedDelivered, false);
  assert.equal(result.requiresStatusRequery, true);
  assert.equal(result.automaticRetryAllowed, false);
});

test("provider-reported failed result is not marked delivered and is not auto-retried", () => {
  const result = interpretVtpassResult({
    httpOk: true,
    providerResponse: { code: "999", content: { transactions: { status: "failed" } } }
  });
  assert.equal(result.decision, "failed");
  assert.equal(result.providerReportsDelivered, false);
  assert.equal(result.customerMayBeMarkedDelivered, false);
  assert.equal(result.automaticRetryAllowed, false);
});

test("conflicting code and delivered status is quarantined for reconciliation", () => {
  const result = interpretVtpassResult({
    httpOk: true,
    providerResponse: { code: "099", content: { transactions: { status: "delivered" } } }
  });
  assert.equal(result.decision, "review");
  assert.equal(result.providerReportsDelivered, false);
  assert.equal(result.customerMayBeMarkedDelivered, false);
  assert.equal(result.requiresStatusRequery, true);
  assert.equal(result.automaticRetryAllowed, false);
});

test("HTTP errors and missing statuses remain unknown rather than success", () => {
  const httpError = interpretVtpassResult({ httpOk: false, providerResponse: { code: "000", content: { transactions: { status: "delivered" } } } });
  const missing = interpretVtpassResult({ httpOk: true, providerResponse: { code: "000" } });
  assert.equal(httpError.decision, "review");
  assert.equal(missing.decision, "review");
  assert.equal(httpError.customerMayBeMarkedDelivered, false);
  assert.equal(missing.customerMayBeMarkedDelivered, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("supabase/functions/vtu-order-create/index.ts", "utf8");

test("order creation is gated off unless checkout is explicitly enabled", () => {
  assert.ok(source.includes('Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true"'));
});

test("order creation requires an authenticated user and server catalogue", () => {
  assert.ok(source.includes("userClient.auth.getUser()"));
  assert.ok(source.includes("loadCatalogue()"));
  assert.ok(source.includes("p_user_id: user.id"));
  assert.ok(source.includes("p_amount_kobo: item.amountKobo"));
  assert.ok(source.includes("p_provider_amount_kobo: item.providerAmountKobo"));
  assert.ok(source.includes("p_service_id: item.serviceId"));
  assert.ok(source.includes("p_variation_code: item.variationCode"));
});

test("order creation normalizes phone and requires idempotency", () => {
  assert.ok(source.includes("normalizeNigerianPhone(body.phone)"));
  assert.ok(source.includes("p_idempotency_key: idempotencyKey"));
  assert.ok(source.includes("idempotencyKey"));
});

test("order creation does not expose internal exception details to customers", () => {
  assert.ok(source.includes("VTU order creation could not be completed safely"));
  assert.ok(!source.includes("return jsonResponse({ error: message }"));
});

test("order creation does not call Paystack or VTpass itself", () => {
  assert.ok(!source.includes("api.paystack.co"));
  assert.ok(!source.includes("api.vtpass.com"));
  assert.ok(!source.includes("sandbox.vtpass.com"));
});

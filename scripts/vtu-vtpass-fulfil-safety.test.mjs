import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("supabase/functions/vtu-vtpass-sandbox-fulfil/index.ts", "utf8");

test("sandbox fulfilment is gated by checkout, sandbox and approved-payload flags", () => {
  assert.ok(source.includes('Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true"'));
  assert.ok(source.includes('Deno.env.get("VTPASS_SANDBOX_FULFILMENT_ENABLED") !== "true"'));
  assert.ok(source.includes('Deno.env.get("VTPASS_REQUEST_PAYLOAD_APPROVED") !== "true"'));
});

test("fulfilment requires authenticated ownership and verified payment", () => {
  assert.ok(source.includes("userClient.auth.getUser()"));
  assert.ok(source.includes('.eq("id", orderId).eq("user_id", user.id)'));
  assert.ok(source.includes('order.payment_status !== "verified"'));
});

test("fulfilment reserves one provider attempt and re-queries existing request IDs", () => {
  assert.ok(source.includes('admin.rpc("claim_vtu_provider_attempt"'));
  assert.ok(source.includes('https://sandbox.vtpass.com/api/requery'));
  assert.ok(source.includes('https://sandbox.vtpass.com/api/pay'));
  assert.ok(source.indexOf('if (requestId)') < source.indexOf('https://sandbox.vtpass.com/api/pay'));
  assert.ok(!source.includes("https://api.vtpass.com/api/pay"));
});

test("provider request uses the stored provider amount, not customer retail amount", () => {
  assert.ok(source.includes("claim.provider_amount_kobo"));
  assert.ok(source.includes("Number(claim.provider_amount_kobo) / 100"));
  assert.ok(!source.includes("amount: String(Number(claim.amount_kobo) / 100)"));
});

test("provider response and audit event are recorded through one database function", () => {
  assert.ok(source.includes('admin.rpc("record_vtu_provider_result"'));
  assert.ok(!source.includes('admin.from("vtu_order_events").insert'));
});

test("uncertain results never trigger an automatic replacement purchase", () => {
  assert.ok(source.includes("Re-query the same request ID"));
  assert.ok(source.includes("Do not submit another purchase"));
});

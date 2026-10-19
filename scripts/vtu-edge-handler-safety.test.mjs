import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const init = await readFile("supabase/functions/vtu-paystack-initialize/index.ts", "utf8");
const verify = await readFile("supabase/functions/vtu-paystack-verify/index.ts", "utf8");

test("VTU Paystack initializer is disabled by default and requires signed-in user", () => {
  assert.ok(init.includes('Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true"'));
  assert.ok(init.includes('userClient.auth.getUser()'));
  assert.ok(init.includes('.eq("id", orderId).eq("user_id", user.id)'));
  assert.ok(init.includes('admin.rpc("reserve_vtu_payment_reference"'));
  assert.ok(init.includes('Deno.env.get("VTU_CALLBACK_URL")'));
  assert.ok(init.includes('Deno.env.get("PAYSTACK_SECRET_KEY")'));
});

test("VTU checkout uses only stored server-side amount and never accepts browser price", () => {
  assert.ok(init.includes("const amountKobo = Number(order.amount_kobo)"));
  assert.ok(init.includes("amount: String(amountKobo)"));
  assert.ok(!/body\.amount|body\.price|input\.amount|input\.price/.test(init));
  assert.ok(init.includes('order.currency !== "NGN"'));
  assert.ok(init.includes('result?.data?.reference !== reference'));
});

test("VTU verifier validates exact Paystack reference, amount, currency, owner and order metadata", () => {
  assert.ok(verify.includes('Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true"'));
  assert.ok(verify.includes('userClient.auth.getUser()'));
  assert.ok(verify.includes('txReference !== order.payment_reference'));
  assert.ok(verify.includes('const storedAmountKobo = Number(order.amount_kobo)'));
  assert.ok(verify.includes('txAmount !== storedAmountKobo'));
  assert.ok(verify.includes('!Number.isSafeInteger(storedAmountKobo)'));
  assert.ok(verify.includes('txCurrency !== "NGN"'));
  assert.ok(verify.includes('String(metadata.user_id || "") !== user.id'));
  assert.ok(verify.includes('String(metadata.order_id || "") !== order.id'));
  assert.ok(verify.includes('String(metadata.service || "") !== "vtu"'));
  assert.ok(verify.includes('admin.rpc("mark_vtu_payment_verified"'));
});

test("Paystack verification never triggers VTpass fulfillment", () => {
  assert.ok(verify.includes("fulfilment_started: false"));
  assert.ok(!verify.includes("sandbox.vtpass.com/api/pay"));
  assert.ok(!verify.includes("api.vtpass.com/api/pay"));
});

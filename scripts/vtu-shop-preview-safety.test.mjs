import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shop = await readFile("vtu-shop-preview.html", "utf8");
const hub = await readFile("vtu-test.html", "utf8");

test("customer shop clearly labels itself as a private preview and disables checkout", () => {
  assert.match(shop, /PRIVATE PREVIEW/i);
  assert.match(shop, /Customer checkout and live purchases are disabled/i);
  assert.match(shop, /no order, provider request or payment was created/i);
});

test("airtime preview validates Nigerian numbers but never navigates to a purchase/test endpoint", () => {
  assert.match(shop, /0\[789\]\[01\]\\d\{8\}/);
  assert.match(shop, /Preview prepared for/);
  assert.doesNotMatch(shop, /window\.location\.href\s*=\s*["']\/vtpass-airtime-test\.html/);
  assert.doesNotMatch(shop, /fetch\s*\(|functions\.invoke|paystack|api\.vtpass\.com|sandbox\.vtpass\.com/i);
});

test("shop does not expose payment entry or an enabled purchase action", () => {
  assert.doesNotMatch(shop, /<input[^>]+(?:card number|cvv|payment reference)/i);
  assert.doesNotMatch(shop, /checkout\.create|initializePayment|submitOrder|placeOrder/i);
});

test("VTU hub only describes VTpass and does not link to the retired MELE diagnostic", () => {
  assert.match(hub, /VTpass/i);
  assert.doesNotMatch(hub, /MELE DATA|airtime-test\.html/i);
});

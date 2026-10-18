import test from "node:test";
import assert from "node:assert/strict";
import { classifyBundle, normalizeCatalogue, minimumRetailPrice } from "./vtpass-catalogue-utils.mjs";

test("uses canonical variations only and ignores repeated varations alias", () => {
  const payload = {
    content: {
      variations: [{ variation_code: "a1", name: "1GB - 30 days", variation_amount: "100.00", fixedPrice: "Yes" }],
      varations: [
        { variation_code: "a1", name: "1GB - 30 days", variation_amount: "100.00", fixedPrice: "Yes" },
        { variation_code: "a2", name: "Should be ignored", variation_amount: "200.00", fixedPrice: "Yes" }
      ]
    }
  };
  const result = normalizeCatalogue(payload, { network: "Test" });
  assert.equal(result.sourceCount, 1);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].code, "a1");
  assert.equal(result.plans[0].publishable, false);
});

test("quarantines conflicting variation codes", () => {
  const result = normalizeCatalogue({ content: { variations: [
    { variation_code: "same", name: "1GB - 30 days", variation_amount: "100", fixedPrice: "Yes" },
    { variation_code: "same", name: "4GB including night data", variation_amount: "100", fixedPrice: "Yes" },
    { variation_code: "ok", name: "2GB SME - 30 days", variation_amount: "200", fixedPrice: "Yes" }
  ] } });
  assert.deepEqual(result.conflictCodes, ["same"]);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].code, "ok");
  assert.equal(result.quarantined[0].reason, "conflicting-variation-code");
});

test("deduplicates identical rows and classifies bundle types", () => {
  const row = { variation_code: "s1", name: "Glo Data SME 1GB - 30 days", variation_amount: "320.00", fixedPrice: "Yes" };
  const result = normalizeCatalogue({ content: { variations: [row, { ...row }] } });
  assert.equal(result.plans.length, 1);
  assert.equal(result.duplicateExactCount, 1);
  assert.equal(result.plans[0].bundleType, "sme");
  assert.equal(classifyBundle("Xtratalk weekly bundle"), "voice");
  assert.equal(classifyBundle("YouTube 500MB"), "app-specific");
  assert.equal(classifyBundle("Glo TV VOD 2GB"), "video-streaming");
  assert.equal(classifyBundle("1GB + 2GB Night"), "night-bonus");
});

test("pricing helper uses caller-supplied fee model and targets minimum contribution", () => {
  const result = minimumRetailPrice({
    providerCost: 100,
    targetProfit: 30,
    estimatePaymentFee: (price) => Math.ceil(price * 0.02)
  });
  assert.equal(result.customerPrice, 133);
  assert.equal(result.estimatedContribution, 30);
});

test("pricing helper validates missing fee calculator and returns null when cap is too low", () => {
  assert.throws(() => minimumRetailPrice({ providerCost: 100 }), /fee calculator/);
  assert.equal(minimumRetailPrice({
    providerCost: 100, maxPrice: 120, estimatePaymentFee: () => 5, targetProfit: 30
  }), null);
});

test("invalid rows are quarantined", () => {
  const result = normalizeCatalogue({ content: { variations: [
    { variation_code: "", name: "No code", variation_amount: "100" },
    { variation_code: "bad", name: "Bad amount", variation_amount: "NaN" }
  ] } });
  assert.equal(result.plans.length, 0);
  assert.equal(result.invalidCount, 2);
});

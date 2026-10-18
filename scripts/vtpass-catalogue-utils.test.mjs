import test from "node:test";
import assert from "node:assert/strict";
import { classifyBundle, normalizeCatalogue, minimumRetailPrice, extractPlanMetadata } from "./vtpass-catalogue-utils.mjs";

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
  assert.equal(classifyBundle("MTN Xtradata 1GB"), "xtradata");
  assert.equal(classifyBundle("YouTube 500MB"), "app-specific");
  assert.equal(classifyBundle("Glo TV VOD 2GB"), "video-streaming");
  assert.equal(classifyBundle("1GB + 2GB Night"), "night-bonus");
  assert.equal(classifyBundle("200MB (100MB + 100MB Night) + 300 seconds"), "combined-data-voice");
  assert.equal(classifyBundle("1.5GB + 300 seconds"), "combined-data-voice");
  assert.equal(classifyBundle("300 seconds voice bundle"), "voice");
});

test("normalizes mixed data-and-voice bundles into their own review category", () => {
  const result = normalizeCatalogue({ content: { variations: [
    {
      variation_code: "eti-combo-test",
      name: "200MB (100MB + 100MB Night) + 300 seconds",
      variation_amount: "150",
      fixedPrice: "Yes"
    },
    {
      variation_code: "voice-test",
      name: "300 seconds voice bundle",
      variation_amount: "100",
      fixedPrice: "Yes"
    }
  ] } }, { network: "9mobile", serviceId: "etisalat-data" });

  const combined = result.plans.find(plan => plan.code === "eti-combo-test");
  const voiceOnly = result.plans.find(plan => plan.code === "voice-test");
  assert.equal(combined.bundleType, "combined-data-voice");
  assert.equal(voiceOnly.bundleType, "voice");
  assert.equal(combined.customerPrice, null);
  assert.equal(combined.publishable, false);
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
  assert.throws(() => minimumRetailPrice({ providerCost: 100 }), /must be a function/);
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

test("quarantines the three known VTpass sandbox code conflicts", () => {
  const cases = [
    {
      network: "MTN",
      code: "mtn-xtratalk-300",
      rows: [
        { variation_code: "mtn-xtratalk-300", name: "N300 Xtratalk Weekly Bundle", variation_amount: "300", fixedPrice: "Yes" },
        { variation_code: "mtn-xtratalk-300", name: "N200 Xtratalk - 3 days", variation_amount: "200", fixedPrice: "Yes" }
      ]
    },
    {
      network: "Glo",
      code: "glo-mega-75000",
      rows: [
        { variation_code: "glo-mega-75000", name: "675GB Glo Mega", variation_amount: "75000", fixedPrice: "Yes" },
        { variation_code: "glo-mega-75000", name: "N100000 1TB Glo Mega Oneoff", variation_amount: "100000", fixedPrice: "Yes" }
      ]
    },
    {
      network: "9mobile",
      code: "eti-1000",
      rows: [
        { variation_code: "eti-1000", name: "1.5GB - 30 days", variation_amount: "1000", fixedPrice: "Yes" },
        { variation_code: "eti-1000", name: "4GB (2GB + 2GB Night)", variation_amount: "1000", fixedPrice: "Yes" }
      ]
    }
  ];

  for (const item of cases) {
    const result = normalizeCatalogue({ content: { variations: item.rows } }, { network: item.network });
    assert.deepEqual(result.conflictCodes, [item.code], item.network);
    assert.equal(result.plans.length, 0, item.network);
    assert.equal(result.quarantined.length, 1, item.network);
    assert.equal(result.quarantined[0].reason, "conflicting-variation-code", item.network);
    assert.equal(result.plans.some(plan => plan.code === item.code && plan.publishable), false, item.network);
  }
});

test("quarantines conflicting variation codes even when code casing differs", () => {
  const result = normalizeCatalogue({ content: { variations: [
    { variation_code: "Plan-X", name: "1GB - 30 days", variation_amount: "100", fixedPrice: "Yes" },
    { variation_code: "plan-x", name: "2GB - 30 days", variation_amount: "100", fixedPrice: "Yes" },
    { variation_code: "PLAN-Y", name: "500MB - 7 days", variation_amount: "50", fixedPrice: "Yes" }
  ] } });
  assert.deepEqual(result.conflictCodes, ["Plan-X"]);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].code, "PLAN-Y");
  assert.equal(result.plans.some(plan => plan.code.toLowerCase() === "plan-x"), false);
});

test("accepts wrapped provider response and preserves decimal provider amount", () => {
  const result = normalizeCatalogue({
    providerResponse: {
      content: {
        variations: [
          { variation_code: "decimal1", name: "75MB - 1 day", variation_amount: "99.03", fixedPrice: "Yes" }
        ]
      }
    }
  }, { network: "Airtel", serviceId: "airtel-data" });

  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].providerAmount, 99.03);
  assert.equal(result.plans[0].providerAmountRaw, "99.03");
  assert.equal(result.plans[0].customerPrice, null);
  assert.equal(result.plans[0].publishable, false);
});


test("extracts size and validity hints without approving a plan", () => {
  assert.deepEqual(extractPlanMetadata("1.5GB - 30 days"), {
    statedSize: { value: 1.5, unit: "GB" },
    statedValidity: { value: 30, unit: "days" }
  });
  assert.deepEqual(extractPlanMetadata("500MB Night Bundle"), {
    statedSize: { value: 500, unit: "MB" },
    statedValidity: null
  });
  const result = normalizeCatalogue({ content: { variations: [
    { variation_code: "plan1", name: "1.5GB - 30 days", variation_amount: "100", fixedPrice: "Yes" },
    { variation_code: "plan2", name: "Special Bundle", variation_amount: "120", fixedPrice: "Yes" }
  ] } });
  assert.deepEqual(result.plans[0].statedSize, { value: 1.5, unit: "GB" });
  assert.deepEqual(result.plans[0].statedValidity, { value: 30, unit: "days" });
  assert.equal(result.plans[0].publishable, false);
  assert.ok(result.plans[1].reviewFlags.includes("size-not-obvious-in-plan-name"));
  assert.ok(result.plans[1].reviewFlags.includes("validity-not-obvious-in-plan-name"));
  assert.equal(result.plans[1].publishable, false);
});

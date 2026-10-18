/**
 * HarvestHome VTpass catalogue review helpers.
 * Pure functions only: no network requests, credentials, payments, provider calls,
 * or production integration. Deliberately fails closed on conflicting variation codes.
 */

/** Classify a provider bundle for display/review. This is a heuristic, not provider validation. */
export function classifyBundle(name = "") {
  const value = String(name).toLowerCase();
  // Combined bundles must be checked before generic voice/night categories.
  if (/(?:\d+(?:\.\d+)?\s*(?:tb|gb|mb|kb)|data)/i.test(value)
      && /xtratalk|voice|minutes|secs|airtime|\b\d+\s*(?:seconds?|secs?|mins?|minutes?)\b/i.test(value)) {
    return "combined-data-voice";
  }
  if (/\bxtradata\b/.test(value)) return "xtradata";
  if (/xtratalk|voice|minutes|secs|airtime/.test(value)) return "voice";
  if (/whatsapp|instagram|tiktok|telegram|youtube|opera|social|\bwtf\b/.test(value)) return "app-specific";
  if (/glo tv|\btv\b|vod|streaming/.test(value)) return "video-streaming";
  if (/night/.test(value)) return "night-bonus";
  if (/\bsme\b/.test(value)) return "sme";
  if (/special|weekend|mega/.test(value)) return "special";
  return "standard-data";
}

// Owner decision: exclude these ambiguous codes even if a later catalogue response
// returns only one row for them. Re-enable only after an explicit owner decision.
const OWNER_EXCLUDED_CODES = new Set([
  "mtn-xtratalk-300",
  "glo-mega-75000",
  "eti-1000"
]);

function fingerprint(item) {
  return JSON.stringify([
    String(item.name ?? "").trim(),
    Number(item.variation_amount),
    String(item.fixedPrice ?? "")
  ]);
}

/**
 * Extract human-readable size and validity hints for manual review only.
 * This is deliberately conservative: it does not infer provider eligibility
 * and does not make a plan publishable.
 */
export function extractPlanMetadata(name = "") {
  const value = String(name);
  const sizeMatch = value.match(/\b(\d+(?:\.\d+)?)\s*(TB|GB|MB|KB)\b/i);
  const validityMatch = value.match(/\b(\d+)\s*(days?|d|hours?|hrs?|h|weeks?|wks?|months?|mos?)\b/i);
  return {
    statedSize: sizeMatch ? { value: Number(sizeMatch[1]), unit: sizeMatch[2].toUpperCase() } : null,
    statedValidity: validityMatch ? { value: Number(validityMatch[1]), unit: validityMatch[2].toLowerCase() } : null
  };
}

/**
 * Read only content.variations (never the misspelled duplicate varations field).
 * Conflicting codes are quarantined as a group so no ambiguous item is publishable.
 */
export function normalizeCatalogue(payload, { network = "", serviceId = "" } = {}) {
  const source = payload?.providerResponse?.content?.variations
    ?? payload?.content?.variations;

  if (!Array.isArray(source)) {
    return {
      network, serviceId, sourceCount: 0, uniqueCount: 0,
      plans: [], quarantined: [{ reason: "missing-canonical-variations-array" }]
    };
  }

  const byCode = new Map();
  const quarantined = [];
  let invalidCount = 0;

  for (const raw of source) {
    const code = String(raw?.variation_code ?? "").trim();
    const amount = Number(raw?.variation_amount);
    const name = String(raw?.name ?? "").trim();

    if (!code || !name || !Number.isFinite(amount) || amount < 0) {
      invalidCount += 1;
      quarantined.push({ code: code || null, name: name || null, reason: "invalid-code-name-or-amount" });
      continue;
    }
    const item = { code, name, providerAmount: amount, providerAmountRaw: String(raw.variation_amount), fixedPrice: raw.fixedPrice ?? null };
    // Provider variation codes are identifiers; compare case-insensitively so
    // case-only differences cannot slip through as separate purchasable plans.
    const codeKey = code.toLowerCase();
    const group = byCode.get(codeKey) ?? { code, items: [] };
    group.items.push(item);
    byCode.set(codeKey, group);
  }

  const plans = [];
  let duplicateExactCount = 0;
  const conflictCodes = [];
  const excludedCodes = [];

  for (const { code, items } of byCode.values()) {
    if (OWNER_EXCLUDED_CODES.has(code.toLowerCase())) {
      excludedCodes.push(code);
      quarantined.push({
        code,
        reason: "owner-excluded-conflicting-code",
        candidates: items.map(({ name, providerAmount, providerAmountRaw, fixedPrice }) =>
          ({ name, providerAmount, providerAmountRaw, fixedPrice }))
      });
      continue;
    }
    const uniqueByFingerprint = new Map();
    for (const item of items) uniqueByFingerprint.set(fingerprint({
      name: item.name, variation_amount: item.providerAmount, fixedPrice: item.fixedPrice
    }), item);
    const distinct = [...uniqueByFingerprint.values()];

    if (distinct.length > 1) {
      conflictCodes.push(code);
      quarantined.push({
        code,
        reason: "conflicting-variation-code",
        candidates: distinct.map(({ name, providerAmount, providerAmountRaw, fixedPrice }) =>
          ({ name, providerAmount, providerAmountRaw, fixedPrice }))
      });
      continue;
    }

    duplicateExactCount += Math.max(0, items.length - 1);
    const item = distinct[0];
    const metadata = extractPlanMetadata(item.name);
    const reviewFlags = ["verify-provider-eligibility-and-provider-cost"];
    if (!metadata.statedSize && classifyBundle(item.name) !== "voice") reviewFlags.push("size-not-obvious-in-plan-name");
    if (!metadata.statedValidity) reviewFlags.push("validity-not-obvious-in-plan-name");
    plans.push({
      network,
      serviceId,
      code: item.code,
      name: item.name,
      providerAmount: item.providerAmount,
      providerAmountRaw: item.providerAmountRaw,
      fixedPrice: item.fixedPrice,
      bundleType: classifyBundle(item.name),
      statedSize: metadata.statedSize,
      statedValidity: metadata.statedValidity,
      status: "review-required",
      customerPrice: null,
      publishable: false,
      reviewFlags
    });
  }

  return {
    network, serviceId, sourceCount: source.length,
    uniqueCount: plans.length,
    duplicateExactCount,
    invalidCount,
    conflictCodes,
    excludedCodes,
    plans,
    quarantined
  };
}

/**
 * Finds the lowest whole-naira retail price that meets a target contribution.
 * Caller must supply an up-to-date fee calculator; no Paystack fee is assumed.
 * Returns null if no price is found within maxPrice.
 */
export function minimumRetailPrice({
  providerCost,
  estimatePaymentFee,
  targetProfit = 30,
  maxPrice = 1000000
}) {
  const cost = Number(providerCost);
  if (!Number.isFinite(cost) || cost < 0) throw new TypeError("providerCost must be a non-negative number");
  if (typeof estimatePaymentFee !== "function") throw new TypeError("estimatePaymentFee must be a function");
  if (!Number.isFinite(targetProfit) || targetProfit < 0) throw new TypeError("targetProfit must be non-negative");
  if (!Number.isFinite(maxPrice) || maxPrice < cost) return null;

  for (let price = Math.ceil(cost); price <= maxPrice; price += 1) {
    const fee = Number(estimatePaymentFee(price));
    if (!Number.isFinite(fee) || fee < 0) throw new TypeError("fee calculator must return a non-negative number");
    const contribution = price - cost - fee;
    if (contribution + 1e-9 >= targetProfit) {
      return { customerPrice: price, estimatedFee: fee, estimatedContribution: contribution };
    }
  }
  return null;
}

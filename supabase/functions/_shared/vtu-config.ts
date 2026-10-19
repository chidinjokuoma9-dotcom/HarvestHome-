/**
 * Shared guards for the isolated HarvestHome VTU Edge Functions.
 * Development branch only. Customer checkout is disabled unless explicitly enabled
 * in the function environment after the migration, pricing and provider approvals.
 */
export type VtuCatalogueItem = {
  productKey: string;
  network: "MTN" | "AIRTEL" | "GLO" | "9MOBILE";
  productType: "data" | "airtime";
  serviceId: string;
  variationCode: string | null;
  productLabel: string;
  amountKobo: number;
  providerAmountKobo: number;
  active: boolean;
};

export function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

export function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("VTU_ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && allowed.includes(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export function isOriginAllowed(req: Request): boolean {
  const origin = req.headers.get("Origin");
  // Server-to-server requests without Origin are allowed; browser requests must match
  // an explicit allowlist. Never fall back to wildcard CORS.
  if (!origin) return true;
  const allowed = (Deno.env.get("VTU_ALLOWED_ORIGINS") ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes(origin);
}

export function loadCatalogue(): VtuCatalogueItem[] {
  const raw = Deno.env.get("VTPASS_VTU_CATALOGUE_JSON");
  if (!raw) throw new Error("Approved VTU catalogue is not configured.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("VTU catalogue configuration is invalid JSON."); }
  if (!Array.isArray(parsed)) throw new Error("VTU catalogue configuration must be an array.");
  const seen = new Set<string>();
  const items: VtuCatalogueItem[] = [];
  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;
    const row = value as Record<string, unknown>;
    const productKey = typeof row.productKey === "string" ? row.productKey.trim() : "";
    const network = typeof row.network === "string" ? row.network.trim().toUpperCase() : "";
    const productType = typeof row.productType === "string" ? row.productType.trim().toLowerCase() : "";
    const serviceId = typeof row.serviceId === "string" ? row.serviceId.trim() : "";
    const variationCode = row.variationCode == null ? null : String(row.variationCode).trim();
    const productLabel = typeof row.productLabel === "string" ? row.productLabel.trim() : "";
    const amountKobo = Number(row.amountKobo);
    const providerAmountKobo = Number(row.providerAmountKobo);
    const active = row.active === true;
    if (!productKey || seen.has(productKey) || !["MTN", "AIRTEL", "GLO", "9MOBILE"].includes(network)
      || !["data", "airtime"].includes(productType) || !serviceId || !productLabel
      || !Number.isSafeInteger(amountKobo) || amountKobo <= 0
      || !Number.isSafeInteger(providerAmountKobo) || providerAmountKobo <= 0
      || (productType === "data" && !variationCode)
      || (productType === "airtime" && variationCode !== null)) {
      throw new Error("VTU catalogue contains an invalid or duplicate product entry.");
    }
    seen.add(productKey);
    items.push({ productKey, network: network as VtuCatalogueItem["network"],
      productType: productType as VtuCatalogueItem["productType"], serviceId,
      variationCode, productLabel, amountKobo, providerAmountKobo, active });
  }
  return items;
}

export function normalizeNigerianPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const digits = input.replace(/[\s()+.-]/g, "");
  if (/^0[789][01]\d{8}$/.test(digits)) return "234" + digits.slice(1);
  if (/^234[789][01]\d{8}$/.test(digits)) return digits;
  return null;
}

export function parseJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

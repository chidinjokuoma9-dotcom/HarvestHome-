import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isOriginAllowed, jsonResponse, loadCatalogue, normalizeNigerianPhone, parseJsonObject } from "../_shared/vtu-config.ts";

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "POST only." }, 405, cors);
  if (!isOriginAllowed(req)) return jsonResponse({ error: "Origin is not allowed." }, 403, cors);

  // Deliberately disabled until pricing/provider approvals, reviewed schema rollout,
  // callback/checkout UI and owner launch approval are complete.
  if (Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true") {
    return jsonResponse({ ok: false, code: "VTU_CHECKOUT_DISABLED",
      message: "VTU order creation is disabled. No payment or provider request was sent." }, 503, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "VTU order service configuration is incomplete." }, 503, cors);
  }

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user?.id) return jsonResponse({ error: "Sign in required." }, 401, cors);

    const body = parseJsonObject(await req.json().catch(() => null));
    const productKey = typeof body.product_key === "string" ? body.product_key.trim() : "";
    const idempotencyKey = typeof body.idempotency_key === "string" ? body.idempotency_key.trim() : "";
    const phone = normalizeNigerianPhone(body.phone);
    if (!/^[A-Za-z0-9:_-]{16,160}$/.test(idempotencyKey)) {
      return jsonResponse({ error: "A valid idempotency_key of 16–160 characters is required." }, 400, cors);
    }
    if (!phone) return jsonResponse({ error: "Enter a valid Nigerian mobile number." }, 400, cors);
    if (!productKey || productKey.length > 100) return jsonResponse({ error: "Choose a valid product." }, 400, cors);

    // The client sends a product key only. Amount, network, VTpass service ID and
    // variation code are resolved from trusted server-side configuration.
    const catalogue = loadCatalogue();
    const item = catalogue.find((entry) => entry.productKey === productKey && entry.active);
    if (!item) return jsonResponse({ error: "This product is unavailable." }, 400, cors);

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("create_vtu_order", {
      p_user_id: user.id,
      p_idempotency_key: idempotencyKey,
      p_network: item.network,
      p_product_type: item.productType,
      p_service_id: item.serviceId,
      p_variation_code: item.variationCode,
      p_product_label: item.productLabel,
      p_recipient_phone: phone,
      p_amount_kobo: item.amountKobo,
    });
    if (error) {
      // Do not leak SQL/provider internals to the browser.
      return jsonResponse({ error: "Could not safely create the VTU order. Check the order status before trying again." }, 409, cors);
    }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row.order_id !== "string") {
      return jsonResponse({ error: "Order creation did not return a valid order ID." }, 500, cors);
    }

    return jsonResponse({
      ok: true,
      order_id: row.order_id,
      amount_kobo: Number(row.amount_kobo),
      currency: row.currency,
      product_type: item.productType,
      network: item.network,
      product_label: item.productLabel,
      order_status: row.order_status,
      payment_status: row.payment_status,
      created: row.was_created === true,
      next_step: "Call the isolated vtu-paystack-initialize function for this order. This endpoint does not initialize payment or contact VTpass.",
    }, 200, cors);
  } catch (error) {
    const message = error instanceof Error ? error.message : "VTU order creation failed safely.";
    // Configuration problems are operator-facing and must not reveal credentials.
    return jsonResponse({ error: message }, 503, cors);
  }
});

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://harvesthome.ng",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function validHttpsCallback(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !["harvesthome.ng", "www.harvesthome.ng"].includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  // This handler is deliberately inert until the schema is reviewed/migrated,
  // the callback page exists, and the owner explicitly enables VTU checkout.
  if (Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true") {
    return json({ error: "VTU checkout is disabled. No payment was initialized." }, 503);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    const callbackUrl = validHttpsCallback(Deno.env.get("VTU_CALLBACK_URL"));
    if (!url || !anonKey || !serviceKey || !paystackSecret || !callbackUrl) {
      return json({ error: "VTU checkout configuration is incomplete. No payment was initialized." }, 503);
    }

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Sign in required." }, 401);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return json({ error: "Invalid request body." }, 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return json({ error: "A valid order_id is required." }, 400);
    }

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: order, error: orderError } = await admin.from("vtu_orders")
      .select("id,user_id,payment_reference,payment_status,order_status,amount_kobo,currency,product_type,network,product_label")
      .eq("id", orderId).eq("user_id", user.id).maybeSingle();
    if (orderError) throw new Error("Could not read VTU order.");
    if (!order) return json({ error: "Order not found for this account." }, 404);
    if (order.payment_status !== "awaiting_payment" || order.order_status !== "awaiting_payment") {
      return json({ error: "This order is not eligible for checkout." }, 409);
    }
    const amountKobo = Number(order.amount_kobo);
    if (!Number.isSafeInteger(amountKobo) || amountKobo <= 0 || order.currency !== "NGN") {
      return json({ error: "Stored order amount is invalid. No payment was initialized." }, 409);
    }

    // Reuse the stored reference on retries. Never trust a reference or amount
    // supplied by the browser and never generate a new reference for this order.
    const reference = order.payment_reference || `VTU-${crypto.randomUUID().replaceAll("-", "")}`;
    const { data: reservation, error: reserveError } = await admin.rpc("reserve_vtu_payment_reference", {
      p_order_id: order.id,
      p_payment_reference: reference,
    });
    if (reserveError || !Array.isArray(reservation) || reservation.length !== 1) {
      return json({ error: "Could not reserve the single payment reference. Do not create another order; contact support if this persists." }, 409);
    }

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        amount: String(amountKobo),
        currency: "NGN",
        reference,
        callback_url: callbackUrl,
        metadata: {
          service: "vtu",
          order_id: order.id,
          user_id: user.id,
          product_type: order.product_type,
          network: order.network,
          product_label: order.product_label,
        },
      }),
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.status || !result?.data?.authorization_url || result?.data?.reference !== reference) {
      // The reference remains reserved. Do not generate another reference after
      // an uncertain initialization response; reconcile this reference first.
      return json({ error: "Paystack checkout could not be confirmed. The same order/reference must be reconciled before retrying.", reference }, 502);
    }

    return json({ authorization_url: result.data.authorization_url, reference, order_id: order.id });
  } catch {
    return json({ error: "VTU checkout could not be initialized safely. Do not create a duplicate order." }, 500);
  }
});

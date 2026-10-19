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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only." }, 405);

  // Verification remains gated until the reviewed VTU schema is migrated and
  // the isolated checkout route is explicitly enabled by the owner.
  if (Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true") {
    return json({ error: "VTU checkout is disabled. No order state was changed." }, 503);
  }

  try {
    const authorization = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!url || !anonKey || !serviceKey || !paystackSecret) {
      return json({ error: "VTU verification configuration is incomplete." }, 503);
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
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!/^[A-Za-z0-9.=-]{12,100}$/.test(reference)) return json({ error: "A valid payment reference is required." }, 400);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: order, error: orderError } = await admin.from("vtu_orders")
      .select("id,user_id,payment_reference,payment_status,order_status,amount_kobo,currency")
      .eq("payment_reference", reference).eq("user_id", user.id).maybeSingle();
    if (orderError) throw new Error("Could not read VTU order.");
    if (!order) return json({ error: "No VTU order matches this reference for your account." }, 404);

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.status || !result?.data) {
      return json({ error: "Paystack could not confirm this transaction. No fulfilment was started." }, 502);
    }

    const tx = result.data;
    const txReference = typeof tx.reference === "string" ? tx.reference : "";
    const txAmount = tx.amount;
    const txCurrency = typeof tx.currency === "string" ? tx.currency.toUpperCase() : "";
    const metadata = tx.metadata && typeof tx.metadata === "object" ? tx.metadata : {};
    if (
      txReference !== order.payment_reference ||
      !Number.isSafeInteger(txAmount) ||
      txAmount !== order.amount_kobo ||
      txCurrency !== "NGN" ||
      order.currency !== "NGN" ||
      String(metadata.user_id || "") !== user.id ||
      String(metadata.order_id || "") !== order.id ||
      String(metadata.service || "") !== "vtu"
    ) {
      return json({ error: "Payment details do not match this exact VTU order. It has been left unchanged for review." }, 409);
    }

    if (tx.status !== "success") {
      // Pending/failed states do not trigger VTpass. A future reviewed transition
      // function must handle failure/cancellation without guessing from redirects.
      return json({ verified: false, payment_status: tx.status || "unknown", order_id: order.id, fulfilment_started: false });
    }

    const { data: transition, error: transitionError } = await admin.rpc("mark_vtu_payment_verified", {
      p_order_id: order.id,
      p_payment_reference: order.payment_reference,
      p_verified_amount_kobo: txAmount,
      p_verified_currency: txCurrency,
      p_verified_status: tx.status,
    });
    if (transitionError || !Array.isArray(transition) || transition.length !== 1) {
      return json({ error: "Payment was reported successful but the order transition could not be confirmed. Do not pay again; support reconciliation is required.", reference }, 409);
    }

    // Deliberately does not call VTpass. Fulfilment needs a separately reviewed
    // atomic claim + reconciliation handler before this endpoint can vend value.
    return json({
      verified: true,
      order_id: order.id,
      payment_status: transition[0].payment_status,
      order_status: transition[0].order_status,
      fulfilment_started: false,
    });
  } catch {
    return json({ error: "VTU payment verification could not be completed safely. Do not make a second payment." }, 500);
  }
});

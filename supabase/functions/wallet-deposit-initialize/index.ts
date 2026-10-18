import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigin = Deno.env.get("WALLET_ALLOWED_ORIGIN") || "";
const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200, origin = "") {
  const headers = new Headers(corsHeaders);
  if (origin && allowedOrigin && origin === allowedOrigin) headers.set("Access-Control-Allow-Origin", allowedOrigin);
  return new Response(JSON.stringify(body), { status, headers });
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) return json({ error: "Origin not allowed" }, 403, "");
  const optionsHeaders = new Headers(corsHeaders);
  if (origin && allowedOrigin && origin === allowedOrigin) optionsHeaders.set("Access-Control-Allow-Origin", allowedOrigin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: optionsHeaders });
  if (req.method !== "POST") return json({ error: "POST requests only" }, 405, origin);

  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!url || !anonKey || !serviceKey || !paystackSecret) {
      throw new Error("Wallet deposit service is not configured");
    }

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Sign in to fund your wallet." }, 401, origin);

    const body = await req.json();
    const amountNaira = Number(body.amount_naira);
    if (!Number.isSafeInteger(amountNaira) || amountNaira < 100 || amountNaira > 500000) {
      return json({ error: "Enter a whole-naira amount between ₦100 and ₦500,000." }, 400, origin);
    }
    if (!user.email) return json({ error: "Your account needs a verified email before funding." }, 400, origin);

    const amountKobo = amountNaira * 100;
    const reference = "HHW_" + crypto.randomUUID().replaceAll("-", "");
    const serviceClient = createClient(url, serviceKey);

    const { error: intentError } = await serviceClient.from("wallet_deposit_intents").insert({
      reference,
      user_id: user.id,
      amount_kobo: amountKobo,
      currency: "NGN",
      status: "pending",
    });
    if (intentError) throw new Error("Could not create a wallet deposit request.");

    // Callback destination is server-controlled to avoid accepting arbitrary redirect URLs.
    const callbackUrl = Deno.env.get("WALLET_CALLBACK_URL") || "";

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        amount: amountKobo,
        currency: "NGN",
        reference,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        metadata: {
          kind: "harvesthome_wallet_deposit",
          user_id: user.id,
          wallet_deposit_reference: reference,
        },
      }),
    });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data?.authorization_url || result.data?.reference !== reference) {
      await serviceClient.from("wallet_deposit_intents")
        .update({ status: "failed", updated_at: new Date().toISOString() }).eq("reference", reference);
      throw new Error("Paystack could not start this deposit. Please try again.");
    }

    const { error: updateError } = await serviceClient.from("wallet_deposit_intents").update({
      status: "initialized",
      provider_reference: result.data.reference,
      authorization_url: result.data.authorization_url,
      access_code: result.data.access_code ?? null,
      updated_at: new Date().toISOString(),
    }).eq("reference", reference).eq("user_id", user.id).eq("status", "pending");
    if (updateError) throw new Error("Could not save the deposit checkout details.");

    return json({ authorization_url: result.data.authorization_url, reference, amount_kobo: amountKobo, currency: "NGN" }, 200, origin);
  } catch (error) {
    console.error("wallet-deposit-initialize error", error);
    return json({ error: error instanceof Error ? error.message : "Wallet deposit setup failed." }, 400, req.headers.get("Origin") || "");
  }
});

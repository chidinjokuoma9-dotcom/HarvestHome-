import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function signatureFor(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return bytesToHex(new Uint8Array(signature));
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST requests only" }, 405);

  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!secret || !url || !serviceKey) throw new Error("Wallet webhook is not configured");

    const rawBody = await req.text();
    const received = req.headers.get("x-paystack-signature") || "";
    const expected = await signatureFor(secret, rawBody);
    if (!received || !constantTimeEqual(expected, received.toLowerCase())) {
      return json({ error: "Invalid Paystack signature" }, 401);
    }

    const event = JSON.parse(rawBody);
    if (event?.event !== "charge.success") return json({ received: true, ignored: true });

    const tx = event.data;
    const reference = typeof tx?.reference === "string" ? tx.reference : "";
    if (!/^HHW_[a-f0-9]{32}$/i.test(reference)) {
      return json({ received: true, ignored: true, reason: "Not a HarvestHome wallet reference" });
    }

    const serviceClient = createClient(url, serviceKey);
    const { data: intent, error: intentError } = await serviceClient.from("wallet_deposit_intents")
      .select("reference,user_id,amount_kobo,currency,status,provider_reference")
      .eq("reference", reference).maybeSingle();
    if (intentError) throw intentError;
    if (!intent) {
      // Acknowledge unrelated or unknown references; never credit from webhook metadata alone.
      return json({ received: true, ignored: true, reason: "Deposit intent not found" });
    }
    if (String(tx.status) !== "success" ||
        Number(tx.amount) !== Number(intent.amount_kobo) ||
        String(tx.currency).toUpperCase() !== "NGN" ||
        intent.currency !== "NGN" ||
        String(tx.metadata?.kind || "") !== "harvesthome_wallet_deposit" ||
        String(tx.metadata?.user_id || "") !== intent.user_id ||
        String(tx.metadata?.wallet_deposit_reference || "") !== reference ||
        String(tx.reference) !== reference) {
      throw new Error("Webhook transaction does not match the wallet deposit intent");
    }

    const { data: credited, error: creditError } = await serviceClient.rpc("wallet_credit_deposit", {
      p_user_id: intent.user_id,
      p_amount_kobo: Number(intent.amount_kobo),
      p_reference: reference,
      p_provider_reference: String(tx.reference),
    });
    if (creditError) throw creditError;

    return json({ received: true, success: true, reference, idempotent: Boolean(credited?.idempotent) });
  } catch (error) {
    console.error("wallet-paystack-webhook error", error);
    return json({ error: error instanceof Error ? error.message : "Wallet webhook processing failed" }, 400);
  }
});

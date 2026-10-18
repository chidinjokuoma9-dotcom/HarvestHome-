import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST requests only" }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!url || !anonKey || !serviceKey || !paystackSecret) {
      throw new Error("Wallet verification service is not configured");
    }

    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Sign in to verify your wallet deposit." }, 401);

    const body = await req.json();
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (!/^HHW_[a-f0-9]{32}$/i.test(reference)) return json({ error: "Invalid wallet deposit reference." }, 400);

    const serviceClient = createClient(url, serviceKey);
    const { data: intent, error: intentError } = await serviceClient.from("wallet_deposit_intents")
      .select("reference,user_id,amount_kobo,currency,status,provider_reference")
      .eq("reference", reference).eq("user_id", user.id).maybeSingle();
    if (intentError) throw intentError;
    if (!intent) return json({ error: "This deposit request was not found for your account." }, 404);
    if (intent.status === "success") {
      const { data: wallet } = await serviceClient.from("wallet_accounts")
        .select("balance_kobo,currency").eq("user_id", user.id).maybeSingle();
      return json({ success: true, status: "success", reference, balance_kobo: wallet?.balance_kobo ?? null, idempotent: true });
    }
    if (!["initialized", "pending"].includes(intent.status)) {
      return json({ error: "This deposit is not awaiting verification.", status: intent.status }, 409);
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${paystackSecret}` },
    });
    const result = await response.json();
    if (!response.ok || !result.status || !result.data) {
      throw new Error("Paystack could not verify this transaction yet.");
    }
    const tx = result.data;
    if (String(tx.reference) !== reference) throw new Error("Paystack reference does not match this deposit.");
    if (String(tx.status) !== "success") {
      return json({ success: false, status: String(tx.status || "pending"), reference, message: "Payment is not confirmed yet. No wallet balance has been added." }, 202);
    }
    if (Number(tx.amount) !== Number(intent.amount_kobo)) throw new Error("Paid amount does not match the deposit request.");
    if (String(tx.currency).toUpperCase() !== "NGN" || intent.currency !== "NGN") throw new Error("Deposit currency must be NGN.");
    if (String(tx.metadata?.user_id || "") !== user.id ||
        String(tx.metadata?.kind || "") !== "harvesthome_wallet_deposit" ||
        String(tx.metadata?.wallet_deposit_reference || "") !== reference) {
      throw new Error("Paystack metadata does not match this user's wallet deposit.");
    }

    const { data: credited, error: creditError } = await serviceClient.rpc("wallet_credit_deposit", {
      p_user_id: user.id,
      p_amount_kobo: Number(intent.amount_kobo),
      p_reference: reference,
      p_provider_reference: String(tx.reference),
    });
    if (creditError) throw creditError;

    const { data: wallet, error: walletError } = await serviceClient.from("wallet_accounts")
      .select("balance_kobo,currency").eq("user_id", user.id).maybeSingle();
    if (walletError) throw walletError;
    return json({
      success: true,
      status: "success",
      reference,
      balance_kobo: wallet?.balance_kobo ?? credited?.balance_after_kobo ?? null,
      currency: "NGN",
      idempotent: Boolean(credited?.idempotent),
    });
  } catch (error) {
    console.error("wallet-deposit-verify error", error);
    return json({ error: error instanceof Error ? error.message : "Wallet deposit verification failed." }, 400);
  }
});

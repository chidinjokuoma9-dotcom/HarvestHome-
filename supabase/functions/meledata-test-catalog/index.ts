import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "GET") return json({ error: "GET only. Purchases are not enabled." }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const auth = req.headers.get("Authorization") || "";
    if (!supabaseUrl || !anonKey) return json({ error: "Authentication is not configured." }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return json({ error: "Sign in required." }, 401);

    const token = Deno.env.get("MELEDATA_API_KEY");
    if (!token) return json({ error: "MELEDATA_API_KEY is not configured as a server secret." }, 503);

    const headers = { "X-API-Key": token, "Accept": "application/json" };
    const base = "https://meledata.ng/api/v1/developer";

    // Fail closed: do not return catalog data unless the provider confirms this is a test token.
    const walletResponse = await fetch(base + "/wallet/", { headers });
    const wallet = await walletResponse.json().catch(() => null);
    if (!walletResponse.ok || wallet?.success !== true) {
      return json({ error: "Could not verify the MELE DATA token or its mode.", provider_status: walletResponse.status }, 502);
    }

    const walletData = wallet?.data;
    const isTest = walletData?.livemode === false || String(walletData?.mode || "").toLowerCase() === "test";
    if (!isTest || walletData?.livemode === true || String(walletData?.mode || "").toLowerCase() === "live") {
      return json({ error: "Safety check stopped: this endpoint only accepts a confirmed MELE DATA test token." }, 403);
    }

    const plansResponse = await fetch(base + "/data/plans", { headers });
    const plansPayload = await plansResponse.json().catch(() => null);
    if (!plansResponse.ok) {
      return json({ error: "MELE DATA did not return the plan catalog.", provider_status: plansResponse.status }, 502);
    }

    const plans = Array.isArray(plansPayload?.plans)
      ? plansPayload.plans.map((p: Record<string, unknown>) => ({
          plan_id: p.plan_id,
          plan_code: p.plan_code,
          network: p.network,
          plan_name: p.plan_name,
          data_size: p.data_size,
          validity: p.validity,
          price: p.price,
        }))
      : Array.isArray(plansPayload?.data?.plans)
        ? plansPayload.data.plans.map((p: Record<string, unknown>) => ({
            plan_id: p.plan_id,
            plan_code: p.plan_code,
            network: p.network,
            plan_name: p.plan_name,
            data_size: p.data_size,
            validity: p.validity,
            price: p.price,
          }))
        : null;

    if (!plans) return json({ error: "The plan catalog response was not in the expected format." }, 502);

    // Never return the provider token or wallet balance to the browser.
    return json({
      mode: "test",
      purchases_enabled: false,
      networks: ["MTN", "GLO", "AIRTEL", "9MOBILE"],
      plans,
    });
  } catch {
    return json({ error: "Unexpected test-catalog error. No purchase was attempted." }, 500);
  }
});

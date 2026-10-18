import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PREVIEW_ORIGIN = "https://meledata-test-harvesthome.chidinjokuoma9.workers.dev";
const ALLOWED_SERVICE_IDS = new Set(["mtn-data", "airtel-data", "glo-data", "etisalat-data"]);

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8",
  };
  if (origin === PREVIEW_ORIGIN) headers["Access-Control-Allow-Origin"] = PREVIEW_ORIGIN;
  return headers;
}

function json(data: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(origin),
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: origin === PREVIEW_ORIGIN ? 204 : 403,
      headers: corsHeaders(origin),
    });
  }
  if (origin !== PREVIEW_ORIGIN) {
    return json({ ok: false, mode: "sandbox", purchasesEnabled: false, error: "This read-only endpoint is restricted to the HarvestHome development preview." }, 403, origin);
  }
  if (req.method !== "GET") {
    return json({ ok: false, mode: "sandbox", purchasesEnabled: false, error: "GET only. This endpoint reads data variations and never submits a purchase." }, 405, origin);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const authorization = req.headers.get("Authorization") || "";
    if (!supabaseUrl || !anonKey) {
      return json({ ok: false, mode: "sandbox", purchasesEnabled: false, error: "Authentication is not configured." }, 503, origin);
    }
    if (!authorization.startsWith("Bearer ")) {
      return json({ ok: false, mode: "sandbox", purchasesEnabled: false, error: "Sign in required." }, 401, origin);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return json({ ok: false, mode: "sandbox", purchasesEnabled: false, error: "Sign in required." }, 401, origin);
    }

    const serviceID = new URL(req.url).searchParams.get("serviceID")?.trim().toLowerCase() || "";
    if (!ALLOWED_SERVICE_IDS.has(serviceID)) {
      return json({
        ok: false,
        mode: "sandbox",
        readOnly: true,
        purchasesEnabled: false,
        error: "Unsupported serviceID. Choose MTN, Airtel, Glo or 9mobile data.",
        allowedServiceIDs: [...ALLOWED_SERVICE_IDS],
      }, 400, origin);
    }

    const apiKey = Deno.env.get("VTPASS_API_KEY");
    const secretKey = Deno.env.get("VTPASS_SECRET_KEY");
    if (!apiKey || !secretKey) {
      return json({
        ok: false,
        mode: "sandbox",
        readOnly: true,
        purchasesEnabled: false,
        error: "VTpass sandbox credentials are not fully configured as server secrets.",
        missing: [
          ...(!apiKey ? ["VTPASS_API_KEY"] : []),
          ...(!secretKey ? ["VTPASS_SECRET_KEY"] : []),
        ],
      }, 503, origin);
    }

    const endpoint = "https://sandbox.vtpass.com/api/service-variations?serviceID=" + encodeURIComponent(serviceID);
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: {
        "api-key": apiKey,
        "secret-key": secretKey,
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(20000),
    });
    const raw = await upstream.text();
    let providerResponse: unknown;
    try {
      providerResponse = JSON.parse(raw);
    } catch {
      providerResponse = { message: "VTpass returned a non-JSON response." };
    }

    return json({
      ok: upstream.ok,
      mode: "sandbox",
      readOnly: true,
      purchasesEnabled: false,
      serviceID,
      providerHttpStatus: upstream.status,
      providerResponse,
      note: "Catalogue read only. This endpoint does not call the VTpass purchase API and does not approve plans or retail prices.",
    }, upstream.ok ? 200 : 502, origin);
  } catch {
    return json({
      ok: false,
      mode: "sandbox",
      readOnly: true,
      purchasesEnabled: false,
      error: "Could not read the VTpass sandbox data catalogue. No purchase was attempted.",
    }, 502, origin);
  }
});

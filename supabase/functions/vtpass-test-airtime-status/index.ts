import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only. This endpoint only re-queries an existing sandbox transaction; it never submits a purchase." }, 405);
  }

  const apiKey = Deno.env.get("VTPASS_API_KEY");
  const secretKey = Deno.env.get("VTPASS_SECRET_KEY");
  if (!apiKey || !secretKey) {
    return json({
      ok: false,
      mode: "sandbox",
      action: "requery",
      error: "VTpass sandbox credentials are not fully configured.",
      missing: [
        ...(!apiKey ? ["VTPASS_API_KEY"] : []),
        ...(!secretKey ? ["VTPASS_SECRET_KEY"] : []),
      ],
    }, 503);
  }

  let input: Record<string, unknown> = {};
  try {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed;
  } catch {
    return json({ ok: false, mode: "sandbox", action: "requery", error: "A JSON body with request_id is required. No provider request was sent." }, 400);
  }

  const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
  if (!/^\d{12}[a-f0-9]{10}$/i.test(requestId)) {
    return json({ ok: false, mode: "sandbox", action: "requery", error: "Invalid sandbox test request ID format. No provider request was sent." }, 400);
  }

  try {
    const upstream = await fetch("https://sandbox.vtpass.com/api/requery", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "secret-key": secretKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ request_id: requestId }),
      signal: AbortSignal.timeout(20000),
    });
    const raw = await upstream.text();
    let body: unknown;
    try { body = JSON.parse(raw); } catch { body = { message: "VTpass returned a non-JSON response." }; }
    return json({
      ok: upstream.ok,
      mode: "sandbox",
      testOnly: true,
      action: "requery",
      purchasesEnabledForCustomers: false,
      request_id: requestId,
      providerHttpStatus: upstream.status,
      providerResponse: body,
      interpretation: "Status re-query only; no airtime purchase was submitted. Confirm the provider transaction status before treating it as final.",
    }, upstream.ok ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      mode: "sandbox",
      testOnly: true,
      action: "requery",
      request_id: requestId,
      error: error instanceof Error ? error.message : "Unknown network error",
      interpretation: "Status could not be confirmed. Do not send another purchase; check the provider transaction history and retry status re-query later.",
    }, 502);
  }
});
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

function lagosRequestId() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const prefix = p.year + p.month + p.day + p.hour + p.minute;
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
  return prefix + suffix;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const value = await req.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ ok: false, error: "POST only. This endpoint supports one fixed sandbox test and status re-query." }, 405);
  }

  const apiKey = Deno.env.get("VTPASS_API_KEY");
  const secretKey = Deno.env.get("VTPASS_SECRET_KEY");
  if (!apiKey || !secretKey) {
    return json({
      ok: false,
      error: "VTpass sandbox credentials are not fully configured.",
      missing: [
        ...(!apiKey ? ["VTPASS_API_KEY"] : []),
        ...(!secretKey ? ["VTPASS_SECRET_KEY"] : []),
      ],
    }, 503);
  }

  const input = await readJson(req);
  if (input.action === "requery") {
    const requestId = typeof input.request_id === "string" ? input.request_id.trim() : "";
    if (!/^\d{12}[a-f0-9]{10}$/i.test(requestId)) {
      return json({ ok: false, mode: "sandbox", testOnly: true, error: "Invalid test request ID format. No provider request was sent." }, 400);
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
        interpretation: "Status could not be confirmed. Do not send another purchase; try status re-query later.",
      }, 502);
    }
  }

  const networkInput = typeof input.network === "string" ? input.network.toLowerCase() : "mtn";
  const networkConfig: Record<string, { serviceID: string; label: string }> = {
    mtn: { serviceID: "mtn", label: "MTN" },
    airtel: { serviceID: "airtel", label: "Airtel" },
    glo: { serviceID: "glo", label: "Glo" },
    etisalat: { serviceID: "etisalat", label: "9mobile" },
  };
  const selectedNetwork = networkConfig[networkInput];
  if (!selectedNetwork) {
    return json({
      ok: false,
      mode: "sandbox",
      testOnly: true,
      purchasesEnabledForCustomers: false,
      error: "Unsupported network. Choose mtn, airtel, glo, or etisalat. No provider request was sent.",
    }, 400);
  }

  const requestId = lagosRequestId();
  const payload = { request_id: requestId, serviceID: selectedNetwork.serviceID, amount: 100, phone: "08011111111" };
  try {
    const upstream = await fetch("https://sandbox.vtpass.com/api/pay", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "secret-key": secretKey,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    const raw = await upstream.text();
    let body: unknown;
    try { body = JSON.parse(raw); } catch { body = { message: "VTpass returned a non-JSON response." }; }
    return json({
      ok: upstream.ok,
      mode: "sandbox",
      testOnly: true,
      purchasesEnabledForCustomers: false,
      test: { network: selectedNetwork.label, serviceID: selectedNetwork.serviceID, amount: 100, phone: "08011111111" },
      request_id: requestId,
      providerHttpStatus: upstream.status,
      message: upstream.ok
        ? "Sandbox test request was sent. Review the provider response; this is not customer purchase functionality."
        : "VTpass sandbox returned an HTTP error. Review the provider response before continuing.",
      providerResponse: body,
    }, upstream.ok ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      mode: "sandbox",
      testOnly: true,
      request_id: requestId,
      message: "Could not complete the VTpass sandbox test request.",
      error: error instanceof Error ? error.message : "Unknown network error",
    }, 502);
  }
});
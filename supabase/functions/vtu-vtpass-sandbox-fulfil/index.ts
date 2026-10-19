import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, isOriginAllowed, jsonResponse, parseJsonObject } from "../_shared/vtu-config.ts";

function lagosRequestId(): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return values.year + values.month + values.day + values.hour + values.minute
    + crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function providerFields(value: unknown) {
  const body = parseJsonObject(value);
  const content = parseJsonObject(body.content);
  const transactions = parseJsonObject(content.transactions);
  const code = String(body.code ?? body.responseCode ?? "");
  const status = String(transactions.status ?? body.status ?? body.transactionStatus ?? "").trim().toLowerCase();
  const description = String(body.response_description ?? body.message ?? body.responseDescription ?? "");
  const transactionId = String(transactions.transactionId ?? transactions.transaction_id ?? body.transactionId ?? "");
  return { code, status, description, transactionId };
}

function safeProviderSnapshot(body: unknown) {
  const fields = providerFields(body);
  return {
    code: fields.code || null,
    status: fields.status || null,
    description: fields.description.slice(0, 240) || null,
    transaction_id: fields.transactionId.slice(0, 120) || null,
  };
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "POST only." }, 405, cors);
  if (!isOriginAllowed(req)) return jsonResponse({ error: "Origin is not allowed." }, 403, cors);

  // This development handler can only contact VTpass sandbox. No live API URL exists
  // in this file. All flags are off unless an operator explicitly configures them.
  if (Deno.env.get("VTU_CHECKOUT_ENABLED") !== "true"
    || Deno.env.get("VTPASS_SANDBOX_FULFILMENT_ENABLED") !== "true"
    || Deno.env.get("VTPASS_REQUEST_PAYLOAD_APPROVED") !== "true") {
    return jsonResponse({ ok: false, code: "VTPASS_SANDBOX_FULFILMENT_DISABLED",
      message: "VTpass sandbox fulfilment is disabled. No provider request was sent." }, 503, cors);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const apiKey = Deno.env.get("VTPASS_API_KEY");
  const secretKey = Deno.env.get("VTPASS_SECRET_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !apiKey || !secretKey) {
    return jsonResponse({ error: "VTpass sandbox fulfilment configuration is incomplete." }, 503, cors);
  }

  try {
    const authorization = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user?.id) return jsonResponse({ error: "Sign in required." }, 401, cors);

    const body = parseJsonObject(await req.json().catch(() => null));
    const orderId = typeof body.order_id === "string" ? body.order_id.trim() : "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return jsonResponse({ error: "A valid order_id is required." }, 400, cors);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: order, error: orderError } = await admin.from("vtu_orders")
      .select("id,user_id,payment_status,order_status,provider_request_id,provider_attempt_count,provider_status,network,product_type,service_id,variation_code,recipient_phone,provider_amount_kobo")
      .eq("id", orderId).eq("user_id", user.id).maybeSingle();
    if (orderError) throw new Error("Could not read VTU order.");
    if (!order) return jsonResponse({ error: "Order not found for this account." }, 404, cors);
    if (order.payment_status !== "verified") {
      return jsonResponse({ error: "Payment is not verified. No VTpass request was sent." }, 409, cors);
    }
    if (order.order_status === "succeeded") {
      return jsonResponse({ ok: true, order_id: order.id, order_status: "succeeded",
        message: "This order is already recorded as delivered; no new provider request was sent." }, 200, cors);
    }

    const apiHeaders = {
      "api-key": apiKey,
      "secret-key": secretKey,
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    let requestId = typeof order.provider_request_id === "string" ? order.provider_request_id : "";
    let providerHttpOk = false;
    let providerBody: unknown = null;
    let action: "purchase" | "requery" = "requery";

    if (requestId) {
      // Once a request ID exists, this endpoint only re-queries it. It never sends
      // a second purchase after a timeout, pending response or uncertain outcome.
      const response = await fetch("https://sandbox.vtpass.com/api/requery", {
        method: "POST", headers: apiHeaders,
        body: JSON.stringify({ request_id: requestId }),
        signal: AbortSignal.timeout(20000),
      });
      providerHttpOk = response.ok;
      providerBody = await response.json().catch(() => null);
      action = "requery";
    } else {
      if (order.order_status !== "payment_verified" || Number(order.provider_attempt_count) !== 0) {
        return jsonResponse({ error: "Order is not eligible for its one provider attempt. Manual reconciliation is required." }, 409, cors);
      }
      const providerAmountKobo = Number(order.provider_amount_kobo);
      if (!Number.isSafeInteger(providerAmountKobo) || providerAmountKobo <= 0 || providerAmountKobo % 100 !== 0) {
        return jsonResponse({ error: "The provider request amount is missing or invalid. No VTpass request was sent." }, 409, cors);
      }
      const candidateRequestId = lagosRequestId();
      const { data: claimed, error: claimError } = await admin.rpc("claim_vtu_provider_attempt", {
        p_order_id: order.id, p_provider_request_id: candidateRequestId,
      });
      if (claimError) throw new Error("Could not reserve the single VTpass attempt.");
      if (!Array.isArray(claimed) || claimed.length !== 1) {
        return jsonResponse({ error: "The VTpass attempt was not uniquely reserved. Do not retry with a new order; reconcile the existing order." }, 409, cors);
      }
      const claim = claimed[0];
      requestId = String(claim.provider_request_id ?? "");
      if (!requestId || requestId !== candidateRequestId) {
        return jsonResponse({ error: "Provider request reservation was inconsistent. Manual reconciliation is required." }, 409, cors);
      }

      const phone = String(claim.recipient_phone ?? "");
      const providerPhone = phone.startsWith("234") ? "0" + phone.slice(3) : phone;
      const payload: Record<string, unknown> = {
        request_id: requestId,
        serviceID: String(claim.service_id),
        amount: String(Number(claim.provider_amount_kobo) / 100),
        phone: providerPhone,
      };
      if (String(claim.product_type) === "data") {
        if (!claim.variation_code) {
          return jsonResponse({ error: "Data order has no approved variation code. The reserved attempt requires manual reconciliation." }, 409, cors);
        }
        payload.variation_code = String(claim.variation_code);
      }
      const response = await fetch("https://sandbox.vtpass.com/api/pay", {
        method: "POST", headers: apiHeaders, body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      providerHttpOk = response.ok;
      providerBody = await response.json().catch(() => null);
      action = "purchase";
    }

    const fields = providerFields(providerBody);
    let nextStatus = "manual_review";
    if (providerHttpOk && fields.code === "000" && ["delivered", "success", "successful"].includes(fields.status)) {
      nextStatus = "succeeded";
    } else if (providerHttpOk && ["pending", "initiated", "processing", "in progress"].includes(fields.status)) {
      nextStatus = "provider_pending";
    } else if (providerHttpOk && ["failed", "failure", "declined", "reversed"].includes(fields.status)) {
      nextStatus = "refund_pending";
    }

    const snapshot = safeProviderSnapshot(providerBody);
    const update: Record<string, unknown> = {
      order_status: nextStatus,
      provider_status: fields.status || (providerHttpOk ? "unknown" : "http_or_network_error"),
      provider_response_code: fields.code || null,
      provider_response: snapshot,
      updated_at: new Date().toISOString(),
    };
    if (nextStatus === "succeeded") update.completed_at = new Date().toISOString();

    const { error: updateError } = await admin.from("vtu_orders").update(update)
      .eq("id", order.id).eq("provider_request_id", requestId).eq("payment_status", "verified");
    if (updateError) throw new Error("Provider response could not be persisted. Re-query the same request ID; do not submit another purchase.");

    const eventKey = "provider_result_" + requestId + "_" + crypto.randomUUID().replaceAll("-", "").slice(0, 12);
    const { error: eventError } = await admin.from("vtu_order_events").insert({
      order_id: order.id,
      event_key: eventKey,
      event_type: action === "purchase" ? "provider_purchase_response" : "provider_status_requery",
      source: "vtpass",
      details: {
        action,
        request_id: requestId,
        http_ok: providerHttpOk,
        provider_code: fields.code || null,
        provider_status: fields.status || null,
        resulting_order_status: nextStatus,
      },
    });
    if (eventError) {
      return jsonResponse({ ok: false, order_id: order.id, order_status: nextStatus,
        request_id: requestId, needs_reconciliation: true,
        message: "Provider result was saved, but the audit event could not be written. Do not submit another purchase." }, 409, cors);
    }

    return jsonResponse({
      ok: nextStatus === "succeeded",
      order_id: order.id,
      order_status: nextStatus,
      provider_request_id: requestId,
      action,
      provider_code: fields.code || null,
      provider_status: fields.status || null,
      message: nextStatus === "succeeded"
        ? "VTpass sandbox reports delivery and the result was persisted."
        : nextStatus === "provider_pending"
        ? "VTpass is still processing. Re-query the same request ID; no second purchase will be sent."
        : nextStatus === "refund_pending"
        ? "VTpass reports a failure after payment. Reconciliation/refund review is required; no automatic retry will be sent."
        : "The provider result is uncertain or contradictory. Re-query the same request ID and reconcile manually.",
    }, nextStatus === "provider_pending" ? 202 : nextStatus === "succeeded" ? 200 : 409, cors);
  } catch (error) {
    // If the network call may have reached VTpass, do not send another purchase.
    return jsonResponse({ error: error instanceof Error ? error.message : "VTpass fulfilment requires reconciliation.",
      message: "Do not retry as a new purchase. Re-query the stored request ID or review the order." }, 502, cors);
  }
});

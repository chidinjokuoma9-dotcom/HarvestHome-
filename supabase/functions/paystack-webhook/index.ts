import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-paystack-signature",
  "Content-Type": "application/json",
};

function hexToBytes(hex: string) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

async function hmacSha512(secret: string, body: string) {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(body)
  );

  return new Uint8Array(signature);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "POST requests only" }),
      { status: 405, headers: cors }
    );
  }

  try {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");

    if (!secret) {
      throw new Error("PAYSTACK_SECRET_KEY is not configured");
    }

    const rawBody = await req.text();
    const signature = req.headers.get("x-paystack-signature") || "";

    if (!signature) {
      return new Response(
        JSON.stringify({ error: "Missing Paystack signature" }),
        { status: 401, headers: cors }
      );
    }

    const expected = await hmacSha512(secret, rawBody);
    const received = hexToBytes(signature);

    if (!constantTimeEqual(expected, received)) {
      return new Response(
        JSON.stringify({ error: "Invalid Paystack signature" }),
        { status: 401, headers: cors }
      );
    }

    const event = JSON.parse(rawBody);

    if (event.event !== "charge.success") {
      return new Response(
        JSON.stringify({ received: true, ignored: true }),
        { status: 200, headers: cors }
      );
    }

    const transaction = event.data;

    const reference = transaction?.reference;
    const amount = Number(transaction?.amount || 0);
    const currency = transaction?.currency || "NGN";

    if (!reference) {
      throw new Error("Payment reference is missing");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      (() => {
        try {
          const keys = JSON.parse(
            Deno.env.get("SUPABASE_SECRET_KEYS") || "{}"
          );
          return keys.default;
        } catch {
          return null;
        }
      })();

    if (!supabaseUrl || !serviceKey) {
      throw new Error("Supabase server credentials are not configured");
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: payment, error: paymentError } = await supabase
      .from("payments")
      .select(
        "id,user_id,listing_id,seller_id,service,amount,currency,reference,status"
      )
      .eq("reference", reference)
      .maybeSingle();

    if (paymentError) throw paymentError;

    if (!payment) {
      const { data: advertisingPayment, error: advertisingPaymentError } = await supabase
        .from("advertising_payments")
        .select("id,request_id,advertiser_email,reference,amount,currency,status")
        .eq("reference", reference)
        .maybeSingle();

      if (advertisingPaymentError) throw advertisingPaymentError;

      if (!advertisingPayment) {
        console.warn("Payment record not found:", reference);
        return new Response(
          JSON.stringify({
            received: true,
            reference,
            message: "Webhook received but payment record was not found",
          }),
          { status: 200, headers: cors }
        );
      }

      if (Number(advertisingPayment.amount) !== amount) {
        throw new Error("Advertising payment amount does not match the HarvestHome record");
      }

      if (advertisingPayment.status === "success") {
        return new Response(
          JSON.stringify({received:true,success:true,reference,advertising:true,request_id:advertisingPayment.request_id}),
          {status:200,headers:cors}
        );
      }

      const paidAt = transaction.paid_at || new Date().toISOString();

      const {error:adPaymentUpdateError}=await supabase
        .from("advertising_payments")
        .update({status:"success",paid_at:paidAt})
        .eq("id",advertisingPayment.id);
      if(adPaymentUpdateError)throw adPaymentUpdateError;

      const {error:requestUpdateError}=await supabase
        .from("advertising_requests")
        .update({payment_status:"success",payment_reference:reference})
        .eq("id",advertisingPayment.request_id);
      if(requestUpdateError)throw requestUpdateError;

      return new Response(
        JSON.stringify({
          received:true,
          success:true,
          advertising:true,
          reference,
          amount,
          currency,
          request_id:advertisingPayment.request_id
        }),
        {status:200,headers:cors}
      );
    }

    if (Number(payment.amount) !== amount) {
      throw new Error("Payment amount does not match the HarvestHome record");
    }

    const paidAt =
      transaction.paid_at || new Date().toISOString();

    const { error: updateError } = await supabase
      .from("payments")
      .update({
        status: "success",
        paid_at: paidAt,
      })
      .eq("id", payment.id);

    if (updateError) throw updateError;

    const listingTitle =
      transaction.metadata?.listing_title || null;

    const listingText = listingTitle
      ? ` for "${listingTitle}"`
      : "";

    const message =
      `Payment successful${listingText}. ` +
      `Amount: ${amount / 100} ${currency}. ` +
      `Reference: ${reference}.`;

    const notificationUser =
      payment.seller_id || payment.user_id;

    if (notificationUser) {
      const { error: notificationError } = await supabase
        .from("notifications")
        .insert({
          user_id: notificationUser,
          type: "payment_success",
          title: "Payment successful",
          message,
          listing_id: payment.listing_id || null,
        });

      if (notificationError) {
        console.warn(
          "Payment notification failed:",
          notificationError.message
        );
      }
    }

    return new Response(
      JSON.stringify({
        received: true,
        success: true,
        reference,
        amount,
        currency,
        listing_id: payment.listing_id || null,
      }),
      { status: 200, headers: cors }
    );
  } catch (error) {
    console.error(error);

    return new Response(
      JSON.stringify({
        error:
          error instanceof Error
            ? error.message
            : "Webhook processing failed",
      }),
      { status: 400, headers: cors }
    );
  }
});
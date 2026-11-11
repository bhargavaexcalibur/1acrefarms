// Cashfree PG (backup gateway): Create Order + Get Order + webhook signature. fetch and Web Crypto only.
// Docs: cashfree.com/docs/api-reference/payments/latest/orders/create,
// cashfree.com/docs/payments/online/webhooks/signature-verification
// Test mode uses https://sandbox.cashfree.com/pg; live uses https://api.cashfree.com/pg (see config.js).
import { fetchWithTimeout, safeJson } from "../http.js";
import { fromBase64, hmacSha256, timingSafeEqual } from "../crypto.js";
import { GatewayError } from "./razorpay.js";

const headers = (cfg, env) => ({
  "x-client-id": env.CASHFREE_APP_ID,
  "x-client-secret": env.CASHFREE_SECRET_KEY,
  "x-api-version": cfg.cashfreeApiVersion,
  "content-type": "application/json",
  accept: "application/json",
});

export function cashfreeConfigured(env) {
  return Boolean(env.CASHFREE_APP_ID && env.CASHFREE_SECRET_KEY);
}

const paiseToRupees = (p) => Math.round(p) / 100;

export async function createCashfreeOrder({ cfg, env, fetchImpl, order }) {
  if (!cashfreeConfigured(env)) throw new GatewayError("cashfree", 0, "not_configured");
  const c = order.customer;
  const meta = {};
  if (env.SITE_URL) meta.return_url = `${env.SITE_URL.replace(/\/$/, "")}/checkout-test/?order_id={order_id}`;
  if (env.PUBLIC_URL && env.PUBLIC_URL.startsWith("https://")) meta.notify_url = `${env.PUBLIC_URL.replace(/\/$/, "")}/cashfree-webhook`;
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${cfg.cashfreeApi}/orders`, {
      method: "POST",
      headers: headers(cfg, env),
      body: JSON.stringify({
        order_id: order.id, // 3-45 chars, letters/digits/-/_ : ours fits
        order_amount: paiseToRupees(order.totalPaise),
        order_currency: "INR",
        customer_details: {
          customer_id: "c" + order.id.replace(/[^A-Za-z0-9]/g, ""), // never the phone number
          customer_name: c.name,
          customer_email: c.email,
          customer_phone: c.phone,
        },
        order_meta: meta,
        order_note: `1acrefarms ${order.packs} pack(s)`,
      }),
    }, cfg.gatewayTimeoutMs);
  } catch (e) {
    throw new GatewayError("cashfree", 0, e?.name === "TimeoutError" ? "timeout" : "network");
  }
  if (!res.ok) throw new GatewayError("cashfree", res.status, res.status >= 500 ? "server_error" : "rejected");
  const data = await safeJson(res);
  if (!data || typeof data.payment_session_id !== "string" || data.order_id !== order.id) {
    throw new GatewayError("cashfree", res.status, "bad_response");
  }
  return { gwOrderId: order.id, client: { paymentSessionId: data.payment_session_id, mode: cfg.cashfreeJsMode } };
}

// Cashfree's recommended check after checkout: Get Order, order_status === "PAID" for the full amount.
export async function fetchCashfreePaid({ cfg, env, fetchImpl, gwOrderId, amountPaise }) {
  if (!cashfreeConfigured(env)) throw new GatewayError("cashfree", 0, "not_configured");
  const res = await fetchWithTimeout(fetchImpl, `${cfg.cashfreeApi}/orders/${encodeURIComponent(gwOrderId)}`, {
    method: "GET",
    headers: headers(cfg, env),
  }, cfg.gatewayTimeoutMs);
  if (!res.ok) throw new GatewayError("cashfree", res.status, "lookup_failed");
  const data = await safeJson(res);
  if (!data || data.order_status !== "PAID") return { paid: false, status: data?.order_status ?? null };
  return { paid: true, paymentId: data.cf_order_id ? `cf_order:${data.cf_order_id}` : null, amountOk: Math.round(Number(data.order_amount) * 100) === amountPaise };
}

// Webhook: x-webhook-signature = base64 HMAC-SHA256(x-webhook-timestamp + raw body, secret key).
// (Cashfree's Node sample concatenates with no separator. Prove it once with their Dev Studio
// "Webhook verification" tool before go-live; see README.)
export async function verifyCashfreeWebhook(secretKey, timestamp, rawBody, signatureB64) {
  if (!secretKey || !timestamp || !signatureB64) return false;
  const given = fromBase64(String(signatureB64));
  if (!given) return false;
  const expected = await hmacSha256(secretKey, String(timestamp) + rawBody);
  return timingSafeEqual(expected, given);
}

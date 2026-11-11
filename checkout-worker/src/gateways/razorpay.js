// Razorpay: Orders API + Standard Checkout signature + webhook signature. fetch and Web Crypto only.
// Docs: razorpay.com/docs/api/orders/create, .../web-integration/standard/integration-steps (step 5),
// razorpay.com/docs/webhooks/validate-test.
import { fetchWithTimeout, safeJson } from "../http.js";
import { fromHex, hmacSha256, timingSafeEqual } from "../crypto.js";

export class GatewayError extends Error {
  constructor(gateway, http, reason) {
    super(`${gateway}: ${reason}${http ? ` (http ${http})` : ""}`);
    this.gateway = gateway;
    this.http = http;
    this.reason = reason;
  }
}

const auth = (env) => "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);

export function razorpayConfigured(env) {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

export async function createRazorpayOrder({ cfg, env, fetchImpl, order }) {
  if (!razorpayConfigured(env)) throw new GatewayError("razorpay", 0, "not_configured");
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${cfg.razorpayApi}/orders`, {
      method: "POST",
      headers: { authorization: auth(env), "content-type": "application/json" },
      body: JSON.stringify({
        amount: order.totalPaise,
        currency: "INR",
        receipt: order.id, // max 40 chars; ours is 19
        notes: { our_order_id: order.id, mode: cfg.mode },
      }),
    }, cfg.gatewayTimeoutMs);
  } catch (e) {
    throw new GatewayError("razorpay", 0, e?.name === "TimeoutError" ? "timeout" : "network");
  }
  if (!res.ok) throw new GatewayError("razorpay", res.status, res.status >= 500 ? "server_error" : "rejected");
  const data = await safeJson(res);
  if (!data || typeof data.id !== "string" || data.amount !== order.totalPaise) throw new GatewayError("razorpay", res.status, "bad_response");
  return { gwOrderId: data.id, client: { keyId: env.RAZORPAY_KEY_ID, orderId: data.id } };
}

// Server-side truth for reconcile and /verify: is there a CAPTURED payment for this order, for the full amount?
export async function fetchRazorpayPaid({ cfg, env, fetchImpl, gwOrderId, amountPaise }) {
  if (!razorpayConfigured(env)) throw new GatewayError("razorpay", 0, "not_configured");
  const res = await fetchWithTimeout(fetchImpl, `${cfg.razorpayApi}/orders/${encodeURIComponent(gwOrderId)}/payments`, {
    method: "GET",
    headers: { authorization: auth(env) },
  }, cfg.gatewayTimeoutMs);
  if (!res.ok) throw new GatewayError("razorpay", res.status, "lookup_failed");
  const data = await safeJson(res);
  const items = Array.isArray(data?.items) ? data.items : [];
  const captured = items.find((p) => p && p.status === "captured");
  if (!captured) return { paid: false };
  return { paid: true, paymentId: captured.id, amountOk: captured.amount === amountPaise };
}

// Checkout success handler: signature = hex HMAC-SHA256(order_id + "|" + payment_id, key_secret).
// order_id must be the one WE stored, never the one the browser sends back.
export async function verifyRazorpayPayment(keySecret, storedOrderId, paymentId, signatureHex) {
  if (!keySecret || !storedOrderId || !paymentId || !signatureHex) return false;
  const given = fromHex(String(signatureHex));
  if (!given) return false;
  const expected = await hmacSha256(keySecret, `${storedOrderId}|${paymentId}`);
  return timingSafeEqual(expected, given);
}

// Webhook: X-Razorpay-Signature = hex HMAC-SHA256(raw body, webhook secret). Never parse before checking.
export async function verifyRazorpayWebhook(webhookSecret, rawBody, signatureHex) {
  if (!webhookSecret || !signatureHex) return false;
  const given = fromHex(String(signatureHex));
  if (!given) return false;
  const expected = await hmacSha256(webhookSecret, rawBody);
  return timingSafeEqual(expected, given);
}

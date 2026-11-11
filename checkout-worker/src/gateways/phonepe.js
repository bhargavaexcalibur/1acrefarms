// PhonePe PG, Standard Checkout v2: second backup gateway (default order Razorpay -> Cashfree -> PhonePe,
// see GATEWAY_ORDER in config.js). fetch and Web Crypto only, like the other two.
//
// Official docs followed (read 11-11-2026), all under
// https://developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/
//  - api-reference/authorization   POST {auth host}/v1/oauth/token, application/x-www-form-urlencoded:
//        client_id, client_version, client_secret, grant_type=client_credentials
//        -> { access_token, issued_at, expires_at (epoch SECONDS), token_type: "O-Bearer" }.
//        "Refresh before expiry"; do not fetch a token for every request.
//  - api-reference/create-payment  POST {pg host}/checkout/v2/pay, header Authorization: O-Bearer <access_token>
//        { merchantOrderId (max 63; only _ and - as special characters), amount (paise, min 100),
//          expireAfter (300-3600 s), paymentFlow: { type: "PG_CHECKOUT", message, merchantUrls: { redirectUrl } } }
//        -> { orderId, state: "PENDING", expireAt, redirectUrl }. The customer is sent to redirectUrl.
//  - api-reference/invoke-iframe-paypage  redirect mode: PhonePeCheckout.transact({ tokenUrl: redirectUrl })
//  - api-reference/order-status    GET {pg host}/checkout/v2/order/{merchantOrderId}/status?details=false
//        -> { orderId, state: PENDING | COMPLETED | FAILED, amount (paise), paymentDetails: [{ transactionId, state, ... }] }
//  - api-reference/webhook         Authentication type "SHA": PhonePe sends Authorization = SHA256(username:password).
//        Encoding taken from PhonePe's own Node SDK (pg-sdk-node 2.0.2, CommonUtils.isCallbackValid): lowercase hex of
//        sha256("<username>:<password>"), compared with the whole header. Events checkout.order.completed / .failed;
//        rely on the root payload.state; ignore the deprecated "type" field.
// Hosts (also identical to the SDK's BaseUrl.js): UAT https://api-preprod.phonepe.com/apis/pg-sandbox (token and pg);
// production https://api.phonepe.com/apis/identity-manager (token) and https://api.phonepe.com/apis/pg. Production is
// used ONLY with MODE=live (config.js).
//
// The SHA webhook header is a fixed value that does not sign the body, so the Worker never takes a PhonePe webhook
// body as proof of payment: it always asks the Order Status API (server to server) before marking anything paid.
import { fetchWithTimeout, safeJson } from "../http.js";
import { fromHex, sha256Bytes, timingSafeEqual } from "../crypto.js";
import { GatewayError } from "./razorpay.js";

const G = "phonepe";
const REFRESH_MARGIN_MS = 10 * 60 * 1000;
const tokenKey = (cfg) => `phonepe_token:${cfg.mode}`; // a UAT token is never reused against production

export function phonepeConfigured(env) {
  return Boolean(env.PHONEPE_CLIENT_ID && env.PHONEPE_CLIENT_SECRET && env.PHONEPE_CLIENT_VERSION);
}

const netReason = (e, prefix = "") => `${prefix}${e?.name === "TimeoutError" ? "timeout" : "network"}`;

// The PayPage must be on phonepe.com (UAT: mercury-uat.phonepe.com; production: mercury-t2.phonepe.com).
export function isPhonePePayPage(u) {
  try {
    const x = new URL(u);
    return x.protocol === "https:" && (x.hostname === "phonepe.com" || x.hostname.endsWith(".phonepe.com"));
  } catch {
    return false;
  }
}

// New token from PhonePe; the ready-made header value is cached in kv until 10 min before expires_at
// (half-way for a short-lived token; 15 min if PhonePe leaves expires_at out).
async function fetchToken({ cfg, env, fetchImpl, store, now }, ms) {
  const body = new URLSearchParams({
    client_id: String(env.PHONEPE_CLIENT_ID),
    client_version: String(env.PHONEPE_CLIENT_VERSION),
    client_secret: String(env.PHONEPE_CLIENT_SECRET),
    grant_type: "client_credentials",
  });
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${cfg.phonepeAuthApi}/v1/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
    }, ms);
  } catch (e) {
    throw new GatewayError(G, 0, netReason(e, "auth_"));
  }
  if (!res.ok) throw new GatewayError(G, res.status, "auth_failed");
  const data = await safeJson(res);
  if (!data || typeof data.access_token !== "string" || !data.access_token) throw new GatewayError(G, res.status, "auth_bad_response");
  const header = `${typeof data.token_type === "string" && data.token_type ? data.token_type : "O-Bearer"} ${data.access_token}`;
  const expMs = Number(data.expires_at) * 1000;
  let until;
  if (!Number.isFinite(expMs) || expMs <= 0) until = now + 15 * 60 * 1000;
  else if (expMs > now) until = Math.floor(expMs - Math.min(REFRESH_MARGIN_MS, (expMs - now) / 2));
  else until = null; // already expired by our clock: use it for this call only, never cache it
  if (until !== null) await store.kvSet(tokenKey(cfg), header, until);
  return header;
}

async function authHeader(deps, ms, fresh) {
  if (!fresh) {
    const cached = await deps.store.kvGet(tokenKey(deps.cfg), deps.now);
    if (cached) return cached;
  }
  return fetchToken(deps, ms);
}

// One PhonePe API call with the cached token. A 401 drops the token, fetches a new one and repeats the call once.
// Everything (token + call + retry) shares one deadline, so a PhonePe create is bounded by GATEWAY_TIMEOUT_MS.
async function callApi(deps, url, init, deadline) {
  const left = () => Math.max(1, deadline - Date.now());
  for (let attempt = 1; ; attempt++) {
    const authorization = await authHeader(deps, left(), attempt > 1);
    let res;
    try {
      res = await fetchWithTimeout(deps.fetchImpl, url, { ...init, headers: { ...init.headers, authorization } }, left());
    } catch (e) {
      throw new GatewayError(G, 0, netReason(e));
    }
    if (res.status === 401 && attempt === 1 && deadline > Date.now()) {
      await deps.store.kvDelete(tokenKey(deps.cfg));
      continue;
    }
    return res;
  }
}

const JSON_HEADERS = { "content-type": "application/json", accept: "application/json" };

export async function createPhonePeOrder({ cfg, env, fetchImpl, store, now, order }) {
  if (!phonepeConfigured(env)) throw new GatewayError(G, 0, "not_configured");
  // PhonePe sends the customer back here; the page then calls /verify (Order Status), never trusting the redirect.
  const site = String(env.SITE_URL || "https://1acrefarms.co.in").replace(/\/$/, "");
  const redirectUrl = `${site}${cfg.checkoutPath || "/checkout-test/"}?order_id=${encodeURIComponent(order.id)}&gw=phonepe`;
  const res = await callApi({ cfg, env, fetchImpl, store, now }, `${cfg.phonepeApi}/checkout/v2/pay`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      merchantOrderId: order.id, // ours: 19 chars, A-Z 0-9 and "-": within PhonePe's rule
      amount: order.totalPaise,
      expireAfter: cfg.phonepeExpireAfterSec,
      // No customer details: Standard Checkout does not need the name, phone or address.
      paymentFlow: { type: "PG_CHECKOUT", message: `1acrefarms order ${order.id}`, merchantUrls: { redirectUrl } },
    }),
  }, Date.now() + cfg.gatewayTimeoutMs);
  if (!res.ok) throw new GatewayError(G, res.status, res.status >= 500 ? "server_error" : "rejected");
  const data = await safeJson(res);
  if (!data || typeof data.orderId !== "string" || !isPhonePePayPage(data.redirectUrl)) throw new GatewayError(G, res.status, "bad_response");
  return { gwOrderId: order.id, client: { redirectUrl: data.redirectUrl, mode: cfg.phonepeMode } };
}

// Server-side truth for /verify, the webhook and reconcile: Order Status, root "state" for the full amount.
export async function fetchPhonePePaid({ cfg, env, fetchImpl, store, now, gwOrderId, amountPaise }) {
  if (!phonepeConfigured(env)) throw new GatewayError(G, 0, "not_configured");
  const res = await callApi({ cfg, env, fetchImpl, store, now },
    `${cfg.phonepeApi}/checkout/v2/order/${encodeURIComponent(gwOrderId)}/status?details=false`,
    { method: "GET", headers: JSON_HEADERS }, Date.now() + cfg.gatewayTimeoutMs);
  if (!res.ok) throw new GatewayError(G, res.status, "lookup_failed");
  const data = await safeJson(res);
  const state = typeof data?.state === "string" ? data.state : null;
  if (state !== "COMPLETED") return { paid: false, failed: state === "FAILED", status: state };
  const attempts = Array.isArray(data.paymentDetails) ? data.paymentDetails : [];
  const done = attempts.find((p) => p && p.state === "COMPLETED");
  const paymentId = done?.transactionId ? String(done.transactionId) : typeof data.orderId === "string" ? `pp_order:${data.orderId}` : null;
  return { paid: true, paymentId, amountOk: Number(data.amount) === amountPaise };
}

// Webhook (SHA authentication): Authorization header = lowercase hex sha256("<username>:<password>").
export async function verifyPhonePeWebhook(username, password, authorization) {
  if (!username || !password || typeof authorization !== "string") return false;
  const given = fromHex(authorization.trim());
  if (!given || given.length !== 32) return false;
  return timingSafeEqual(await sha256Bytes(`${username}:${password}`), given);
}

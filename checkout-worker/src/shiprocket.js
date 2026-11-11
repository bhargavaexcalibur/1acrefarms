// Shiprocket: login token (cached ~9 days) + POST /orders/create/adhoc with OUR order id as the
// idempotency key (Shiprocket rejects a repeated order_id with 422, so a retry can never double-book).
// Retry policy: 429 / 5xx / network / timeout are retried (with backoff); any other 4xx (e.g. 422) is not.
// Docs: apidocs.shiprocket.in (Authentication; Create Or Update Order > Create Custom Order). No sandbox.
import { fetchWithTimeout, safeJson } from "./http.js";
import { parcelFor, rupees } from "./pricing.js";

const TOKEN_KEY = "shiprocket_token";

export class ShiprocketError extends Error {
  constructor(http, reason, retryable, retryAfterMs = null) {
    super(`shiprocket: ${reason}${http ? ` (http ${http})` : ""}`);
    this.http = http;
    this.reason = reason;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

const isRetryableStatus = (s) => s === 429 || s >= 500;

function retryAfterMs(res) {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  return Number.isFinite(secs) ? Math.max(0, secs * 1000) : null;
}

async function login({ cfg, env, fetchImpl, store, now }) {
  if (!env.SHIPROCKET_API_EMAIL || !env.SHIPROCKET_API_PASSWORD) throw new ShiprocketError(0, "not_configured", false);
  let res;
  try {
    res = await fetchWithTimeout(fetchImpl, `${cfg.shiprocketApi}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: env.SHIPROCKET_API_EMAIL, password: env.SHIPROCKET_API_PASSWORD }),
    }, cfg.shiprocketTimeoutMs);
  } catch (e) {
    throw new ShiprocketError(0, e?.name === "TimeoutError" ? "login_timeout" : "login_network", true);
  }
  if (!res.ok) throw new ShiprocketError(res.status, "login_failed", isRetryableStatus(res.status), retryAfterMs(res));
  const data = await safeJson(res);
  if (!data || typeof data.token !== "string") throw new ShiprocketError(res.status, "login_bad_response", true);
  await store.kvSet(TOKEN_KEY, data.token, now + cfg.shiprocketTokenTtlMs);
  return data.token;
}

async function token(deps, { fresh = false } = {}) {
  if (!fresh) {
    const cached = await deps.store.kvGet(TOKEN_KEY, deps.now);
    if (cached) return cached;
  }
  return login(deps);
}

// order_date in IST, "yyyy-mm-dd hh:mm"
function istDate(ms) {
  const d = new Date(ms + 5.5 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export function buildShiprocketOrder(order, cfg) {
  const c = order.customer;
  const [first, ...rest] = c.name.split(" ");
  const parcel = parcelFor(order.packs);
  return {
    order_id: order.id,
    order_date: istDate(order.paidAt ?? order.createdAt),
    pickup_location: cfg.shiprocketPickup,
    billing_customer_name: first,
    billing_last_name: rest.join(" "),
    billing_address: c.address,
    billing_city: c.city,
    billing_pincode: c.pin,
    billing_state: c.state,
    billing_country: "India",
    billing_email: c.email,
    billing_phone: c.phone,
    shipping_is_billing: true,
    order_items: order.items.map((l) => ({
      name: `${l.name} ${l.grams} g`,
      sku: l.sku,
      units: l.qty,
      selling_price: rupees(l.unitPaise), // per unit, GST-inclusive MRP
      ...(l.hsn ? { hsn: l.hsn } : {}),
    })),
    payment_method: "Prepaid",
    shipping_charges: rupees(order.deliveryPaise),
    sub_total: rupees(order.subtotalPaise), // Shiprocket does not compute it
    length: parcel.lengthCm,
    breadth: parcel.breadthCm,
    height: parcel.heightCm,
    weight: parcel.weightKg,
  };
}

// One HTTP attempt (re-logs in once on 401). Returns {srOrderId, srShipmentId} or throws ShiprocketError.
async function createOnce(deps, payload) {
  const { cfg, fetchImpl } = deps;
  for (let relogin = 0; relogin < 2; relogin++) {
    const tok = await token(deps, { fresh: relogin > 0 });
    let res;
    try {
      res = await fetchWithTimeout(fetchImpl, `${cfg.shiprocketApi}/orders/create/adhoc`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${tok}` },
        body: JSON.stringify(payload),
      }, cfg.shiprocketTimeoutMs);
    } catch (e) {
      throw new ShiprocketError(0, e?.name === "TimeoutError" ? "timeout" : "network", true);
    }
    if (res.status === 401 && relogin === 0) {
      await deps.store.kvDelete(TOKEN_KEY);
      continue;
    }
    if (!res.ok) throw new ShiprocketError(res.status, isRetryableStatus(res.status) ? "busy" : "rejected", isRetryableStatus(res.status), retryAfterMs(res));
    const data = await safeJson(res);
    if (!data || data.order_id === undefined || data.order_id === null) throw new ShiprocketError(res.status, "no_order_id", false);
    return { srOrderId: String(data.order_id), srShipmentId: data.shipment_id === undefined || data.shipment_id === null ? null : String(data.shipment_id) };
  }
  throw new ShiprocketError(401, "unauthorised", false);
}

// Up to `attempts` tries in this invocation, sleeping between retryable failures.
export async function pushToShiprocket(deps, order, attempts) {
  const payload = buildShiprocketOrder(order, deps.cfg);
  let last;
  let tried = 0;
  for (let i = 1; i <= attempts; i++) {
    tried = i;
    try {
      const out = await createOnce(deps, payload);
      return { ok: true, attempts: i, ...out };
    } catch (e) {
      last = e instanceof ShiprocketError ? e : new ShiprocketError(0, "unexpected", true);
      deps.log("shiprocket_attempt_failed", { orderId: order.id, attempt: i, http: last.http, reason: last.reason });
      if (!last.retryable || i === attempts) break;
      const backoff = Math.min(5000, last.retryAfterMs ?? 500 * 2 ** (i - 1));
      await deps.sleep(backoff);
    }
  }
  return { ok: false, retryable: last.retryable, http: last.http, reason: last.reason, attempts: tried };
}

// Delay before the scheduled job tries again, by retry round: 15 min, 30 min, 1 h, 2 h ... capped at 6 h.
export const nextRetryDelayMs = (round) => Math.min(6 * 3600 * 1000, 15 * 60 * 1000 * 2 ** Math.max(0, round - 1));

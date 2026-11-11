// Owner e-mail alerts through Resend (https://api.resend.com/emails). Best effort: an alert failure
// is logged and never breaks an order. Content rule: order id, packs, amounts, name, city and PIN only;
// never the phone number or street address (those stay in D1).
import { fetchWithTimeout } from "./http.js";

export async function sendOwnerAlert(deps, { subject, lines, throttleKey = null, throttleMs = 3600 * 1000 }) {
  const { cfg, env, fetchImpl, store, now, log } = deps;
  if (throttleKey) {
    if (await store.kvGet(`alert:${throttleKey}`, now)) return { sent: false, reason: "throttled" };
    await store.kvSet(`alert:${throttleKey}`, "1", now + throttleMs);
  }
  if (!env.RESEND_API_KEY) {
    log("alert_skipped", { reason: "no_resend_key" });
    return { sent: false, reason: "no_key" };
  }
  const r = await postResend(deps, {
    from: cfg.alertFrom,
    to: [cfg.alertTo],
    subject: `[1acrefarms checkout ${cfg.mode.toUpperCase()}] ${subject}`,
    text: lines.join("\n"),
  });
  if (!r.ok) {
    log("alert_failed", r.http ? { http: r.http } : { reason: r.reason });
    return { sent: false, reason: r.http ? "http" : "network" };
  }
  return { sent: true };
}

// One POST to Resend (https://api.resend.com/emails). Never throws. -> { ok, http, reason, retryable }
// Used by the owner alerts above and the customer confirmation (src/confirmation.js).
export async function postResend({ env, fetchImpl }, payload, { idempotencyKey = null, timeoutMs = 5000 } = {}) {
  try {
    const headers = { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" };
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
    const res = await fetchWithTimeout(fetchImpl, "https://api.resend.com/emails", {
      method: "POST", headers, body: JSON.stringify(payload),
    }, timeoutMs);
    if (!res.ok) return { ok: false, http: res.status, reason: "http", retryable: res.status === 429 || res.status >= 500 };
    return { ok: true, http: res.status };
  } catch (e) {
    return { ok: false, http: 0, reason: e?.name === "TimeoutError" ? "timeout" : "network", retryable: true };
  }
}

const inr = (paise) => `Rs ${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function orderSummary(order) {
  const c = order.customer || {};
  return [
    `Order: ${order.id} (${order.mode})`,
    `Gateway: ${order.gateway || "-"}${order.gwFailover ? ` (after ${order.gwFailover.split(",").map((f) => f.split(":").slice(0, 2).join(" ")).join(", ")})` : ""}  payment: ${order.paymentId || "-"}`,
    ...order.items.map((l) => `  ${l.qty} x ${l.name} ${l.grams} g [${l.sku}] @ ${inr(l.unitPaise)}`),
    `Total ${inr(order.totalPaise)} = MRPs ${inr(order.subtotalPaise)}${order.deliveryPaise ? ` + delivery ${inr(order.deliveryPaise)} (CHECK: should be free)` : ", delivery free"}`,
    `Customer: ${c.name || "-"}, ${c.city || "-"} ${c.pin || ""} (${c.state || "-"})`,
    "Phone and street address: in D1, see README 'Look up an order'.",
  ];
}

// 1acrefarms checkout Worker (Cloudflare Workers, ES modules). Plain JavaScript: fetch + Web Crypto only.
//
//   GET  /health            mode + whether new orders are accepted (no secrets)
//   POST /create-order      validate, price from OUR table (sum of MRPs; delivery free), then a gateway order: GATEWAY_ORDER
//                           (default Razorpay -> Cashfree -> PhonePe; next one on 4xx/5xx, network error or timeout)
//   POST /verify            Razorpay checkout signature, or Cashfree Get Order / PhonePe Order Status, after paying
//   POST /razorpay-webhook  signed (raw body HMAC), deduped by x-razorpay-event-id, answers fast
//   POST /cashfree-webhook  signed (timestamp + raw body HMAC, base64)
//   POST /phonepe-webhook   Authorization = sha256(username:password); deduped; paid only after Order Status says so
//   scheduled()             retries Shiprocket pushes, reconciles unpaid orders with the gateways
//
// Money only becomes "paid" through storage.markPaid(), which succeeds once per order; whoever wins
// that transition hands the order to Shiprocket and e-mails the customer's order confirmation
// (both in ctx.waitUntil, after the reply has gone).
import { checkoutGuard, loadConfig } from "./config.js";
import { HttpError, corsHeaders, fetchWithTimeout, json, readJson, readText, safeJson } from "./http.js";
import { makeLogger } from "./log.js";
import { quoteCart } from "./pricing.js";
import { validateCustomer } from "./validate.js";
import { sha256Hex } from "./crypto.js";
import { createD1Store } from "./storage/d1.js";
import { GatewayError, createRazorpayOrder, fetchRazorpayPaid, verifyRazorpayPayment, verifyRazorpayWebhook } from "./gateways/razorpay.js";
import { createCashfreeOrder, fetchCashfreePaid, verifyCashfreeWebhook } from "./gateways/cashfree.js";
import { createPhonePeOrder, fetchPhonePePaid, verifyPhonePeWebhook } from "./gateways/phonepe.js";
import { nextRetryDelayMs, pushToShiprocket } from "./shiprocket.js";
import { orderSummary, sendOwnerAlert } from "./alerts.js";
import { sendOrderConfirmation } from "./confirmation.js";
import { expectedDelivery } from "./delivery.js";

const SHIP_LEASE_MS = 2 * 60 * 1000;
const BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U

// ---------- order id: 1AF-T-261111-K7Q2XD (T = test, W = website live) ----------
function newOrderId(d) {
  const ist = new Date(d.now + 5.5 * 3600 * 1000);
  const ymd = String(ist.getUTCFullYear() % 100).padStart(2, "0") + String(ist.getUTCMonth() + 1).padStart(2, "0") + String(ist.getUTCDate()).padStart(2, "0");
  const rnd = Array.from(d.random(6), (b) => BASE32[b % 32]).join("");
  return `${d.cfg.orderPrefix}${ymd}-${rnd}`;
}

const publicLine = (l) => ({ code: l.code, sku: l.sku, name: l.name, grams: l.grams, qty: l.qty, unitPaise: l.unitPaise, totalPaise: l.totalPaise });

// ---------- gateways with failover (order from GATEWAY_ORDER, see config.js) ----------
const CREATORS = { razorpay: createRazorpayOrder, cashfree: createCashfreeOrder, phonepe: createPhonePeOrder };
const FETCHERS = { razorpay: fetchRazorpayPaid, cashfree: fetchCashfreePaid, phonepe: fetchPhonePePaid };

// "razorpay:server_error:503,cashfree:timeout:0": the gateways that failed before the one that took the order.
// Stored on the order (gw_failover) so every order records which gateway took it and why.
const failoverNote = (failures) => (failures.length ? failures.map((f) => `${f.gateway}:${f.reason}:${f.http}`).join(",").slice(0, 200) : null);

async function createGatewayOrder(d, order) {
  const failures = [];
  for (const gateway of d.cfg.gatewayOrder) {
    const t0 = Date.now();
    try {
      const out = await CREATORS[gateway]({ cfg: d.cfg, env: d.env, fetchImpl: d.fetchImpl, store: d.store, now: d.now, order });
      if (failures.length) {
        d.log("gateway_failover", { orderId: order.id, gateway, reason: failoverNote(failures) });
        d.defer(sendOwnerAlert(d, {
          subject: `Checkout failed over to ${gateway}`,
          lines: [`${failures.map((f) => `${f.gateway} failed: ${f.reason} (http ${f.http})`).join("\n")}`, `Order ${order.id} went to ${gateway}.`,
            `Gateway order now: ${d.cfg.gatewayOrder.join(" -> ")}.`,
            "If this repeats, check the gateway status page. One alert per hour at most."],
          throttleKey: "failover",
        }));
      }
      return { gateway, failures, ...out };
    } catch (e) {
      const f = e instanceof GatewayError ? e : new GatewayError(gateway, 0, "unexpected");
      failures.push(f);
      d.log("gateway_failed", { orderId: order.id, gateway, http: f.http, reason: f.reason, ms: Date.now() - t0 });
    }
  }
  return { failures };
}

// ---------- Turnstile (only when TURNSTILE_REQUIRED = "true") ----------
async function turnstileOk(d, token, ip) {
  if (!d.env.TURNSTILE_SECRET_KEY || typeof token !== "string" || !token) return false;
  const body = new URLSearchParams({ secret: d.env.TURNSTILE_SECRET_KEY, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchWithTimeout(d.fetchImpl, "https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body }, 5000);
    const data = await safeJson(res);
    return data?.success === true;
  } catch {
    return false;
  }
}

// ---------- POST /create-order ----------
async function createOrder(request, d) {
  const guard = checkoutGuard(d.cfg, d.env);
  if (!guard.ok) {
    d.log("order_refused", { reason: guard.code, mode: d.cfg.rawMode });
    throw new HttpError(503, "checkout_disabled", { reason: guard.code });
  }
  const body = await readJson(request, 8192);
  const v = validateCustomer(body.customer);
  const quote = quoteCart(body.items); // sum of MRP x qty; delivery is free everywhere
  const errors = [...v.errors, ...quote.errors];
  if (errors.length) throw new HttpError(400, "invalid", { errors });
  if (d.cfg.turnstileRequired && !(await turnstileOk(d, body.turnstileToken, request.headers.get("cf-connecting-ip")))) {
    throw new HttpError(403, "bot_check_failed");
  }
  for (const l of quote.lines) {
    const left = await d.store.getStock(l.code);
    if (left !== null && left < l.qty) throw new HttpError(409, "out_of_stock", { item: l.code });
  }

  const order = {
    id: newOrderId(d), createdAt: d.now, updatedAt: d.now, mode: d.cfg.mode, status: "new",
    items: quote.lines, packs: quote.packs,
    subtotalPaise: quote.subtotalPaise, deliveryPaise: quote.deliveryPaise, totalPaise: quote.totalPaise,
    customer: v.value,
  };
  await d.store.insertOrder(order);

  const gw = await createGatewayOrder(d, order);
  if (!gw.gateway) {
    await d.store.markGatewayError(order.id, d.now, failoverNote(gw.failures));
    d.log("gateway_all_failed", { orderId: order.id, count: gw.failures.length, reason: failoverNote(gw.failures) });
    d.defer(sendOwnerAlert(d, {
      subject: "Checkout DOWN: no payment gateway answered",
      lines: [...gw.failures.map((f) => `${f.gateway}: ${f.reason} (http ${f.http})`), `Last order attempt: ${order.id}. The customer saw "try again in a minute, or order from our Amazon.in store".`],
      throttleKey: "gateway_down",
    }));
    throw new HttpError(502, "payment_unavailable", { orderId: order.id });
  }
  await d.store.setGatewayOrder(order.id, gw.gateway, gw.gwOrderId, d.now, failoverNote(gw.failures));
  d.log("order_created", { orderId: order.id, gateway: gw.gateway, mode: d.cfg.mode, count: order.packs });

  return json({
    ok: true,
    orderId: order.id,
    mode: d.cfg.mode,
    gateway: gw.gateway,
    currency: "INR",
    lines: quote.lines.map(publicLine),
    packs: quote.packs,
    subtotalPaise: quote.subtotalPaise,
    totalPaise: quote.totalPaise, // = subtotalPaise: nothing is added to the MRPs
    [gw.gateway]: gw.client,
  });
}

// ---------- paid: the single hand-off point ----------
async function settlePaid(d, order, paymentId, source) {
  const shipStatus = d.cfg.shiprocketPush ? "pending" : "skipped";
  const won = await d.store.markPaid(order.id, { paymentId, source, now: d.now, shipStatus });
  if (!won) return false;
  d.log("order_paid", { orderId: order.id, gateway: order.gateway, status: source });
  d.defer(afterPaid(d, order.id, shipStatus));
  return true;
}

const SHIP_TEXT = {
  skipped: "not sent (Shiprocket push is off in test mode)",
  pushed: "order created in Shiprocket: choose the courier and print the label there",
  retry: "Shiprocket did not answer; retrying automatically (15 min, then longer)",
  not_claimed: "another run is sending it to Shiprocket",
};

const MAIL_TEXT = {
  sent: "order confirmation sent to the customer",
  no_sender: "NOT sent: CUSTOMER_MAIL_FROM is not set (README step 10)",
  no_key: "NOT sent: RESEND_API_KEY is not set",
  already_sent: "already sent earlier",
};
const mailText = (m) => MAIL_TEXT[m.sent ? "sent" : m.reason] || `NOT sent (${m.reason}): send the customer the order details by hand`;

async function afterPaid(d, orderId, shipStatus) {
  // Shiprocket and the customer e-mail run side by side, so neither waits for the other's retries.
  const [ship, mail] = await Promise.all([
    shipStatus === "pending" ? shipOrder(d, orderId, d.cfg.shiprocketInlineAttempts) : "skipped",
    d.store.getOrder(orderId).then((o) => sendOrderConfirmation(d, o)),
  ]);
  if (ship === "failed") { // shipOrder already sent the failure alert with the details
    if (!mail.sent && !["no_sender", "no_key", "already_sent"].includes(mail.reason)) {
      await sendOwnerAlert(d, { subject: `ACTION: send the order confirmation for ${orderId} by hand`, lines: [`Customer e-mail: ${mailText(mail)}.`] });
    }
    return;
  }
  const order = await d.store.getOrder(orderId);
  const parcelNote = order.packs > 3 ? ["Parcel size is an estimate for more than 3 packs: check the box before booking."] : [];
  await sendOwnerAlert(d, {
    subject: `New paid order ${order.id} (Rs ${(order.totalPaise / 100).toFixed(0)})`,
    lines: [...orderSummary(order), `Shiprocket: ${SHIP_TEXT[ship] || ship}`, `Customer e-mail: ${mailText(mail)}`, ...parcelNote],
  });
}

async function amountMismatch(d, order, source) {
  if (await d.store.markAmountMismatch(order.id, d.now)) {
    d.log("amount_mismatch", { orderId: order.id, gateway: order.gateway, status: source });
    d.defer(sendOwnerAlert(d, {
      subject: `CHECK: amount mismatch on ${order.id}`,
      lines: [...orderSummary(order), "The gateway reports a different paid amount. Not sent to Shiprocket. Check the gateway dashboard."],
    }));
  }
}

// Ask the gateway (server to server) whether the order is paid; settle if so.
// Returns paid | pending | failed (PhonePe says the order FAILED) | mismatch | unknown.
async function confirmWithGateway(d, orderId, source) {
  const order = await d.store.getOrder(orderId);
  if (!order) return "unknown";
  if (order.status === "paid") return "paid";
  const fetcher = FETCHERS[order.gateway];
  if (!order.gwOrderId || !fetcher) return "unknown";
  let r;
  try {
    r = await fetcher({ cfg: d.cfg, env: d.env, fetchImpl: d.fetchImpl, store: d.store, now: d.now, gwOrderId: order.gwOrderId, amountPaise: order.totalPaise });
  } catch (e) {
    d.log("gateway_lookup_failed", { orderId, gateway: order.gateway, http: e?.http, reason: e?.reason ?? e?.name });
    return "unknown";
  }
  if (!r.paid && r.failed) {
    if (await d.store.markPaymentFailed(order.id, d.now)) d.log("payment_failed", { orderId: order.id, gateway: order.gateway, status: source });
    return "failed";
  }
  if (!r.paid) return "pending";
  if (!r.amountOk) {
    await amountMismatch(d, order, source);
    return "mismatch";
  }
  await settlePaid(d, order, r.paymentId, source);
  return "paid";
}

// ---------- Shiprocket hand-off with lease, retry schedule and failure alert ----------
async function shipOrder(d, orderId, attempts) {
  if (!(await d.store.claimShipment(orderId, d.now, SHIP_LEASE_MS))) return "not_claimed";
  const order = await d.store.getOrder(orderId);
  const r = await pushToShiprocket(d, order, attempts);
  const total = order.shipAttempts + r.attempts;
  if (r.ok) {
    await d.store.updateShipment(orderId, { shipStatus: "pushed", shipAttempts: total, shipNextAt: null, shipError: null, srOrderId: r.srOrderId, srShipmentId: r.srShipmentId }, d.now);
    d.log("shiprocket_pushed", { orderId, attempts: total });
    return "pushed";
  }
  const why = `${r.reason}${r.http ? ` (http ${r.http})` : ""}`;
  if (r.retryable && total < d.cfg.shiprocketMaxAttempts) {
    const next = d.now + nextRetryDelayMs(Math.max(1, total - d.cfg.shiprocketInlineAttempts + 1));
    await d.store.updateShipment(orderId, { shipStatus: "retry", shipAttempts: total, shipNextAt: next, shipError: why }, d.now);
    d.log("shiprocket_retry_later", { orderId, attempts: total, reason: r.reason, http: r.http });
    return "retry";
  }
  await d.store.updateShipment(orderId, { shipStatus: "failed", shipAttempts: total, shipNextAt: null, shipError: why }, d.now);
  d.log("shiprocket_failed", { orderId, attempts: total, reason: r.reason, http: r.http });
  await sendOwnerAlert(d, {
    subject: `ACTION: book ${orderId} in Shiprocket by hand`,
    lines: [...orderSummary(order), `Shiprocket push failed after ${total} attempt(s): ${why}.`,
      "The money is captured; only dispatch is waiting. Enter the order in Shiprocket (Orders > Add Order) with this order id.",
      "If Shiprocket says the order id already exists, an earlier push went through: nothing to do."],
  });
  return "failed";
}

// ---------- POST /verify ----------
// Expected delivery window for the success page: dates only (no address), from the payment time and the stored PIN/state.
const deliveryWindow = (d, order) => {
  const w = expectedDelivery({ paidAt: order.paidAt ?? d.now, pin: order.customer?.pin, state: order.customer?.state });
  return w ? { from: w.from, to: w.to } : undefined;
};

async function verify(request, d) {
  const body = await readJson(request, 4096);
  const order = await d.store.getOrder(String(body.orderId || "").slice(0, 40));
  if (!order) throw new HttpError(404, "unknown_order");
  if (order.status === "paid") return json({ ok: true, status: "paid", orderId: order.id, delivery: deliveryWindow(d, order) });

  if (order.gateway === "razorpay") {
    if (body.razorpay_order_id && body.razorpay_order_id !== order.gwOrderId) throw new HttpError(400, "order_mismatch");
    const paymentId = String(body.razorpay_payment_id || "").slice(0, 64);
    const ok = await verifyRazorpayPayment(d.env.RAZORPAY_KEY_SECRET, order.gwOrderId, paymentId, String(body.razorpay_signature || ""));
    if (!ok) {
      d.log("verify_bad_signature", { orderId: order.id, gateway: "razorpay" });
      throw new HttpError(400, "bad_signature");
    }
    await d.store.markVerified(order.id, paymentId, d.now);
    d.log("payment_verified", { orderId: order.id, gateway: "razorpay" });
    // Capture is confirmed by the webhook; this server-side lookup is the belt-and-braces path.
    d.defer(confirmWithGateway(d, order.id, "verify"));
    return json({ ok: true, status: "verified", orderId: order.id, delivery: deliveryWindow(d, order) });
  }
  if (order.gateway === "cashfree" || order.gateway === "phonepe") {
    // Never the redirect or the popup's word: the Worker asks the gateway itself.
    const st = await confirmWithGateway(d, order.id, "verify");
    const delivery = st === "paid" ? deliveryWindow(d, (await d.store.getOrder(order.id)) || order) : undefined;
    return json({ ok: st === "paid", status: st, orderId: order.id, delivery }, st === "mismatch" ? 409 : 200);
  }
  throw new HttpError(409, "no_payment_started");
}

// ---------- POST /razorpay-webhook ----------
async function razorpayWebhook(request, d) {
  const raw = await readText(request, 256 * 1024);
  const ok = await verifyRazorpayWebhook(d.env.RAZORPAY_WEBHOOK_SECRET, raw, request.headers.get("x-razorpay-signature"));
  if (!ok) {
    d.log("webhook_bad_signature", { gateway: "razorpay" });
    throw new HttpError(401, "bad_signature");
  }
  const eventId = (request.headers.get("x-razorpay-event-id") || `sha:${await sha256Hex(raw)}`).slice(0, 100);
  const key = `rzp:${eventId}`;
  if (!(await d.store.recordEvent(key, d.now))) {
    d.log("webhook_duplicate", { gateway: "razorpay", duplicate: true });
    return json({ ok: true, duplicate: true });
  }
  try {
    const evt = JSON.parse(raw);
    const type = String(evt?.event || "");
    const payment = evt?.payload?.payment?.entity;
    const orderEnt = evt?.payload?.order?.entity;
    const gwOrderId = orderEnt?.id || payment?.order_id;
    const order = gwOrderId ? await d.store.findByGatewayOrder("razorpay", String(gwOrderId)) : null;
    if (!order) {
      // e.g. a Payment Page / Payment Link payment on the same Razorpay account: not ours, ignore.
      d.log("webhook_ignored", { gateway: "razorpay", event: type, reason: "unknown_order" });
      return json({ ok: true, ignored: true });
    }
    if (type === "order.paid" || type === "payment.captured") {
      if (!payment || payment.status !== "captured") {
        d.log("webhook_ignored", { orderId: order.id, gateway: "razorpay", event: type, reason: "not_captured" });
      } else if (payment.amount !== order.totalPaise) {
        await amountMismatch(d, order, "webhook");
      } else {
        await settlePaid(d, order, String(payment.id), "webhook");
      }
    } else if (type === "payment.failed") {
      await d.store.markPaymentFailed(order.id, d.now);
      d.log("payment_failed", { orderId: order.id, gateway: "razorpay" });
    } else {
      d.log("webhook_ignored", { orderId: order.id, gateway: "razorpay", event: type });
    }
    return json({ ok: true });
  } catch (e) {
    await d.store.forgetEvent(key); // let Razorpay's retry try again
    throw e;
  }
}

// ---------- POST /cashfree-webhook ----------
async function cashfreeWebhook(request, d) {
  const raw = await readText(request, 256 * 1024);
  const ok = await verifyCashfreeWebhook(d.env.CASHFREE_SECRET_KEY, request.headers.get("x-webhook-timestamp"), raw, request.headers.get("x-webhook-signature"));
  if (!ok) {
    d.log("webhook_bad_signature", { gateway: "cashfree" });
    throw new HttpError(401, "bad_signature");
  }
  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "bad_json");
  }
  const type = String(evt?.type || "");
  const payment = evt?.data?.payment;
  const ourId = String(evt?.data?.order?.order_id || "").slice(0, 45);
  const key = `cf:${type}:${payment?.cf_payment_id ?? `sha:${await sha256Hex(raw)}`}`.slice(0, 150);
  if (!(await d.store.recordEvent(key, d.now))) {
    d.log("webhook_duplicate", { gateway: "cashfree", duplicate: true });
    return json({ ok: true, duplicate: true });
  }
  try {
    const order = ourId ? await d.store.getOrder(ourId) : null;
    if (!order || order.gateway !== "cashfree") {
      d.log("webhook_ignored", { gateway: "cashfree", event: type, reason: "unknown_order" });
      return json({ ok: true, ignored: true });
    }
    if (type === "PAYMENT_SUCCESS_WEBHOOK" && payment?.payment_status === "SUCCESS") {
      if (Math.round(Number(payment.payment_amount) * 100) !== order.totalPaise) await amountMismatch(d, order, "webhook");
      else await settlePaid(d, order, String(payment.cf_payment_id), "webhook");
    } else if (type === "PAYMENT_FAILED_WEBHOOK" || type === "PAYMENT_USER_DROPPED_WEBHOOK") {
      await d.store.markPaymentFailed(order.id, d.now);
      d.log("payment_failed", { orderId: order.id, gateway: "cashfree", event: type });
    } else {
      d.log("webhook_ignored", { orderId: order.id, gateway: "cashfree", event: type });
    }
    return json({ ok: true });
  } catch (e) {
    await d.store.forgetEvent(key);
    throw e;
  }
}

// ---------- POST /phonepe-webhook ----------
// PhonePe's SHA header proves the caller knows our webhook username/password, but it does not sign the body.
// So the body only tells us WHICH order to look at: paid/failed is decided by the Order Status API, after the
// reply (PhonePe wants a 2xx within 3-5 s). A lookup that cannot decide lets PhonePe's retry try again.
const PHONEPE_ORDER_EVENTS = new Set(["checkout.order.completed", "checkout.order.failed", "pg.order.completed", "pg.order.failed"]);

async function phonepeWebhook(request, d) {
  const raw = await readText(request, 256 * 1024);
  const ok = await verifyPhonePeWebhook(d.env.PHONEPE_WEBHOOK_USERNAME, d.env.PHONEPE_WEBHOOK_PASSWORD, request.headers.get("authorization"));
  if (!ok) {
    d.log("webhook_bad_signature", { gateway: "phonepe" });
    throw new HttpError(401, "bad_signature");
  }
  let evt;
  try {
    evt = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "bad_json");
  }
  const type = String(evt?.event || "").slice(0, 60); // "type" is deprecated: PhonePe says use "event"
  const payload = evt?.payload;
  const ourId = String(payload?.merchantOrderId || "").slice(0, 63);
  const key = `pp:${type}:${ourId || `sha:${await sha256Hex(raw)}`}`.slice(0, 150);
  if (!(await d.store.recordEvent(key, d.now))) {
    d.log("webhook_duplicate", { gateway: "phonepe", duplicate: true });
    return json({ ok: true, duplicate: true });
  }
  const order = ourId ? await d.store.getOrder(ourId) : null;
  if (!order || order.gateway !== "phonepe") {
    d.log("webhook_ignored", { gateway: "phonepe", event: type, reason: "unknown_order" });
    return json({ ok: true, ignored: true });
  }
  if (!PHONEPE_ORDER_EVENTS.has(type)) {
    d.log("webhook_ignored", { orderId: order.id, gateway: "phonepe", event: type });
    return json({ ok: true, ignored: true });
  }
  d.defer((async () => {
    const st = await confirmWithGateway(d, order.id, "webhook");
    d.log("webhook_checked", { orderId: order.id, gateway: "phonepe", event: type, status: st });
    // Not settled either way: forget the event so PhonePe's retry (or the 15-min reconcile) decides later.
    if (st === "unknown" || st === "pending") await d.store.forgetEvent(key);
  })());
  return json({ ok: true });
}

// ---------- scheduled(): Shiprocket retries + reconcile ----------
export async function runScheduled(d) {
  const out = { shipments: {}, reconciled: {} };
  for (const o of await d.store.listShipmentsDue(d.now, 10)) {
    const r = await shipOrder(d, o.id, 1);
    out.shipments[r] = (out.shipments[r] || 0) + 1;
  }
  for (const o of await d.store.listUnpaidForReconcile(d.now, d.cfg.reconcileAfterMs, 10)) {
    await d.store.touchReconcile(o.id, d.now);
    const st = await confirmWithGateway(d, o.id, "reconcile");
    out.reconciled[st] = (out.reconciled[st] || 0) + 1;
    const age = d.now - o.createdAt;
    if (st === "pending" && o.status === "verified" && age > 3600 * 1000) {
      d.defer(sendOwnerAlert(d, {
        subject: `CHECK: ${o.id} paid at checkout but not captured`,
        lines: [`Razorpay accepted the payment signature for ${o.id} over an hour ago, but no captured payment is visible.`,
          "Check that auto-capture is ON (Razorpay Dashboard > Account & Settings > Payment capture)."],
        throttleKey: `uncaptured:${o.id}`, throttleMs: 24 * 3600 * 1000,
      }));
    }
    // failed (PhonePe reports a FAILED order) expires too, so old dead orders never crowd the 10-per-run reconcile
    if ((st === "pending" || st === "failed") && age > d.cfg.expireAfterMs) await d.store.markExpired(o.id, d.now);
  }
  d.log("scheduled_done", { count: Object.values(out.shipments).reduce((a, b) => a + b, 0) });
  return out;
}

// ---------- wiring ----------
export function createWorker(overrides = {}) {
  const log = overrides.log ?? makeLogger();
  function deps(env, ctx) {
    const cfg = loadConfig(env);
    const pending = [];
    const d = {
      cfg, env, log,
      store: overrides.store ?? createD1Store(env.DB),
      fetchImpl: overrides.fetch ?? ((url, init) => fetch(url, init)),
      now: (overrides.now ?? Date.now)(),
      sleep: overrides.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      random: overrides.random ?? ((n) => crypto.getRandomValues(new Uint8Array(n))),
      // background work after the reply (ctx.waitUntil); errors are logged, never thrown
      defer(promise) {
        const p = Promise.resolve(promise).catch((e) => log("background_error", { reason: e?.name || "error" }));
        if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
        else pending.push(p);
        return p;
      },
    };
    return d;
  }

  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const route = url.pathname.replace(/\/+$/, "") || "/";
      const origin = request.headers.get("origin");
      const browserRoute = route === "/create-order" || route === "/verify" || route === "/health";
      let d;
      try {
        d = deps(env, ctx);
      } catch (e) {
        makeLogger()("config_error", { reason: e?.name || "error" });
        return json({ ok: false, error: "server_misconfigured" }, 500);
      }
      const cors = browserRoute ? corsHeaders(origin, d.cfg) : null;
      const reply = (res) => {
        if (cors) for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
        return res;
      };

      if (request.method === "OPTIONS") {
        return cors ? new Response(null, { status: 204, headers: cors }) : new Response(null, { status: 403 });
      }
      if (browserRoute && origin && !cors) return json({ ok: false, error: "origin_not_allowed" }, 403);

      try {
        if (route === "/health" && request.method === "GET") {
          const g = checkoutGuard(d.cfg, env);
          // fssaiLic: the FSSAI licence number, only when FSSAI_ECOM_LIC holds a real 14-digit number (the page shows it then)
          return reply(json({ ok: true, mode: d.cfg.rawMode, checkout: g.ok ? "enabled" : "disabled", reason: g.ok ? undefined : g.code, gateways: d.cfg.gatewayOrder, fssaiLic: d.cfg.fssaiEcomLic || undefined }));
        }
        if (request.method !== "POST") return reply(json({ ok: false, error: "not_found" }, 404));
        if (route === "/create-order") return reply(await createOrder(request, d));
        if (route === "/verify") return reply(await verify(request, d));
        if (route === "/razorpay-webhook") return await razorpayWebhook(request, d);
        if (route === "/cashfree-webhook") return await cashfreeWebhook(request, d);
        if (route === "/phonepe-webhook") return await phonepeWebhook(request, d);
        return json({ ok: false, error: "not_found" }, 404);
      } catch (e) {
        if (e instanceof HttpError) return reply(json({ ok: false, error: e.code, ...e.extra }, e.status));
        log("unhandled_error", { route, reason: e?.name || "error" });
        return reply(json({ ok: false, error: "server_error" }, 500));
      }
    },

    async scheduled(controller, env, ctx) {
      const d = deps(env, ctx);
      await runScheduled(d);
    },
  };
}

export default createWorker();

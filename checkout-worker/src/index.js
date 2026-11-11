// 1acrefarms checkout Worker (Cloudflare Workers, ES modules). Plain JavaScript: fetch + Web Crypto only.
//
//   GET  /health            mode + whether new orders are accepted (no secrets)
//   POST /create-order      validate, price from OUR table, delivery fee, Razorpay order (Cashfree on failure)
//   POST /verify            Razorpay checkout signature, or Cashfree Get Order, after the customer pays
//   POST /razorpay-webhook  signed (raw body HMAC), deduped by x-razorpay-event-id, answers fast
//   POST /cashfree-webhook  signed (timestamp + raw body HMAC, base64)
//   scheduled()             retries Shiprocket pushes, reconciles unpaid orders with the gateways
//
// Money only becomes "paid" through storage.markPaid(), which succeeds once per order; whoever wins
// that transition hands the order to Shiprocket (in ctx.waitUntil, after the reply has gone).
import { checkoutGuard, loadConfig } from "./config.js";
import { HttpError, corsHeaders, fetchWithTimeout, json, readJson, readText, safeJson } from "./http.js";
import { makeLogger } from "./log.js";
import { quoteCart } from "./pricing.js";
import { validateCustomer } from "./validate.js";
import { sha256Hex } from "./crypto.js";
import { createD1Store } from "./storage/d1.js";
import { GatewayError, createRazorpayOrder, fetchRazorpayPaid, verifyRazorpayPayment, verifyRazorpayWebhook } from "./gateways/razorpay.js";
import { createCashfreeOrder, fetchCashfreePaid, verifyCashfreeWebhook } from "./gateways/cashfree.js";
import { nextRetryDelayMs, pushToShiprocket } from "./shiprocket.js";
import { orderSummary, sendOwnerAlert } from "./alerts.js";

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

// ---------- gateways with failover ----------
const CREATORS = { razorpay: createRazorpayOrder, cashfree: createCashfreeOrder };

async function createGatewayOrder(d, order) {
  const primary = d.cfg.primaryGateway;
  const sequence = [primary];
  if (d.cfg.backupEnabled) sequence.push(primary === "razorpay" ? "cashfree" : "razorpay");
  const failures = [];
  for (const gateway of sequence) {
    const t0 = Date.now();
    try {
      const out = await CREATORS[gateway]({ cfg: d.cfg, env: d.env, fetchImpl: d.fetchImpl, order });
      if (failures.length) {
        d.log("gateway_failover", { orderId: order.id, gateway, reason: failures.map((f) => `${f.gateway}:${f.reason}:${f.http}`).join(",") });
        d.defer(sendOwnerAlert(d, {
          subject: `Checkout failed over to ${gateway}`,
          lines: [`${failures.map((f) => `${f.gateway} failed: ${f.reason} (http ${f.http})`).join("\n")}`, `Order ${order.id} went to ${gateway}.`,
            "If this repeats, check the gateway status page. One alert per hour at most."],
          throttleKey: "failover",
        }));
      }
      return { gateway, ...out };
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
  const quote = quoteCart(body.items, v.value.pin);
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
    await d.store.markGatewayError(order.id, d.now);
    d.defer(sendOwnerAlert(d, {
      subject: "Checkout DOWN: no payment gateway answered",
      lines: [...gw.failures.map((f) => `${f.gateway}: ${f.reason} (http ${f.http})`), `Last order attempt: ${order.id}. The customer saw "try again or order on WhatsApp".`],
      throttleKey: "gateway_down",
    }));
    throw new HttpError(502, "payment_unavailable", { orderId: order.id });
  }
  await d.store.setGatewayOrder(order.id, gw.gateway, gw.gwOrderId, d.now);
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
    deliveryPaise: quote.deliveryPaise,
    totalPaise: quote.totalPaise,
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

async function afterPaid(d, orderId, shipStatus) {
  const ship = shipStatus === "pending" ? await shipOrder(d, orderId, d.cfg.shiprocketInlineAttempts) : "skipped";
  if (ship === "failed") return; // shipOrder already sent the failure alert with the details
  const order = await d.store.getOrder(orderId);
  const parcelNote = order.packs > 3 ? ["Parcel size is an estimate for more than 3 packs: check the box before booking."] : [];
  await sendOwnerAlert(d, {
    subject: `New paid order ${order.id} (Rs ${(order.totalPaise / 100).toFixed(0)})`,
    lines: [...orderSummary(order), `Shiprocket: ${SHIP_TEXT[ship] || ship}`, ...parcelNote],
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

// Ask the gateway (server to server) whether the order is paid; settle if so. Returns paid | pending | mismatch | unknown.
async function confirmWithGateway(d, orderId, source) {
  const order = await d.store.getOrder(orderId);
  if (!order) return "unknown";
  if (order.status === "paid") return "paid";
  if (!order.gwOrderId) return "unknown";
  const fetcher = order.gateway === "cashfree" ? fetchCashfreePaid : fetchRazorpayPaid;
  let r;
  try {
    r = await fetcher({ cfg: d.cfg, env: d.env, fetchImpl: d.fetchImpl, gwOrderId: order.gwOrderId, amountPaise: order.totalPaise });
  } catch (e) {
    d.log("gateway_lookup_failed", { orderId, gateway: order.gateway, http: e?.http, reason: e?.reason ?? e?.name });
    return "unknown";
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
async function verify(request, d) {
  const body = await readJson(request, 4096);
  const order = await d.store.getOrder(String(body.orderId || "").slice(0, 40));
  if (!order) throw new HttpError(404, "unknown_order");
  if (order.status === "paid") return json({ ok: true, status: "paid", orderId: order.id });

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
    return json({ ok: true, status: "verified", orderId: order.id });
  }
  if (order.gateway === "cashfree") {
    const st = await confirmWithGateway(d, order.id, "verify");
    return json({ ok: st === "paid", status: st, orderId: order.id }, st === "paid" || st === "pending" || st === "unknown" ? 200 : 409);
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
    if (st === "pending" && age > d.cfg.expireAfterMs) await d.store.markExpired(o.id, d.now);
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
          return reply(json({ ok: true, mode: d.cfg.rawMode, checkout: g.ok ? "enabled" : "disabled", reason: g.ok ? undefined : g.code }));
        }
        if (request.method !== "POST") return reply(json({ ok: false, error: "not_found" }, 404));
        if (route === "/create-order") return reply(await createOrder(request, d));
        if (route === "/verify") return reply(await verify(request, d));
        if (route === "/razorpay-webhook") return await razorpayWebhook(request, d);
        if (route === "/cashfree-webhook") return await cashfreeWebhook(request, d);
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

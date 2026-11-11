#!/usr/bin/env node
// Local smoke run: the real Worker code, the real schema.sql (SQLite standing in for D1), and MOCKED
// Razorpay / Cashfree / PhonePe / Shiprocket / Resend. No network, no accounts, no money.
//   node scripts/smoke.mjs
import assert from "node:assert/strict";
import { createD1Store } from "../src/storage/d1.js";
import { createSqliteD1 } from "../test/helpers/d1-sqlite.js";
import {
  CUSTOMER, TEST_ENV, harness, razorpaySignature, razorpayOrderPaidEvent, postRazorpayWebhook, cashfreeEvent, postCashfreeWebhook,
  phonepeEvent, postPhonePeWebhook,
} from "../test/helpers/harness.js";
import { CATALOGUE } from "../src/pricing.js";

const inr = (p) => `Rs ${(p / 100).toLocaleString("en-IN")}`;
let step = 0;
const ok = (msg) => console.log(`  ok ${String(++step).padStart(2)}  ${msg}`);
const newHarness = (env) => harness({ env, store: createD1Store(createSqliteD1()) });
const adhoc = (h) => h.mocks.calls.filter((c) => c.path === "/v1/external/orders/create/adhoc");

console.log("1acrefarms checkout smoke run (mocked gateways, SQLite D1, test mode)\n");

// A. Razorpay happy path ---------------------------------------------------------------------------
{
  const h = newHarness();
  const health = await h.call("GET", "/health");
  assert.deepEqual([health.body.mode, health.body.checkout, health.body.gateways.join(",")], ["test", "enabled", "razorpay,cashfree,phonepe"]);
  ok(`GET /health: mode test, checkout enabled, gateway order ${health.body.gateways.join(" -> ")}`);

  const r = await h.createOrder([{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], CUSTOMER);
  assert.equal(r.status, 200);
  assert.equal(r.body.gateway, "razorpay");
  assert.equal(r.body.totalPaise, (2 * CATALOGUE.TURM.mrp + CATALOGUE.CBEL.mrp) * 100);
  assert.equal(h.mocks.calls.find((c) => c.path === "/v1/orders").body.amount, r.body.totalPaise);
  ok(`create-order ${r.body.orderId}: 2 x Turmeric + 1 x Cane Jaggery to ${CUSTOMER.pin} = ${inr(r.body.totalPaise)} (MRPs only, delivery free) -> Razorpay ${r.body.razorpay.orderId} for exactly that`);

  const gw = r.body.razorpay.orderId;
  const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
  const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay, razorpay_signature: razorpaySignature(TEST_ENV.RAZORPAY_KEY_SECRET, gw, pay) } });
  assert.equal(v.body.status, "verified");
  ok("customer pays (mock capture) -> POST /verify: signature valid");

  const raw = razorpayOrderPaidEvent(gw, pay, r.body.totalPaise, { receipt: r.body.orderId });
  const t0 = Date.now();
  const w = await postRazorpayWebhook(h, raw, { eventId: "evt_smoke_1" });
  const ms = Date.now() - t0;
  assert.equal(w.status, 200);
  const dup = await postRazorpayWebhook(h, raw, { eventId: "evt_smoke_1" });
  assert.equal(dup.body.duplicate, true);
  ok(`POST /razorpay-webhook order.paid answered 200 in ${ms} ms; the same event again -> duplicate, dropped`);

  await h.drain();
  const o = await h.store.getOrder(r.body.orderId);
  assert.equal(o.status, "paid");
  assert.equal(o.shipStatus, "pushed");
  assert.equal(adhoc(h).length, 1);
  const sr = adhoc(h)[0].body;
  ok(`Shiprocket adhoc order (once): order_id ${sr.order_id}, ${sr.payment_method}, pickup "${sr.pickup_location}", ${sr.weight} kg ${sr.length}x${sr.breadth}x${sr.height} cm, sub_total ${sr.sub_total}`);
  const mails = h.mocks.state.resend.sent.map((m) => m.subject);
  assert.ok(mails.some((s) => s.includes("New paid order")));
  ok(`owner alert (Resend, mocked): "${mails.at(-1)}"`);
}

// B. Failover to Cashfree -------------------------------------------------------------------------
{
  const h = newHarness({ GATEWAY_TIMEOUT_MS: "50" });
  h.mocks.state.razorpay.create = "timeout";
  const r = await h.createOrder([{ code: "CBEL", qty: 1 }], { ...CUSTOMER, city: "New Delhi", state: "Delhi", pin: "110001" });
  assert.equal(r.body.gateway, "cashfree");
  assert.equal(r.body.totalPaise, CATALOGUE.CBEL.mrp * 100);
  ok(`Razorpay times out -> Cashfree sandbox order ${r.body.orderId}: 1 x Cane Jaggery to Delhi = ${inr(r.body.totalPaise)} (no delivery fee anywhere)`);
  h.mocks.cashfreePay(r.body.orderId);
  const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
  assert.equal(v.body.status, "paid");
  const w = await postCashfreeWebhook(h, cashfreeEvent("PAYMENT_SUCCESS_WEBHOOK", r.body.orderId, r.body.totalPaise / 100));
  assert.equal(w.status, 200);
  await h.drain();
  assert.equal(adhoc(h).length, 1);
  ok("Cashfree Get Order = PAID -> paid; signed Cashfree webhook accepted; one Shiprocket order");
}

// B2. Razorpay down -> Cashfree down -> PhonePe (UAT) --------------------------------------------------
{
  const h = newHarness();
  h.mocks.state.razorpay.create = 503;
  h.mocks.state.cashfree.create = "network";
  const r = await h.createOrder([{ code: "KPAS", qty: 1 }, { code: "TBEL", qty: 1 }], { ...CUSTOMER, city: "Hyderabad", state: "Telangana", pin: "500081" });
  assert.equal(r.status, 200);
  assert.equal(r.body.gateway, "phonepe");
  const sent = h.mocks.calls.find((c) => c.path === "/apis/pg-sandbox/checkout/v2/pay").body;
  assert.equal(sent.amount, 99000);
  const stored = await h.store.getOrder(r.body.orderId);
  assert.equal(stored.gwFailover, "razorpay:server_error:503,cashfree:network:0");
  ok(`Razorpay 503 -> Cashfree network error -> PhonePe UAT order ${r.body.orderId} for ${inr(sent.amount)}; D1 records gateway=phonepe, failover "${stored.gwFailover}"`);
  assert.equal(sent.paymentFlow.merchantUrls.redirectUrl, `https://1acrefarms.co.in/checkout-test/?order_id=${r.body.orderId}&gw=phonepe`);
  const back = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
  assert.equal(back.body.status, "pending");
  ok(`page -> ${new URL(r.body.phonepe.redirectUrl).host}; customer returns without paying -> /verify asks Order Status: pending (the return trip alone never counts)`);
  h.mocks.phonepeFinish(r.body.orderId, "COMPLETED");
  const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
  assert.equal(v.body.status, "paid");
  const raw = phonepeEvent("checkout.order.completed", r.body.orderId, r.body.totalPaise);
  assert.equal((await postPhonePeWebhook(h, raw, { password: "wrong-pass-1" })).status, 401);
  assert.equal((await postPhonePeWebhook(h, raw)).status, 200);
  assert.equal((await postPhonePeWebhook(h, raw)).body.duplicate, true);
  await h.drain();
  assert.equal((await h.store.getOrder(r.body.orderId)).status, "paid");
  assert.equal(adhoc(h).length, 1);
  assert.equal(h.mocks.state.phonepe.tokens.length, 1);
  const mail = h.mocks.state.resend.sent.find((m) => m.subject.includes("New paid order"));
  assert.match(mail.text, /Gateway: phonepe \(after razorpay server_error, cashfree network\)/);
  ok("pays at PhonePe -> /verify (Order Status COMPLETED) = paid; webhook: wrong SHA256 401, right one 200, repeat dropped; one Shiprocket order; one OAuth token");
}

// B3. All three gateways down -------------------------------------------------------------------
{
  const h = newHarness();
  h.mocks.state.razorpay.create = 502;
  h.mocks.state.cashfree.create = 500;
  h.mocks.state.phonepe.create = 503;
  const r = await h.createOrder();
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { ok: false, error: "payment_unavailable", orderId: r.body.orderId });
  h.advance(11 * 60 * 1000);
  await h.scheduled();
  await h.drain();
  const o = await h.store.getOrder(r.body.orderId);
  assert.equal(o.status, "gateway_error");
  assert.equal(adhoc(h).length, 0);
  assert.ok(h.mocks.state.resend.sent.some((m) => m.subject.includes("Checkout DOWN")));
  ok(`all three down -> buyer gets 502 payment_unavailable (page: "try again or WhatsApp"); ${o.id} stays gateway_error, never paid, never shipped; owner alerted`);
}

// C. Shiprocket busy, then the scheduled job --------------------------------------------------------
{
  const h = newHarness();
  h.mocks.state.shiprocket.queue = [429, 503, 500];
  const r = await h.createOrder([{ code: "SANN", qty: 1 }], { ...CUSTOMER, city: "Bengaluru", state: "Karnataka", pin: "560001" });
  const gw = r.body.razorpay.orderId;
  const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
  await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
  await h.drain();
  assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "retry");
  ok(`Shiprocket 429/503/500 -> 3 tries with backoff ${JSON.stringify(h.sleeps)} ms, then parked for the scheduled job`);
  h.advance(16 * 60 * 1000);
  await h.scheduled();
  const o = await h.store.getOrder(r.body.orderId);
  assert.equal(o.shipStatus, "pushed");
  ok(`scheduled() 16 min later -> pushed (Shiprocket order ${o.srOrderId}, attempt ${o.shipAttempts})`);
}

// D. Reconcile without webhook --------------------------------------------------------------------
{
  const h = newHarness();
  const r = await h.createOrder([{ code: "CBEL", qty: 1 }]);
  h.mocks.razorpayCapture(r.body.razorpay.orderId, r.body.totalPaise);
  h.advance(11 * 60 * 1000);
  await h.scheduled();
  assert.equal((await h.store.getOrder(r.body.orderId)).status, "paid");
  ok("webhook lost and browser closed -> scheduled() reconciles with Razorpay: paid and shipped");
}

// E. Live-mode guard ------------------------------------------------------------------------------
{
  const h = newHarness({ MODE: "live", RAZORPAY_KEY_ID: "rzp_live_MOCK" });
  const r = await h.createOrder();
  assert.equal(r.status, 503);
  assert.equal(h.mocks.calls.length, 0);
  ok(`MODE=live without LIVE_ENABLED -> 503 ${r.body.error} (${r.body.reason}); no gateway touched`);
  const t = newHarness({ RAZORPAY_KEY_ID: "rzp_live_MOCK" });
  assert.equal((await t.createOrder()).body.reason, "live_key_in_test_mode");
  ok("MODE=test with a live Razorpay key -> refused (live_key_in_test_mode)");
}

console.log(`\nsmoke: ${step} checks passed`);

#!/usr/bin/env node
// Local smoke run: the real Worker code, the real schema.sql (SQLite standing in for D1), and MOCKED
// Razorpay / Cashfree / Shiprocket / Resend. No network, no accounts, no money.
//   node scripts/smoke.mjs
import assert from "node:assert/strict";
import { createD1Store } from "../src/storage/d1.js";
import { createSqliteD1 } from "../test/helpers/d1-sqlite.js";
import {
  CUSTOMER, TEST_ENV, harness, razorpaySignature, razorpayOrderPaidEvent, postRazorpayWebhook, cashfreeEvent, postCashfreeWebhook,
} from "../test/helpers/harness.js";

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
  assert.deepEqual([health.body.mode, health.body.checkout], ["test", "enabled"]);
  ok("GET /health: mode test, checkout enabled");

  const r = await h.createOrder([{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], CUSTOMER);
  assert.equal(r.status, 200);
  assert.equal(r.body.gateway, "razorpay");
  ok(`create-order ${r.body.orderId}: 2 x Turmeric + 1 x Cane Jaggery to ${CUSTOMER.pin} = ${inr(r.body.subtotalPaise)} + delivery ${inr(r.body.deliveryPaise)} = ${inr(r.body.totalPaise)} (Razorpay ${r.body.razorpay.orderId})`);

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
  const r = await h.createOrder([{ code: "KPAS", qty: 1 }, { code: "TBEL", qty: 1 }], { ...CUSTOMER, city: "Hyderabad", state: "Telangana", pin: "500081" });
  assert.equal(r.body.gateway, "cashfree");
  ok(`Razorpay times out -> Cashfree sandbox order ${r.body.orderId}: ${inr(r.body.subtotalPaise)} + delivery ${inr(r.body.deliveryPaise)} (Telangana) = ${inr(r.body.totalPaise)}`);
  h.mocks.cashfreePay(r.body.orderId);
  const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
  assert.equal(v.body.status, "paid");
  const w = await postCashfreeWebhook(h, cashfreeEvent("PAYMENT_SUCCESS_WEBHOOK", r.body.orderId, r.body.totalPaise / 100));
  assert.equal(w.status, 200);
  await h.drain();
  assert.equal(adhoc(h).length, 1);
  ok("Cashfree Get Order = PAID -> paid; signed Cashfree webhook accepted; one Shiprocket order");
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

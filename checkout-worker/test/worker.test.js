// End-to-end behaviour of the Worker against mocked gateways.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER, SECRET_VALUES, TEST_ENV, harness, razorpaySignature, razorpayOrderPaidEvent, razorpayPaymentEvent,
  postRazorpayWebhook, cashfreeEvent, postCashfreeWebhook,
} from "./helpers/harness.js";
import { makeLogger, redact } from "../src/log.js";

const shiprocketCreates = (h) => h.mocks.calls.filter((c) => c.path === "/v1/external/orders/create/adhoc");
const gatewayCalls = (h) => h.mocks.calls.filter((c) => c.host === "api.razorpay.com" || c.host.endsWith("cashfree.com"));

async function paidViaRazorpay(h) {
  const r = await h.createOrder();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const gw = r.body.razorpay.orderId;
  const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
  return { r, gw, pay };
}

describe("create-order", () => {
  test("prices from the server table, never the client, and opens a Razorpay order", async () => {
    const h = harness();
    const r = await h.createOrder([{ code: "TURM", qty: 2, price: 1 }, { code: "CBEL", qty: 1 }], CUSTOMER, { totalPaise: 100 });
    assert.equal(r.status, 200);
    assert.equal(r.body.gateway, "razorpay");
    assert.equal(r.body.mode, "test");
    assert.equal(r.body.subtotalPaise, 102600);
    assert.equal(r.body.deliveryPaise, 0);
    assert.equal(r.body.totalPaise, 102600);
    assert.match(r.body.orderId, /^1AF-T-261112-[0-9A-Z]{6}$/);
    assert.equal(r.body.razorpay.keyId, TEST_ENV.RAZORPAY_KEY_ID);
    const sent = h.mocks.calls.find((c) => c.path === "/v1/orders");
    assert.equal(sent.body.amount, 102600, "Razorpay asked for the server total");
    assert.equal(sent.body.receipt, r.body.orderId);
    const stored = await h.store.getOrder(r.body.orderId);
    assert.equal(stored.status, "created");
    assert.equal(stored.customer.phone, "9876543210");
    assert.equal(r.headers.get("access-control-allow-origin"), "https://1acrefarms.co.in");
  });

  test("delivery fee by PIN: AP Rs 99, rest of India Rs 189 below Rs 999", async () => {
    const h = harness();
    const ap = await h.createOrder([{ code: "CBEL", qty: 1 }]);
    assert.equal(ap.body.deliveryPaise, 9900);
    const ka = await h.createOrder([{ code: "CBEL", qty: 1 }], { ...CUSTOMER, city: "Bengaluru", state: "Karnataka", pin: "560001" });
    assert.equal(ka.body.deliveryPaise, 18900);
    assert.equal(ka.body.totalPaise, 23400 + 18900);
  });

  test("CORS: only the two site origins", async () => {
    const h = harness();
    const www = await h.call("GET", "/health", { origin: "https://www.1acrefarms.co.in" });
    assert.equal(www.headers.get("access-control-allow-origin"), "https://www.1acrefarms.co.in");
    assert.equal((await h.createOrder()).status, 200, "the site origin may create orders");
    const bad = await h.call("POST", "/create-order", { origin: "https://evil.example", body: {} });
    assert.equal(bad.status, 403);
    assert.equal(bad.headers.get("access-control-allow-origin"), null);
    const pre = await h.call("OPTIONS", "/create-order", { origin: "https://1acrefarms.co.in" });
    assert.equal(pre.status, 204);
    assert.match(pre.headers.get("access-control-allow-methods"), /POST/);
    const preBad = await h.call("OPTIONS", "/create-order", { origin: "http://localhost:4321" });
    assert.equal(preBad.status, 403, "localhost is not allowed unless DEV_ORIGINS is set in test mode");
    const dev = harness({ env: { DEV_ORIGINS: "http://localhost:4321" } });
    assert.equal((await dev.call("OPTIONS", "/create-order", { origin: "http://localhost:4321" })).status, 204);
    const devLive = harness({ env: { MODE: "live", DEV_ORIGINS: "http://localhost:4321" } });
    assert.equal((await devLive.call("OPTIONS", "/create-order", { origin: "http://localhost:4321" })).status, 403, "never in live mode");
  });

  test("invalid input: 400 with field codes, nothing sent to a gateway", async () => {
    const h = harness();
    const r = await h.createOrder([{ code: "CASH", qty: 1 }], { ...CUSTOMER, phone: "12345", pin: "522601", state: "Kerala" });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((e) => `${e.field}:${e.code}`), ["phone:invalid", "pin:state_mismatch", "items:not_sellable"]);
    assert.equal(gatewayCalls(h).length, 0);
    const junk = await h.call("POST", "/create-order", { raw: "not json", headers: { "content-type": "application/json" } });
    assert.equal(junk.status, 400);
    assert.equal(junk.body.error, "bad_json");
  });

  test("out of stock blocks the order (when stock is tracked)", async () => {
    const h = harness();
    await h.store.setStock("TURM", 1);
    const r = await h.createOrder([{ code: "TURM", qty: 2 }]);
    assert.equal(r.status, 409);
    assert.equal(r.body.item, "TURM");
    assert.equal((await h.createOrder([{ code: "TURM", qty: 1 }])).status, 200);
  });

  test("Turnstile (when TURNSTILE_REQUIRED): missing or failed token is refused", async () => {
    const h = harness({ env: { TURNSTILE_REQUIRED: "true", TURNSTILE_SECRET_KEY: "0x4AAA-mock" } });
    assert.equal((await h.createOrder()).status, 403);
    assert.equal((await h.createOrder(undefined, undefined, { turnstileToken: "tok" })).status, 200);
    h.mocks.state.turnstile.success = false;
    assert.equal((await h.createOrder(undefined, undefined, { turnstileToken: "tok" })).status, 403);
  });
});

describe("live-mode guard", () => {
  test("MODE unset defaults to test", async () => {
    const h = harness({ env: { MODE: undefined } });
    const r = await h.createOrder();
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, "test");
    assert.ok(h.mocks.calls.some((c) => c.host === "api.razorpay.com"));
  });

  test("MODE=live without LIVE_ENABLED: refuses, no gateway call", async () => {
    const h = harness({ env: { MODE: "live", RAZORPAY_KEY_ID: "rzp_live_MOCK" } });
    const r = await h.createOrder();
    assert.equal(r.status, 503);
    assert.equal(r.body.error, "checkout_disabled");
    assert.equal(r.body.reason, "live_not_approved");
    assert.equal(gatewayCalls(h).length, 0);
    const health = await h.call("GET", "/health");
    assert.equal(health.body.checkout, "disabled");
  });

  test("MODE=live with a near-miss approval value still refuses", async () => {
    for (const v of ["yes", "YES-OWNER-APPROVED", "yes-owner-approved ", "true", ""]) {
      const h = harness({ env: { MODE: "live", LIVE_ENABLED: v, RAZORPAY_KEY_ID: "rzp_live_MOCK" } });
      const r = await h.createOrder();
      assert.equal(r.status, 503, `LIVE_ENABLED=${JSON.stringify(v)}`);
      assert.equal(gatewayCalls(h).length, 0);
    }
  });

  test("MODE=live + exact approval + live key: accepted (Cashfree switches to production host)", async () => {
    const h = harness({ env: { MODE: "live", LIVE_ENABLED: "yes-owner-approved", RAZORPAY_KEY_ID: "rzp_live_MOCK" } });
    const r = await h.createOrder();
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, "live");
    assert.match(r.body.orderId, /^1AF-W-/);
    const h2 = harness({ env: { MODE: "live", LIVE_ENABLED: "yes-owner-approved", RAZORPAY_KEY_ID: "rzp_live_MOCK" } });
    h2.mocks.state.razorpay.create = 503;
    const r2 = await h2.createOrder();
    assert.equal(r2.body.gateway, "cashfree");
    assert.equal(r2.body.cashfree.mode, "production");
    assert.ok(h2.mocks.calls.some((c) => c.host === "api.cashfree.com"));
  });

  test("MODE=live with a TEST key is refused; MODE=test with a LIVE key is refused", async () => {
    const a = harness({ env: { MODE: "live", LIVE_ENABLED: "yes-owner-approved", RAZORPAY_KEY_ID: "rzp_test_MOCK" } });
    assert.equal((await a.createOrder()).body.reason, "test_key_in_live_mode");
    const b = harness({ env: { MODE: "test", RAZORPAY_KEY_ID: "rzp_live_MOCK" } });
    const r = await b.createOrder();
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, "live_key_in_test_mode");
    assert.equal(gatewayCalls(b).length, 0);
  });

  test("unknown MODE fails closed", async () => {
    const h = harness({ env: { MODE: "production" } });
    const r = await h.createOrder();
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, "bad_mode");
  });

  test("test mode uses the Cashfree sandbox host", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 500;
    const r = await h.createOrder();
    assert.equal(r.body.cashfree.mode, "sandbox");
    assert.ok(h.mocks.calls.some((c) => c.host === "sandbox.cashfree.com"));
    assert.ok(!h.mocks.calls.some((c) => c.host === "api.cashfree.com"));
  });
});

describe("failover to Cashfree", () => {
  test("Razorpay 5xx -> Cashfree order, owner alerted once per hour", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 503;
    const r = await h.createOrder();
    assert.equal(r.status, 200);
    assert.equal(r.body.gateway, "cashfree");
    assert.equal(r.body.cashfree.paymentSessionId, `session_mock_${r.body.orderId}`);
    const cf = h.mocks.calls.find((c) => c.host === "sandbox.cashfree.com" && c.method === "POST");
    assert.equal(cf.body.order_amount, 1026);
    assert.equal(cf.body.order_id, r.body.orderId);
    assert.equal(cf.body.customer_details.customer_phone, "9876543210");
    assert.ok(!cf.body.customer_details.customer_id.includes("9876543210"), "customer_id is not the phone");
    assert.equal(cf.body.order_meta.notify_url, "https://1acrefarms-checkout.example.workers.dev/cashfree-webhook");
    const stored = await h.store.getOrder(r.body.orderId);
    assert.equal(stored.gateway, "cashfree");
    assert.equal(stored.gwOrderId, r.body.orderId);
    await h.createOrder();
    await h.drain();
    assert.equal(h.mocks.state.resend.sent.filter((m) => /failed over/.test(m.subject)).length, 1, "throttled");
  });

  test("Razorpay timeout -> Cashfree", async () => {
    const h = harness({ env: { GATEWAY_TIMEOUT_MS: "30" } });
    h.mocks.state.razorpay.create = "timeout";
    const t0 = Date.now();
    const r = await h.createOrder();
    assert.equal(r.status, 200);
    assert.equal(r.body.gateway, "cashfree");
    assert.ok(Date.now() - t0 < 2000, "did not wait for the hung request");
    assert.ok(h.logs.some((l) => l.includes('"evt":"gateway_failed"') && l.includes('"reason":"timeout"')));
  });

  test("Razorpay network error or 4xx -> Cashfree too", async () => {
    for (const mode of ["network", 400, 401]) {
      const h = harness();
      h.mocks.state.razorpay.create = mode;
      const r = await h.createOrder();
      assert.equal(r.body.gateway, "cashfree", `razorpay ${mode}`);
    }
  });

  test("both gateways down -> 502, order kept as gateway_error, owner alerted", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 502;
    h.mocks.state.cashfree.create = 500;
    const r = await h.createOrder();
    assert.equal(r.status, 502);
    assert.equal(r.body.error, "payment_unavailable");
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "gateway_error");
    await h.drain();
    assert.ok(h.mocks.state.resend.sent.some((m) => /Checkout DOWN/.test(m.subject)));
  });

  test("Razorpay healthy -> Cashfree never called; PRIMARY_GATEWAY=cashfree flips the order", async () => {
    const h = harness();
    await h.createOrder();
    assert.ok(!h.mocks.calls.some((c) => c.host.endsWith("cashfree.com")));
    const flip = harness({ env: { PRIMARY_GATEWAY: "cashfree" } });
    const r = await flip.createOrder();
    assert.equal(r.body.gateway, "cashfree");
    assert.ok(!flip.mocks.calls.some((c) => c.host === "api.razorpay.com"));
    const noBackup = harness({ env: { BACKUP_GATEWAY: "off" } });
    noBackup.mocks.state.razorpay.create = 503;
    assert.equal((await noBackup.createOrder()).status, 502);
  });
});

describe("verify", () => {
  test("Razorpay: valid signature -> verified now, paid + Shiprocket after the server-side check", async () => {
    const h = harness();
    const { r, gw, pay } = await paidViaRazorpay(h);
    const v = await h.call("POST", "/verify", { body: {
      orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay,
      razorpay_signature: razorpaySignature(TEST_ENV.RAZORPAY_KEY_SECRET, gw, pay),
    } });
    assert.equal(v.status, 200);
    assert.equal(v.body.status, "verified");
    await h.drain();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid");
    assert.equal(o.paidSource, "verify");
    assert.equal(o.shipStatus, "pushed");
    assert.equal(shiprocketCreates(h).length, 1);
    const again = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(again.body.status, "paid");
  });

  test("Razorpay: bad signature or swapped order id is rejected", async () => {
    const h = harness();
    const { r, gw, pay } = await paidViaRazorpay(h);
    const bad = await h.call("POST", "/verify", { body: { orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay, razorpay_signature: "00".repeat(32) } });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, "bad_signature");
    const other = "order_SOMEONEELSE01";
    const swapped = await h.call("POST", "/verify", { body: {
      orderId: r.body.orderId, razorpay_order_id: other, razorpay_payment_id: pay,
      razorpay_signature: razorpaySignature(TEST_ENV.RAZORPAY_KEY_SECRET, other, pay),
    } });
    assert.equal(swapped.status, 400);
    assert.equal(swapped.body.error, "order_mismatch");
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "created");
    assert.equal(shiprocketCreates(h).length, 0);
    assert.equal((await h.call("POST", "/verify", { body: { orderId: "1AF-T-000000-NOPE00" } })).status, 404);
  });

  test("Cashfree: Get Order says PAID -> paid + Shiprocket; not yet paid -> pending", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 503;
    const r = await h.createOrder();
    const pending = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(pending.body.status, "pending");
    h.mocks.cashfreePay(r.body.orderId);
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(v.body.ok, true);
    assert.equal(v.body.status, "paid");
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "pushed");
    assert.equal(shiprocketCreates(h).length, 1);
  });
});

describe("webhooks", () => {
  test("Razorpay order.paid -> paid + one Shiprocket order; duplicates and late events are no-ops", async () => {
    const h = harness();
    const { r, gw, pay } = await paidViaRazorpay(h);
    const raw = razorpayOrderPaidEvent(gw, pay, r.body.totalPaise, { receipt: r.body.orderId });
    const w1 = await postRazorpayWebhook(h, raw, { eventId: "evt_A" });
    assert.equal(w1.status, 200);
    assert.deepEqual(w1.body, { ok: true });
    const w2 = await postRazorpayWebhook(h, raw, { eventId: "evt_A" });
    assert.equal(w2.body.duplicate, true, "same event id: dropped");
    const late = razorpayPaymentEvent("payment.captured", gw, pay, r.body.totalPaise, "captured");
    const w3 = await postRazorpayWebhook(h, late, { eventId: "evt_B" });
    assert.equal(w3.status, 200, "different event for the same payment: accepted but changes nothing");
    const failedLate = razorpayPaymentEvent("payment.failed", gw, "pay_OLDATTEMPT", r.body.totalPaise, "failed");
    await postRazorpayWebhook(h, failedLate, { eventId: "evt_C" });
    // the customer's browser also calls /verify
    await h.call("POST", "/verify", { body: { orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay, razorpay_signature: razorpaySignature(TEST_ENV.RAZORPAY_KEY_SECRET, gw, pay) } });
    await h.drain();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid", "a late payment.failed never un-pays");
    assert.equal(o.paidSource, "webhook");
    assert.equal(o.paymentId, pay);
    assert.equal(shiprocketCreates(h).length, 1, "exactly one Shiprocket order");
    const paidMails = h.mocks.state.resend.sent.filter((m) => /New paid order/.test(m.subject));
    assert.equal(paidMails.length, 1, "exactly one owner alert");
    assert.ok(!paidMails[0].text.includes("9876543210") && !paidMails[0].text.includes("Gandhi Nagar"), "no phone or street in the mail");
  });

  test("Razorpay webhook replies before the Shiprocket push finishes (5 s rule)", async () => {
    const h = harness();
    const { r, gw, pay } = await paidViaRazorpay(h);
    let open;
    h.mocks.state.shiprocket.gate = new Promise((res) => { open = res; });
    const w = await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise), { eventId: "evt_slow" });
    assert.equal(w.status, 200);
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "pushing", "push still in flight");
    assert.ok(h.ctx.pendingCount() > 0, "push runs in ctx.waitUntil");
    open();
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "pushed");
  });

  test("Razorpay webhook: bad signature 401; unknown order ignored; wrong amount held for a human", async () => {
    const h = harness();
    const { r, gw, pay } = await paidViaRazorpay(h);
    const raw = razorpayOrderPaidEvent(gw, pay, r.body.totalPaise);
    const bad = await postRazorpayWebhook(h, raw, { secret: "wrong" });
    assert.equal(bad.status, 401);
    const notOurs = await postRazorpayWebhook(h, razorpayOrderPaidEvent("order_PAYMENTPAGE01", "pay_X", 50000), { eventId: "evt_pp" });
    assert.equal(notOurs.body.ignored, true);
    const short = await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, 100), { eventId: "evt_short" });
    assert.equal(short.status, 200);
    await h.drain();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "amount_mismatch");
    assert.equal(shiprocketCreates(h).length, 0);
    assert.ok(h.mocks.state.resend.sent.some((m) => /amount mismatch/.test(m.subject)));
  });

  test("Razorpay webhook without an event id is deduped by body hash", async () => {
    const h = harness();
    const { r, gw, pay } = await paidViaRazorpay(h);
    const raw = razorpayOrderPaidEvent(gw, pay, r.body.totalPaise);
    await postRazorpayWebhook(h, raw, { eventId: null });
    const again = await postRazorpayWebhook(h, raw, { eventId: null });
    assert.equal(again.body.duplicate, true);
  });

  test("Cashfree PAYMENT_SUCCESS_WEBHOOK -> paid once; duplicates ignored; bad signature 401", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 503;
    const r = await h.createOrder();
    const raw = cashfreeEvent("PAYMENT_SUCCESS_WEBHOOK", r.body.orderId, r.body.totalPaise / 100);
    assert.equal((await postCashfreeWebhook(h, raw, { secret: "wrong" })).status, 401);
    const w1 = await postCashfreeWebhook(h, raw);
    assert.equal(w1.status, 200);
    const w2 = await postCashfreeWebhook(h, raw, { ts: "1762921999" });
    assert.equal(w2.body.duplicate, true);
    h.mocks.cashfreePay(r.body.orderId);
    await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    await h.drain();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid");
    assert.equal(o.paymentId, "99001");
    assert.equal(shiprocketCreates(h).length, 1);
    const dropped = cashfreeEvent("PAYMENT_USER_DROPPED_WEBHOOK", r.body.orderId, 10.26, { cfPaymentId: 99002, status: "USER_DROPPED" });
    await postCashfreeWebhook(h, dropped);
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "paid");
  });
});

describe("Shiprocket push", () => {
  test("payload: our order id, Prepaid, pickup nickname, server prices, parcel weight", async () => {
    const h = harness({ env: { SHIPROCKET_PICKUP_LOCATION: "Home-522601" } });
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    const body = shiprocketCreates(h)[0].body;
    assert.equal(body.order_id, r.body.orderId);
    assert.equal(body.payment_method, "Prepaid");
    assert.equal(body.pickup_location, "Home-522601");
    assert.equal(body.billing_phone, "9876543210");
    assert.equal(body.billing_pincode, "522002");
    assert.equal(body.billing_customer_name, "Lakshmi");
    assert.equal(body.billing_last_name, "Devi");
    assert.equal(body.sub_total, 1026);
    assert.equal(body.shipping_charges, 0);
    assert.equal(body.weight, 1.9);
    assert.deepEqual([body.length, body.breadth, body.height], [26, 21, 13]);
    assert.deepEqual(body.order_items.map((i) => [i.sku, i.units, i.selling_price]), [["1AF-TURM-0540", 2, 396], ["1AF-CBEL-0540", 1, 234]]);
    assert.match(body.order_date, /^2026-11-12 10:0\d$/, "IST");
  });

  test("retries 429 and 5xx inline (with backoff), then succeeds", async () => {
    const h = harness();
    h.mocks.state.shiprocket.queue = [429, 503];
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    assert.equal(shiprocketCreates(h).length, 3);
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.shipStatus, "pushed");
    assert.equal(o.shipAttempts, 3);
    assert.equal(o.srOrderId, "700001");
    assert.deepEqual(h.sleeps, [1000, 1000], "429 honours Retry-After: 1 s; then 2nd backoff 1000 ms");
  });

  test("no retry on 422: one call, marked failed, owner told to book by hand", async () => {
    const h = harness();
    h.mocks.state.shiprocket.queue = [422];
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    assert.equal(shiprocketCreates(h).length, 1);
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.shipStatus, "failed");
    assert.match(o.shipError, /rejected \(http 422\)/);
    assert.ok(h.mocks.state.resend.sent.some((m) => /book .* in Shiprocket by hand/.test(m.subject)));
    await h.scheduled();
    assert.equal(shiprocketCreates(h).length, 1, "the cron does not retry a 422 either");
  });

  test("still failing after inline tries -> scheduled() retries later and succeeds", async () => {
    const h = harness({ env: { SHIPROCKET_TIMEOUT_MS: "30" } });
    h.mocks.state.shiprocket.queue = [500, 502, "timeout"];
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    let o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.shipStatus, "retry");
    assert.equal(o.shipAttempts, 3);
    await h.scheduled();
    assert.equal(shiprocketCreates(h).length, 3, "not due yet");
    h.advance(31 * 60 * 1000);
    await h.scheduled();
    o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.shipStatus, "pushed");
    assert.equal(o.shipAttempts, 4);
  });

  test("gives up after SHIPROCKET_MAX_ATTEMPTS and alerts", async () => {
    const h = harness({ env: { SHIPROCKET_MAX_ATTEMPTS: "4" } });
    h.mocks.state.shiprocket.queue = [500, 500, 500, 500, 500];
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    h.advance(6 * 3600 * 1000);
    await h.scheduled();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.shipStatus, "failed");
    assert.equal(o.shipAttempts, 4);
    assert.ok(h.mocks.state.resend.sent.some((m) => /by hand/.test(m.subject)));
  });

  test("token cached across orders; 401 triggers one re-login", async () => {
    const h = harness();
    for (let i = 0; i < 2; i++) {
      const { r, gw, pay } = await paidViaRazorpay(h);
      await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise), { eventId: `evt_${i}` });
      await h.drain();
    }
    assert.equal(h.mocks.state.shiprocket.logins, 1, "one login for two orders");
    await h.store.kvSet("shiprocket_token", "stale-token", h.now() + 1e9);
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise), { eventId: "evt_3" });
    await h.drain();
    assert.equal(h.mocks.state.shiprocket.logins, 2);
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "pushed");
  });

  test("test mode default: no Shiprocket push at all (no sandbox exists)", async () => {
    const h = harness({ env: { SHIPROCKET_PUSH: undefined } });
    const { r, gw, pay } = await paidViaRazorpay(h);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    await h.scheduled();
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "skipped");
    assert.equal(h.mocks.calls.filter((c) => c.host === "apiv2.shiprocket.in").length, 0);
  });
});

describe("scheduled reconcile", () => {
  test("paid at the gateway but no webhook and no /verify -> reconciled to paid and shipped", async () => {
    const h = harness();
    const { r } = await paidViaRazorpay(h);
    await h.scheduled();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "created", "too fresh to reconcile");
    h.advance(11 * 60 * 1000);
    await h.scheduled();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid");
    assert.equal(o.paidSource, "reconcile");
    assert.equal(o.shipStatus, "pushed");
  });

  test("never paid -> expired after 24 h; a later payment still counts", async () => {
    const h = harness();
    const r = await h.createOrder();
    h.advance(25 * 3600 * 1000);
    await h.scheduled();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "expired");
    const gw = r.body.razorpay.orderId;
    const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "paid");
  });
});

test("logs never contain phone numbers, addresses, emails or secrets", async () => {
  const h = harness();
  h.mocks.state.shiprocket.queue = [500, 422];
  const { r, gw, pay } = await paidViaRazorpay(h);
  await h.call("POST", "/verify", { body: { orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay, razorpay_signature: "bad" } });
  await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
  await postRazorpayWebhook(h, "{}", { secret: "wrong" });
  h.mocks.state.razorpay.create = 503;
  const cf = await h.createOrder(undefined, { ...CUSTOMER, phone: "+91 91234 56789" });
  await postCashfreeWebhook(h, cashfreeEvent("PAYMENT_SUCCESS_WEBHOOK", cf.body.orderId, cf.body.totalPaise / 100));
  await h.drain();
  await h.scheduled();
  const all = h.logs.join("\n");
  assert.ok(h.logs.length > 10, "the flow did log");
  for (const needle of ["9876543210", "98765", "9123456789", "Gandhi Nagar", "12-3-45", "Water Tank", "lakshmi.devi@example.com", "Lakshmi", "522002", ...SECRET_VALUES]) {
    assert.ok(!all.includes(needle), `log leaked ${needle}`);
  }
  for (const line of h.logs) assert.doesNotThrow(() => JSON.parse(line), "structured JSON lines");
});

test("logger: drops unknown fields, scrubs phones/emails in allowed ones", () => {
  const lines = [];
  const log = makeLogger({ log: (l) => lines.push(l) });
  log("x", { orderId: "1AF-T-261112-ABCDEF", phone: "9876543210", customer: { pin: "522002" }, reason: "call +91 98765 43210 or a@b.in", http: 503 });
  const out = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(out).sort(), ["evt", "http", "orderId", "reason"]);
  assert.equal(out.orderId, "1AF-T-261112-ABCDEF");
  assert.equal(out.reason, "call [num] or [email]");
  assert.equal(redact("PIN 522002"), "PIN [num]");
});

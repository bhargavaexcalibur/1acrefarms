// End-to-end behaviour of the Worker against mocked gateways.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  CUSTOMER, FAKE_TEST_LICENCE, LIVE_ENV, SECRET_VALUES, TEST_ENV, harness, razorpaySignature, razorpayOrderPaidEvent, razorpayPaymentEvent,
  postRazorpayWebhook, cashfreeEvent, postCashfreeWebhook, phonepeEvent, postPhonePeWebhook, phonepeWebhookAuth,
} from "./helpers/harness.js";
import { makeLogger, redact } from "../src/log.js";

const shiprocketCreates = (h) => h.mocks.calls.filter((c) => c.path === "/v1/external/orders/create/adhoc");
const gatewayCalls = (h) => h.mocks.calls.filter((c) => c.host === "api.razorpay.com" || c.host.endsWith("cashfree.com") || c.host.endsWith("phonepe.com"));
const phonepeCalls = (h, suffix) => h.mocks.calls.filter((c) => c.host.endsWith("phonepe.com") && c.path.endsWith(suffix));

// Razorpay and Cashfree both down: the order lands on PhonePe (the default third gateway).
async function phonepeOrder(h, items, customer) {
  h.mocks.state.razorpay.create = 503;
  h.mocks.state.cashfree.create = 500;
  const r = await h.createOrder(items, customer);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.gateway, "phonepe");
  return r;
}

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

  test("no delivery fee: every gateway is asked for exactly the sum of MRP x qty, whatever the PIN", async () => {
    const baskets = [
      [[{ code: "CBEL", qty: 1 }], { ...CUSTOMER, pin: "522601" }, 23400],
      [[{ code: "CBEL", qty: 1 }], { ...CUSTOMER, city: "New Delhi", state: "Delhi", pin: "110001" }, 23400],
      [[{ code: "KPAS", qty: 1 }], { ...CUSTOMER, city: "Bengaluru", state: "Karnataka", pin: "560001" }, 49500],
      [[{ code: "KPAS", qty: 1 }, { code: "TBEL", qty: 1 }], { ...CUSTOMER, city: "Hyderabad", state: "Telangana", pin: "500081" }, 99000],
      [[{ code: "TURM", qty: 1 }, { code: "CBEL", qty: 2 }], { ...CUSTOMER, city: "Agartala", state: "Tripura", pin: "799001" }, 86400],
      [[{ code: "TURM", qty: 6 }, { code: "TBEL", qty: 6 }], CUSTOMER, 534600],
    ];
    for (const gateway of ["razorpay", "cashfree", "phonepe"]) {
      for (const [items, customer, want] of baskets) {
        const h = harness({ env: { GATEWAY_ORDER: gateway } });
        const r = await h.createOrder(items, customer);
        assert.equal(r.status, 200, JSON.stringify(r.body));
        assert.equal(r.body.gateway, gateway);
        assert.equal(r.body.totalPaise, want);
        assert.equal(r.body.subtotalPaise, want);
        assert.equal(r.body.deliveryPaise, undefined, "no delivery line in the reply");
        const sent = h.mocks.calls.find((c) => c.method === "POST" && ["/v1/orders", "/pg/orders", "/apis/pg-sandbox/checkout/v2/pay"].includes(c.path)).body;
        const asked = gateway === "cashfree" ? Math.round(sent.order_amount * 100) : sent.amount;
        assert.equal(asked, want, `${gateway} asked for the MRP sum (${JSON.stringify(items)} to ${customer.pin})`);
        const o = await h.store.getOrder(r.body.orderId);
        assert.deepEqual([o.subtotalPaise, o.deliveryPaise, o.totalPaise], [want, 0, want]);
      }
    }
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
    const r = await h.createOrder([{ code: "XXXX", qty: 1 }], { ...CUSTOMER, phone: "12345", pin: "522601", state: "Kerala" });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body.errors.map((e) => `${e.field}:${e.code}`), ["phone:invalid", "pin:state_mismatch", "items:unknown_item"]);
    assert.equal(gatewayCalls(h).length, 0);
    const junk = await h.call("POST", "/create-order", { raw: "not json", headers: { "content-type": "application/json" } });
    assert.equal(junk.status, 400);
    assert.equal(junk.body.error, "bad_json");
  });

  test("Sannam, Teja and cashew can be ordered (on sale since the 13-11 go-live)", async () => {
    for (const code of ["SANN", "TEJA", "CASH"]) assert.equal((await harness().createOrder([{ code, qty: 1 }])).status, 200, code);
  });

  test("an unknown pack is refused: unknown_item, no gateway call", async () => {
    for (const code of ["XXXX"]) {
      const h = harness();
      const r = await h.createOrder([{ code, qty: 1 }]);
      assert.equal(r.status, 400, code);
      assert.deepEqual(r.body.errors.map((e) => `${e.field}:${e.code}`), ["items:unknown_item"], code);
      assert.equal(gatewayCalls(h).length, 0);
    }
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
      const h = harness({ env: { ...LIVE_ENV, LIVE_ENABLED: v } });
      const r = await h.createOrder();
      assert.equal(r.status, 503, `LIVE_ENABLED=${JSON.stringify(v)}`);
      assert.equal(r.body.reason, "live_not_approved");
      assert.equal(gatewayCalls(h).length, 0);
    }
  });

  test("MODE=live + exact approval + licence + e-commerce KoB + live key: accepted (Cashfree switches to production host)", async () => {
    const h = harness({ env: LIVE_ENV });
    const r = await h.createOrder();
    assert.equal(r.status, 200);
    assert.equal(r.body.mode, "live");
    assert.match(r.body.orderId, /^1AF-W-/);
    const h2 = harness({ env: LIVE_ENV });
    h2.mocks.state.razorpay.create = 503;
    const r2 = await h2.createOrder();
    assert.equal(r2.body.gateway, "cashfree");
    assert.equal(r2.body.cashfree.mode, "production");
    assert.ok(h2.mocks.calls.some((c) => c.host === "api.cashfree.com"));
  });

  test("MODE=live with a TEST key is refused; MODE=test with a LIVE key is refused", async () => {
    const a = harness({ env: { ...LIVE_ENV, RAZORPAY_KEY_ID: "rzp_test_MOCK" } });
    assert.equal((await a.createOrder()).body.reason, "test_key_in_live_mode");
    const b = harness({ env: { MODE: "test", RAZORPAY_KEY_ID: "rzp_live_MOCK" } });
    const r = await b.createOrder();
    assert.equal(r.status, 503);
    assert.equal(r.body.reason, "live_key_in_test_mode");
    assert.equal(gatewayCalls(b).length, 0);
  });

  test("FSSAI licence gate: live mode needs a 14-digit licence AND the e-commerce KoB flag, each with its own code", async () => {
    const cases = [
      [{ FSSAI_ECOM_LIC: undefined }, "no_fssai_ecom_licence"],
      [{ FSSAI_ECOM_LIC: "" }, "no_fssai_ecom_licence"],
      [{ FSSAI_ECOM_LIC: "1234567890123" }, "no_fssai_ecom_licence"], // 13 digits
      [{ FSSAI_ECOM_LIC: "123456789012345" }, "no_fssai_ecom_licence"], // 15 digits
      [{ FSSAI_ECOM_LIC: ` ${FAKE_TEST_LICENCE}` }, "no_fssai_ecom_licence"],
      [{ FSSAI_ECOM_LIC: "1001201100012A" }, "no_fssai_ecom_licence"],
      [{ FSSAI_ECOM_LIC: "applied for" }, "no_fssai_ecom_licence"],
      [{ FSSAI_ECOM_LIC: "20126161000590" }, "no_fssai_ecom_licence"], // our packing-unit Reg. No. is not the licence
      [{ FSSAI_ECOM_KOB_ENDORSED: undefined }, "fssai_ecom_kob_not_endorsed"],
      [{ FSSAI_ECOM_KOB_ENDORSED: "true" }, "fssai_ecom_kob_not_endorsed"],
      [{ FSSAI_ECOM_KOB_ENDORSED: "YES" }, "fssai_ecom_kob_not_endorsed"],
      [{ FSSAI_ECOM_KOB_ENDORSED: "yes " }, "fssai_ecom_kob_not_endorsed"],
      [{ LIVE_ENABLED: undefined }, "live_not_approved"], // the owner's go is checked first
    ];
    for (const [over, code] of cases) {
      const h = harness({ env: { ...LIVE_ENV, ...over } });
      const r = await h.createOrder();
      assert.equal(r.status, 503, JSON.stringify(over));
      assert.equal(r.body.reason, code, JSON.stringify(over));
      assert.equal(gatewayCalls(h).length, 0);
      const health = await h.call("GET", "/health");
      assert.deepEqual([health.body.checkout, health.body.reason], ["disabled", code]);
    }
    // test mode needs neither (TEST / SANDBOX / UAT only, no real money)
    assert.equal((await harness().createOrder()).status, 200);
  });

  test("owner's pre-grant go (PRE_GRANT_OWNER_GO = YYYY-MM-DD) waives only the two licence gates", async () => {
    const noLic = { FSSAI_ECOM_LIC: undefined, FSSAI_ECOM_KOB_ENDORSED: undefined };
    const ok = harness({ env: { ...LIVE_ENV, ...noLic, PRE_GRANT_OWNER_GO: "2026-11-11" } });
    assert.equal((await ok.createOrder()).status, 200);
    assert.equal((await ok.call("GET", "/health")).body.fssaiLic ?? null, null, "no licence line without a licence");
    for (const bad of ["yes", "11-11-2026", "2026-11-11 ", "", undefined]) {
      const h = harness({ env: { ...LIVE_ENV, ...noLic, PRE_GRANT_OWNER_GO: bad } });
      assert.equal((await h.createOrder()).body.reason, "no_fssai_ecom_licence", String(bad));
    }
    // the other live gates still apply
    const noGo = harness({ env: { ...LIVE_ENV, ...noLic, PRE_GRANT_OWNER_GO: "2026-11-11", LIVE_ENABLED: undefined } });
    assert.equal((await noGo.createOrder()).body.reason, "live_not_approved");
    const testKey = harness({ env: { ...LIVE_ENV, ...noLic, PRE_GRANT_OWNER_GO: "2026-11-11", RAZORPAY_KEY_ID: "rzp_test_MOCK" } });
    assert.equal((await testKey.createOrder()).body.reason, "test_key_in_live_mode");
  });

  test("/health shows the licence number only when it is a real 14-digit number", async () => {
    const live = harness({ env: LIVE_ENV });
    assert.equal((await live.call("GET", "/health")).body.fssaiLic, FAKE_TEST_LICENCE);
    for (const v of [undefined, "", "applied for", "1234", "20126161000590"]) {
      const h = harness({ env: { FSSAI_ECOM_LIC: v } });
      const body = (await h.call("GET", "/health")).body;
      assert.equal("fssaiLic" in body, false, `FSSAI_ECOM_LIC=${JSON.stringify(v)}`);
    }
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

  test("Razorpay healthy -> Cashfree and PhonePe never called; the order records razorpay with no failover", async () => {
    const h = harness();
    const r = await h.createOrder();
    assert.ok(!h.mocks.calls.some((c) => c.host.endsWith("cashfree.com") || c.host.endsWith("phonepe.com")));
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.gateway, "razorpay");
    assert.equal(o.gwFailover, null);
  });
});

describe("three-step failover: Razorpay -> Cashfree -> PhonePe", () => {
  test("Razorpay down -> Cashfree down -> PhonePe takes the order; each gateway tried once, in order", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 503;
    h.mocks.state.cashfree.create = "network";
    const r = await h.createOrder();
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.gateway, "phonepe");
    assert.match(r.body.phonepe.redirectUrl, /^https:\/\/mercury-uat\.phonepe\.com\//);
    assert.equal(r.body.phonepe.mode, "sandbox");
    assert.equal(r.body.razorpay, undefined);
    const creates = h.mocks.calls.filter((c) => c.method === "POST" && ["/v1/orders", "/pg/orders", "/apis/pg-sandbox/checkout/v2/pay"].includes(c.path));
    assert.deepEqual(creates.map((c) => c.host), ["api.razorpay.com", "sandbox.cashfree.com", "api-preprod.phonepe.com"]);
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "created");
    assert.equal(o.gateway, "phonepe", "the order records which gateway took it");
    assert.equal(o.gwOrderId, r.body.orderId, "PhonePe merchantOrderId = our id");
    assert.equal(o.gwFailover, "razorpay:server_error:503,cashfree:network:0", "and why the others did not");
    assert.ok(h.logs.some((l) => l.includes('"evt":"gateway_failover"') && l.includes('"gateway":"phonepe"')));
    await h.drain();
    const mail = h.mocks.state.resend.sent.find((m) => /failed over to phonepe/.test(m.subject));
    assert.ok(mail, "owner told");
    assert.match(mail.text, /razorpay failed: server_error \(http 503\)\ncashfree failed: network/);
  });

  test("Razorpay timeout -> Cashfree timeout -> PhonePe, without waiting for the hung requests", async () => {
    const h = harness({ env: { GATEWAY_TIMEOUT_MS: "40" } });
    h.mocks.state.razorpay.create = "timeout";
    h.mocks.state.cashfree.create = "timeout";
    const t0 = Date.now();
    const r = await h.createOrder();
    assert.equal(r.body.gateway, "phonepe");
    assert.ok(Date.now() - t0 < 2000);
    assert.equal((await h.store.getOrder(r.body.orderId)).gwFailover, "razorpay:timeout:0,cashfree:timeout:0");
  });

  test("all three down -> 502 payment_unavailable, gateway_error, nothing paid, nothing shipped, owner alerted", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 502;
    h.mocks.state.cashfree.create = 500;
    h.mocks.state.phonepe.create = 503;
    const r = await h.createOrder();
    assert.equal(r.status, 502);
    assert.deepEqual(Object.keys(r.body).sort(), ["error", "ok", "orderId"], "a clean error: no gateway details for the buyer");
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "payment_unavailable");
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "gateway_error");
    assert.equal(o.gwFailover, "razorpay:server_error:502,cashfree:server_error:500,phonepe:server_error:503");
    // nothing can turn it paid: not /verify, not a webhook, not the cron
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(v.status, 409);
    assert.equal((await postPhonePeWebhook(h, phonepeEvent("checkout.order.completed", r.body.orderId, 102600))).body.ignored, true);
    h.advance(11 * 60 * 1000);
    await h.scheduled();
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "gateway_error");
    assert.equal(shiprocketCreates(h).length, 0);
    const down = h.mocks.state.resend.sent.filter((m) => /Checkout DOWN/.test(m.subject));
    assert.equal(down.length, 1);
    assert.match(down[0].text, /razorpay: server_error \(http 502\)\ncashfree: server_error \(http 500\)\nphonepe: server_error \(http 503\)/);
    assert.ok(!h.mocks.state.resend.sent.some((m) => /New paid order/.test(m.subject)));
  });

  test("PhonePe token failure counts as PhonePe down (the chain ends cleanly)", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 503;
    h.mocks.state.cashfree.create = 503;
    h.mocks.state.phonepe.token = 401;
    const r = await h.createOrder();
    assert.equal(r.status, 502);
    assert.match((await h.store.getOrder(r.body.orderId)).gwFailover, /phonepe:auth_failed:401$/);
  });

  test("GATEWAY_ORDER reorders or switches gateways off without code changes", async () => {
    const pp = harness({ env: { GATEWAY_ORDER: "phonepe,razorpay" } });
    const r1 = await pp.createOrder();
    assert.equal(r1.body.gateway, "phonepe");
    assert.ok(!pp.mocks.calls.some((c) => c.host === "api.razorpay.com"));
    assert.deepEqual((await pp.call("GET", "/health")).body.gateways, ["phonepe", "razorpay"]);

    const cf = harness({ env: { GATEWAY_ORDER: " Cashfree , RAZORPAY,bogus,cashfree" } });
    assert.deepEqual((await cf.call("GET", "/health")).body.gateways, ["cashfree", "razorpay"], "trimmed, case-insensitive, unknown and repeated names dropped");
    assert.equal((await cf.createOrder()).body.gateway, "cashfree");

    const noPhonePe = harness({ env: { GATEWAY_ORDER: "razorpay,cashfree" } });
    noPhonePe.mocks.state.razorpay.create = 503;
    noPhonePe.mocks.state.cashfree.create = 503;
    assert.equal((await noPhonePe.createOrder()).status, 502, "PhonePe off: never tried");
    assert.equal(noPhonePe.mocks.calls.filter((c) => c.host.endsWith("phonepe.com")).length, 0);

    const solo = harness({ env: { GATEWAY_ORDER: "razorpay" } });
    solo.mocks.state.razorpay.create = 503;
    assert.equal((await solo.createOrder()).status, 502, "no backup at all");

    for (const v of [undefined, "", "  "]) {
      const d = harness({ env: { GATEWAY_ORDER: v } });
      assert.deepEqual((await d.call("GET", "/health")).body.gateways, ["razorpay", "cashfree", "phonepe"], `default for ${JSON.stringify(v)}`);
    }

    const none = harness({ env: { GATEWAY_ORDER: "none" } });
    const r2 = await none.createOrder();
    assert.equal(r2.status, 503);
    assert.equal(r2.body.reason, "no_gateway");
    assert.equal(gatewayCalls(none).length, 0);
    assert.equal((await none.call("GET", "/health")).body.checkout, "disabled");
  });
});

describe("PhonePe (Standard Checkout v2, UAT in test mode)", () => {
  test("create: amount in paise from our table, our id as merchantOrderId, return URL to /checkout-test/, no customer data", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    const pay = phonepeCalls(h, "/checkout/v2/pay")[0];
    assert.equal(pay.host, "api-preprod.phonepe.com");
    assert.equal(pay.path, "/apis/pg-sandbox/checkout/v2/pay");
    assert.equal(pay.body.merchantOrderId, r.body.orderId);
    assert.equal(pay.body.amount, 102600);
    assert.equal(pay.body.paymentFlow.type, "PG_CHECKOUT");
    assert.equal(pay.body.paymentFlow.merchantUrls.redirectUrl, `https://1acrefarms.co.in/checkout-test/?order_id=${r.body.orderId}&gw=phonepe`);
    assert.equal(pay.body.expireAfter, 1200);
    const sent = JSON.stringify(pay.body);
    for (const pii of ["9876543210", "Lakshmi", "lakshmi.devi@example.com", "Gandhi Nagar", "522002"]) assert.ok(!sent.includes(pii), `PhonePe never gets ${pii}`);
    const tok = phonepeCalls(h, "/v1/oauth/token")[0];
    assert.equal(tok.path, "/apis/pg-sandbox/v1/oauth/token");
  });

  test("verify: Order Status PENDING -> pending; COMPLETED -> paid + one Shiprocket order; never the redirect alone", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    // the customer comes back from PhonePe without paying (or a forged return): still pending
    const p1 = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(p1.status, 200);
    assert.equal(p1.body.status, "pending");
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "created");
    const tx = h.mocks.phonepeFinish(r.body.orderId, "COMPLETED");
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(v.body.ok, true);
    assert.equal(v.body.status, "paid");
    await h.drain();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid");
    assert.equal(o.paidSource, "verify");
    assert.equal(o.paymentId, tx);
    assert.equal(o.shipStatus, "pushed");
    assert.equal(shiprocketCreates(h).length, 1);
    assert.equal(shiprocketCreates(h)[0].body.payment_method, "Prepaid");
    const status = phonepeCalls(h, "/status");
    assert.equal(status[0].path, `/apis/pg-sandbox/checkout/v2/order/${r.body.orderId}/status`);
    assert.equal(h.mocks.state.phonepe.tokens.length, 1, "one token for create + every status check");
    const mail = h.mocks.state.resend.sent.find((m) => /New paid order/.test(m.subject));
    assert.match(mail.text, /Gateway: phonepe \(after razorpay server_error, cashfree server_error\)/);
  });

  test("verify: Order Status FAILED -> failed (the page shows 'did not go through'); a later COMPLETED still counts", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.phonepeFinish(r.body.orderId, "FAILED");
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(v.status, 200);
    assert.deepEqual([v.body.ok, v.body.status], [false, "failed"]);
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "failed");
    h.mocks.phonepeFinish(r.body.orderId, "COMPLETED");
    assert.equal((await h.call("POST", "/verify", { body: { orderId: r.body.orderId } })).body.status, "paid");
  });

  test("verify: paid amount differs -> amount_mismatch, never shipped", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.phonepeFinish(r.body.orderId, "COMPLETED", { amount: 100 });
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(v.status, 409);
    assert.equal(v.body.status, "mismatch");
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "amount_mismatch");
    assert.equal(shiprocketCreates(h).length, 0);
  });

  test("verify: PhonePe status API down -> unknown (200), nothing changes", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.state.phonepe.status = 500;
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.deepEqual([v.status, v.body.status], [200, "unknown"]);
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "created");
  });

  test("webhook: SHA256(username:password) checked; paid only after Order Status says COMPLETED; duplicates dropped", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.phonepeFinish(r.body.orderId, "COMPLETED", { transactionId: "OM2611TXN0001" });
    const raw = phonepeEvent("checkout.order.completed", r.body.orderId, r.body.totalPaise);
    assert.equal((await postPhonePeWebhook(h, raw, { password: "wrongPass123" })).status, 401);
    assert.equal((await postPhonePeWebhook(h, raw, { authorization: null })).status, 401, "no header");
    assert.equal((await postPhonePeWebhook(h, raw, { authorization: `SHA256 ${phonepeWebhookAuth("onacre_hook", "mockHookPass123")}` })).status, 401, "exact value only");
    const statusBefore = phonepeCalls(h, "/status").length;
    const w1 = await postPhonePeWebhook(h, raw);
    assert.deepEqual([w1.status, w1.body], [200, { ok: true }]);
    assert.ok(h.ctx.pendingCount() > 0, "the status check runs after the reply (PhonePe wants 2xx in 3-5 s)");
    const w2 = await postPhonePeWebhook(h, raw);
    assert.equal(w2.body.duplicate, true);
    await h.drain();
    assert.equal(phonepeCalls(h, "/status").length, statusBefore + 1, "one status check for two deliveries");
    await h.call("POST", "/verify", { body: { orderId: r.body.orderId } }); // the browser's return trip too
    await h.drain();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid");
    assert.equal(o.paidSource, "webhook");
    assert.equal(o.paymentId, "OM2611TXN0001");
    assert.equal(shiprocketCreates(h).length, 1, "exactly one Shiprocket order");
    assert.equal(h.mocks.state.resend.sent.filter((m) => /New paid order/.test(m.subject)).length, 1, "exactly one owner alert");
  });

  test("webhook: a 'completed' body is NOT trusted when Order Status disagrees (forged/early); it can be retried later", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    const raw = phonepeEvent("checkout.order.completed", r.body.orderId, r.body.totalPaise);
    assert.equal((await postPhonePeWebhook(h, raw)).status, 200);
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "created", "status API says PENDING: not paid");
    assert.equal(shiprocketCreates(h).length, 0);
    h.mocks.phonepeFinish(r.body.orderId, "COMPLETED");
    const again = await postPhonePeWebhook(h, raw);
    assert.equal(again.body.duplicate, undefined, "the undecided event was forgotten, so PhonePe's retry is processed");
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "paid");
  });

  test("webhook: checkout.order.failed -> failed via Order Status; unknown order and other events ignored; bad JSON 400", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.phonepeFinish(r.body.orderId, "FAILED");
    assert.equal((await postPhonePeWebhook(h, phonepeEvent("checkout.order.failed", r.body.orderId, r.body.totalPaise, { state: "FAILED" }))).status, 200);
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "failed");
    assert.equal((await postPhonePeWebhook(h, phonepeEvent("checkout.order.completed", "1AF-T-261112-NOTOUR", 50000))).body.ignored, true);
    assert.equal((await postPhonePeWebhook(h, phonepeEvent("pg.refund.completed", r.body.orderId, 100))).body.ignored, true);
    assert.equal((await postPhonePeWebhook(h, "{not json")).status, 400);
    // a Razorpay order id sent to the PhonePe webhook is ignored too
    const rz = harness();
    const rr = await rz.createOrder();
    assert.equal((await postPhonePeWebhook(rz, phonepeEvent("checkout.order.completed", rr.body.orderId, rr.body.totalPaise))).body.ignored, true);
  });

  test("webhook: refused when the username/password secrets are not set", async () => {
    const h = harness({ env: { PHONEPE_WEBHOOK_USERNAME: undefined, PHONEPE_WEBHOOK_PASSWORD: undefined } });
    const r = await postPhonePeWebhook(h, phonepeEvent("checkout.order.completed", "1AF-T-261112-AAAAAA", 100), { username: "", password: "" });
    assert.equal(r.status, 401);
  });

  test("reconcile: paid at PhonePe, no webhook, browser never came back -> paid and shipped by the cron", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.phonepeFinish(r.body.orderId, "COMPLETED");
    h.advance(11 * 60 * 1000);
    await h.scheduled();
    const o = await h.store.getOrder(r.body.orderId);
    assert.equal(o.status, "paid");
    assert.equal(o.paidSource, "reconcile");
    assert.equal(o.shipStatus, "pushed");
  });

  test("reconcile: a FAILED PhonePe order is marked failed, then expired after 24 h (not re-checked forever)", async () => {
    const h = harness();
    const r = await phonepeOrder(h);
    h.mocks.phonepeFinish(r.body.orderId, "FAILED");
    h.advance(11 * 60 * 1000);
    await h.scheduled();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "failed");
    h.advance(25 * 3600 * 1000);
    await h.scheduled();
    assert.equal((await h.store.getOrder(r.body.orderId)).status, "expired");
    h.advance(3600 * 1000);
    assert.equal((await h.store.listUnpaidForReconcile(h.now(), 10 * 60 * 1000, 10)).length, 0, "out of the reconcile list");
  });

  test("live mode: PhonePe production hosts (identity-manager + pg); test mode never touches them", async () => {
    const h = harness({ env: LIVE_ENV });
    const r = await phonepeOrder(h);
    assert.match(r.body.orderId, /^1AF-W-/);
    assert.equal(r.body.phonepe.mode, "production");
    assert.match(r.body.phonepe.redirectUrl, /^https:\/\/mercury-t2\.phonepe\.com\//);
    assert.deepEqual(h.mocks.calls.filter((c) => c.host.endsWith("phonepe.com")).map((c) => `${c.host}${c.path}`), [
      "api.phonepe.com/apis/identity-manager/v1/oauth/token",
      "api.phonepe.com/apis/pg/checkout/v2/pay",
    ]);
    const t = harness();
    await phonepeOrder(t);
    assert.ok(!t.mocks.calls.some((c) => c.host === "api.phonepe.com"), "test mode: UAT only");
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
    assert.equal(body.shipping_charges, 0, "delivery is free: nothing charged for shipping");
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
  h.mocks.state.cashfree.create = 500;
  const pp = await h.createOrder();
  assert.equal(pp.body.gateway, "phonepe");
  await postPhonePeWebhook(h, "{}", { password: "wrongPass123" });
  h.mocks.phonepeFinish(pp.body.orderId, "COMPLETED");
  await postPhonePeWebhook(h, phonepeEvent("checkout.order.completed", pp.body.orderId, pp.body.totalPaise));
  await h.call("POST", "/verify", { body: { orderId: pp.body.orderId } });
  h.mocks.state.phonepe.create = 500;
  await h.createOrder();
  await h.drain();
  await h.scheduled();
  const all = h.logs.join("\n");
  assert.ok(h.logs.length > 10, "the flow did log");
  const tokens = h.mocks.state.phonepe.tokens.map((t) => t.token);
  assert.ok(tokens.length >= 1);
  for (const needle of ["9876543210", "98765", "9123456789", "Gandhi Nagar", "12-3-45", "Water Tank", "lakshmi.devi@example.com", "Lakshmi", "522002",
    ...SECRET_VALUES, ...tokens, phonepeWebhookAuth(TEST_ENV.PHONEPE_WEBHOOK_USERNAME, TEST_ENV.PHONEPE_WEBHOOK_PASSWORD), TEST_ENV.PHONEPE_WEBHOOK_USERNAME]) {
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

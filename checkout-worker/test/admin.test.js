// Admin Shiprocket API (src/admin.js) against the mocked Shiprocket: auth, CORS, courier rules, booking safety.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, LIVE_ENV, SECRET_VALUES, SITE, TEST_ENV, harness, postRazorpayWebhook, razorpayOrderPaidEvent } from "./helpers/harness.js";
import { classifyCourier } from "../src/admin.js";

const AMAZON_ID = "402-9649273-4891501";
const SR = "/v1/external";
const callsTo = (h, path) => h.mocks.calls.filter((c) => c.host === "apiv2.shiprocket.in" && c.path === `${SR}${path}`);
const assignCalls = (h) => callsTo(h, "/courier/assign/awb");
const srCalls = (h) => h.mocks.calls.filter((c) => c.host === "apiv2.shiprocket.in");
const corsHeaders = (res) => [...res.headers.keys()].filter((k) => k.startsWith("access-control-"));

function seed(h, opts = {}) {
  return h.mocks.seedShiprocketOrder({ channelOrderId: AMAZON_ID, ...opts });
}
const bookBody = (shipmentId, extra = {}) => ({
  shipmentId, courierId: 54, maxRupees: 145, said: `ship ${AMAZON_ID}`, confirm: `ship ${shipmentId}`, pickup: "today", ...extra,
});
const AMAZON_ORDER = Object.freeze({
  orderId: "171-5635376-6368363",
  payment: "prepaid", // as Seller Central shows it: a Pay-on-Delivery order is refused
  customer: { name: "Ravi Kumar", phone: "+91 98480 12345", address: "H.No 4-56, Temple Street, Ramnagar", city: "Raipur", state: "CHHATTISGARH", pin: "490023" },
  items: [{ sku: "1AF-KPAS-0540", name: "Araku Hill Turmeric Powder 540g", qty: 1, price: 495 }, { sku: "1AF-CBEL-0540", qty: 2, price: 220 }],
});

describe("admin auth (fail closed)", () => {
  test("503 admin_not_configured when ADMIN_TOKEN is unset or too short; Shiprocket never called", async () => {
    for (const ADMIN_TOKEN of [undefined, "", "short-token", "x".repeat(42)]) {
      const h = harness({ env: { ADMIN_TOKEN } });
      const r = await h.admin("GET", "/admin/sr/wallet", undefined, { token: ADMIN_TOKEN ?? "anything" });
      assert.equal(r.status, 503, String(ADMIN_TOKEN));
      assert.deepEqual(r.body, { ok: false, error: "admin_not_configured" });
      assert.equal(srCalls(h).length, 0);
    }
  });

  test("401 with no header, a wrong token, a near miss, another scheme; nothing reaches Shiprocket", async () => {
    const h = harness();
    const good = TEST_ENV.ADMIN_TOKEN;
    const cases = [
      { token: null },
      { token: "wrong-token" },
      { token: `${good.slice(0, -1)}y` },
      { token: `${good}x` },
      { token: good.slice(1) },
      { token: null, headers: { authorization: `Basic ${good}` } },
      { token: null, headers: { authorization: `bearer ${good}` } },
      { token: null, headers: { authorization: `Bearer  ${good}` } },
    ];
    for (const c of cases) {
      const r = await h.admin("GET", "/admin/sr/wallet", undefined, c);
      assert.equal(r.status, 401, JSON.stringify(c));
      assert.deepEqual(r.body, { ok: false, error: "unauthorised" });
      assert.equal(r.headers.get("www-authenticate"), "Bearer");
    }
    // auth comes before routing: unknown admin paths and wrong methods do not reveal anything either
    assert.equal((await h.admin("GET", "/admin/sr/nope", undefined, { token: "bad" })).status, 401);
    assert.equal((await h.admin("PUT", "/admin/sr/wallet", undefined, { token: null })).status, 401);
    assert.equal((await h.admin("GET", "/admin", undefined, { token: null })).status, 401);
    assert.equal(srCalls(h).length, 0);
  });

  test("the right token works; unknown admin path 404; wrong method 405", async () => {
    const h = harness();
    const r = await h.admin("GET", "/admin/sr/wallet");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true, balanceRupees: 11221.45, low: false });
    assert.equal((await h.admin("GET", "/admin/sr/nope")).status, 404);
    const put = await h.admin("PUT", "/admin/sr/wallet");
    assert.equal(put.status, 405);
    assert.equal(put.headers.get("allow"), "GET");
    assert.equal((await h.admin("GET", "/admin/sr/book")).status, 405);
    assert.equal((await h.admin("POST", "/admin/sr/quote", undefined, { headers: {} })).body.error, "bad_json");
  });

  test("no CORS on any admin reply, even from the site's own origin; OPTIONS 403", async () => {
    const h = harness();
    for (const token of [TEST_ENV.ADMIN_TOKEN, "bad", null]) {
      const r = await h.admin("GET", "/admin/sr/wallet", undefined, { token, origin: SITE });
      assert.deepEqual(corsHeaders(r), [], `token ${token}`);
    }
    const q = await h.admin("POST", "/admin/sr/quote", { pin: "490023" }, { origin: SITE });
    assert.equal(q.status, 200);
    assert.deepEqual(corsHeaders(q), []);
    const pre = await h.call("OPTIONS", "/admin/sr/book", { origin: SITE, headers: { "access-control-request-method": "POST", "access-control-request-headers": "authorization" } });
    assert.equal(pre.status, 403);
    assert.deepEqual(corsHeaders(pre), []);
    const off = harness({ env: { ADMIN_TOKEN: undefined } });
    assert.deepEqual(corsHeaders(await off.admin("GET", "/admin/sr/wallet", undefined, { origin: SITE })), []);
  });

  test("existing routes unchanged: /health and /create-order keep CORS; other GETs 404", async () => {
    const h = harness();
    const health = await h.call("GET", "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(Object.keys(health.body).sort(), ["checkout", "gateways", "mode", "ok"]);
    assert.equal(health.headers.get("access-control-allow-origin"), SITE);
    const r = await h.createOrder();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), SITE);
    assert.equal((await h.call("GET", "/verify")).status, 404);
    assert.equal((await h.call("GET", "/administrator")).status, 404);
  });

  test("admin does not depend on MODE or the checkout gates (Shiprocket has no sandbox)", async () => {
    for (const env of [{ MODE: "live" }, { MODE: "nonsense" }, LIVE_ENV]) {
      const h = harness({ env });
      assert.equal((await h.admin("GET", "/admin/sr/wallet")).status, 200, JSON.stringify(env));
    }
  });
});

describe("courier rules", () => {
  test("classifyCourier: DTDC / Blue Dart / India Post only; anything Delhivery never", () => {
    const allowed = ["DTDC Surface", "DTDC Air 500gm", "dtdc 5kg", "Blue Dart Air", "Bluedart Surface 500 gm", "Blue-Dart Apex", "India Post-Business Parcel Surface Prepaid", "INDIA POST Speed Post"];
    for (const n of allowed) assert.deepEqual(classifyCourier(n), { allowed: true }, n);
    for (const n of ["Delhivery Surface", "DELHIVERY Air", "Delhivery Surface 2 Kgs", "delhivery", "DTDC via Delhivery", "Blue Dart (Delhivery)"]) {
      assert.deepEqual(classifyCourier(n), { allowed: false, reason: "delhivery_never" }, n);
    }
    for (const n of ["Ekart Logistics Surface", "Xpressbees Surface", "Shadowfax", "Amazon Shipping", "", undefined, "DTDCX Air"]) {
      assert.deepEqual(classifyCourier(n), { allowed: false, reason: "not_on_allow_list" }, String(n));
    }
  });
});

describe("POST /admin/sr/quote", () => {
  test("allowed couriers only, cheapest first (ties: faster first); Delhivery hidden and counted; cod=0, pickup 522601, parcelFor weight", async () => {
    const h = harness();
    const r = await h.admin("POST", "/admin/sr/quote", { pin: "490023", packs: 2, declaredRupees: 729 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const q = callsTo(h, "/courier/serviceability/")[0].query;
    assert.deepEqual(q, { pickup_postcode: "522601", delivery_postcode: "490023", cod: "0", weight: "1.18", length: "30", breadth: "22", height: "8", declared_value: "729" });
    assert.deepEqual(r.body.options.map((o) => [o.courierId, o.courier, o.rate, o.days]), [
      [54, "DTDC Surface", 134.82, 3],
      [19, "India Post-Business Parcel Surface Prepaid", 134.82, 6],
      [55, "DTDC Air 500gm", 164.42, 2],
      [99, "Blue Dart Air", 185.76, 2],
    ]);
    assert.equal(r.body.cheapest.courierId, 54, "never Shiprocket's recommended (Delhivery) courier");
    assert.deepEqual(r.body.delhivery, { hidden: 2 });
    const shown = JSON.stringify({ ...r.body, delhivery: undefined });
    assert.ok(!/delhivery/i.test(shown) && !shown.includes("96.5") && !shown.includes("150.1"), "Delhivery is never named or priced in a quote");
    assert.deepEqual(r.body.notAllowed.map((n) => [n.courier, n.reason]), [["Ekart Logistics Surface", "not_on_allow_list"], ["Xpressbees Surface", "not_on_allow_list"]]);
    assert.equal(r.body.cod, 0);
    assert.equal(r.body.from, "522601");
    assert.equal(r.body.pickup, "home");
    assert.equal(r.body.dims, "30x22x8");
    assert.equal(r.body.parcelEstimated, false);
  });

  test("weight and size overrides; 4+ packs flagged as an estimate; Delhivery in the blocked list is hidden too", async () => {
    const h = harness();
    h.mocks.state.shiprocket.blockedCouriers = [{ courier_company_id: 10, courier_name: "Delhivery Surface 2 Kgs", block_reason: "x" }, { courier_company_id: 77, courier_name: "Shadowfax Surface", block_reason: "low performance" }];
    const r = await h.admin("POST", "/admin/sr/quote", { pin: "110001", weightKg: 0.75, lengthCm: 26, breadthCm: 18, heightCm: 5 });
    assert.equal(r.status, 200);
    const q = callsTo(h, "/courier/serviceability/")[0].query;
    assert.deepEqual([q.weight, q.length, q.breadth, q.height, q.cod], ["0.75", "26", "18", "5", "0"]);
    assert.deepEqual(r.body.blocked, [{ courier: "Shadowfax Surface", reason: "low performance" }]);
    assert.deepEqual(r.body.delhivery, { hidden: 3 });
    const big = await h.admin("POST", "/admin/sr/quote", { pin: "110001", packs: 5 });
    assert.equal(big.body.parcelEstimated, true);
  });

  test("bad input is refused before Shiprocket; an unserviceable PIN is not an error", async () => {
    const h = harness();
    for (const body of [{ pin: "990001" }, { pin: "52260" }, { pin: "490023", packs: 0 }, { pin: "490023", packs: 13 }, { pin: "490023", weightKg: 31 },
      { pin: "490023", declaredRupees: -1 }, { shipmentId: "12x" }, { orderId: "1AF-T-261112-ABCDEF" }]) {
      const r = await h.admin("POST", "/admin/sr/quote", body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.equal(srCalls(h).length, 0);
    h.mocks.state.shiprocket.serviceability = "unserviceable";
    const r = await h.admin("POST", "/admin/sr/quote", { pin: "744101" });
    assert.equal(r.status, 200);
    assert.equal(r.body.serviceable, false);
    assert.deepEqual(r.body.options, []);
    assert.equal(r.body.cheapest, null);
  });

  test("quote a shipment: uses its Shiprocket order (order_id) and shows our ref", async () => {
    const h = harness();
    const { srOrderId, shipmentId } = seed(h);
    const r = await h.admin("POST", "/admin/sr/quote", { shipmentId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.ref, AMAZON_ID);
    assert.equal(r.body.refusal, null);
    assert.equal(r.body.awb, null);
    const q = callsTo(h, "/courier/serviceability/")[0].query;
    assert.deepEqual([q.order_id, q.cod, q.pickup_postcode, q.delivery_postcode, q.weight], [srOrderId, "0", "522601", "490023", undefined]);
    assert.equal((await h.admin("POST", "/admin/sr/quote", { shipmentId: "123456" })).status, 404);
  });

  test("quote one of our website orders from D1 (its PIN and parcel)", async () => {
    const h = harness({ env: LIVE_ENV });
    const o = await h.createOrder([{ code: "TURM", qty: 3 }], { ...CUSTOMER, city: "Raipur", state: "Chhattisgarh", pin: "490023" });
    assert.match(o.body.orderId, /^1AF-W-/);
    const r = await h.admin("POST", "/admin/sr/quote", { orderId: o.body.orderId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.to, "490023");
    const q = callsTo(h, "/courier/serviceability/")[0].query;
    assert.deepEqual([q.weight, q.declared_value, q.cod], ["1.9", "1188", "0"]);
  });
});

describe("POST /admin/sr/create (no AWB)", () => {
  test("Amazon self-ship order: Prepaid, pickup home, free shipping, brand inbox as e-mail, canonical state, catalogue items", async () => {
    const h = harness();
    const r = await h.admin("POST", "/admin/sr/create", AMAZON_ORDER);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.srOrderId, r.body.srShipmentId, r.body.pickup, r.body.weightKg, r.body.dims], ["700001", "800001", "home", 1.9, "26x21x13"]);
    const sent = callsTo(h, "/orders/create/adhoc")[0].body;
    assert.equal(sent.order_id, AMAZON_ORDER.orderId);
    assert.equal(sent.payment_method, "Prepaid");
    assert.equal(sent.shipping_charges, 0);
    assert.equal(sent.pickup_location, "home");
    assert.equal(sent.billing_phone, "9848012345");
    assert.equal(sent.billing_email, "1acrefarmsindia@gmail.com");
    assert.equal(sent.billing_state, "Chhattisgarh");
    assert.deepEqual([sent.billing_customer_name, sent.billing_last_name], ["Ravi", "Kumar"]);
    assert.deepEqual(sent.order_items.map((i) => [i.sku, i.units, i.selling_price]), [["1AF-KPAS-0540", 1, 495], ["1AF-CBEL-0540", 2, 220]]);
    assert.equal(sent.sub_total, 935);
    assert.match(sent.order_date, /^2026-11-12 10:0\d$/);
    assert.ok(!JSON.stringify(r.body).includes("98480") && !JSON.stringify(r.body).includes("Temple Street"), "no phone or address in the reply");
  });

  test("parcel override, Flipkart ids, an explicit e-mail", async () => {
    const h = harness();
    const r = await h.admin("POST", "/admin/sr/create", {
      ...AMAZON_ORDER, orderId: "OD432109876543210987", customer: { ...AMAZON_ORDER.customer, email: "buyer@example.com" },
      items: [{ code: "TURM", qty: 1 }], parcel: { weightKg: 0.56, lengthCm: 26.5, breadthCm: 17, heightCm: 4 },
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const sent = callsTo(h, "/orders/create/adhoc")[0].body;
    assert.deepEqual([sent.weight, sent.length, sent.breadth, sent.height, sent.billing_email], [0.56, 26.5, 17, 4, "buyer@example.com"]);
    assert.equal(sent.order_items[0].selling_price, 396, "MRP when no price is given");
  });

  test("refused before Shiprocket: no phone, price above MRP, unknown SKU, bad id, a test-mode id, a customer for a website order", async () => {
    const h = harness();
    const bad = [
      { ...AMAZON_ORDER, customer: { ...AMAZON_ORDER.customer, phone: "" } },
      { ...AMAZON_ORDER, items: [{ sku: "1AF-KPAS-0540", qty: 1, price: 600 }] },
      { ...AMAZON_ORDER, items: [{ sku: "1AF-PALM-0540", qty: 1 }] },
      { ...AMAZON_ORDER, items: [] },
      { ...AMAZON_ORDER, orderId: "12345" },
      { ...AMAZON_ORDER, orderId: "1AF-T-261112-ABCDEF" },
      { ...AMAZON_ORDER, orderId: "1AF-W-261112-ABCDEF" },
      { ...AMAZON_ORDER, customer: { ...AMAZON_ORDER.customer, pin: "522002" } }, // AP PIN, Chhattisgarh state
    ];
    for (const body of bad) {
      const r = await h.admin("POST", "/admin/sr/create", body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    const noPhone = await h.admin("POST", "/admin/sr/create", bad[0]);
    assert.deepEqual(noPhone.body.errors, [{ field: "phone", code: "required" }]);
    // prepaid only: a marketplace order must say it was prepaid; Pay-on-Delivery is refused, never shipped as Prepaid
    const { payment, ...noPayment } = AMAZON_ORDER;
    assert.equal(payment, "prepaid");
    for (const [body, code] of [[noPayment, "required"], [{ ...AMAZON_ORDER, payment: "cod" }, "cod_not_supported"], [{ ...AMAZON_ORDER, payment: "Pay on Delivery" }, "cod_not_supported"]]) {
      const r = await h.admin("POST", "/admin/sr/create", body);
      assert.equal(r.status, 400, JSON.stringify(body.payment));
      assert.deepEqual(r.body.errors, [{ field: "payment", code }]);
    }
    assert.equal(srCalls(h).length, 0);
  });

  test("an AWB auto-assigned at create (account auto-assign on): 409, URGENT alert for Delhivery, book refuses that shipment", async () => {
    const h = harness();
    h.mocks.state.shiprocket.createExtra = { awb_code: "1490810000077", courier_company_id: 10, courier_name: "Delhivery Surface" };
    const r = await h.admin("POST", "/admin/sr/create", AMAZON_ORDER);
    assert.deepEqual([r.status, r.body.error, r.body.awb, r.body.courierAllowed, r.body.courierReason, r.body.srShipmentId], [409, "awb_auto_assigned", "1490810000077", false, "delhivery_never", "800001"]);
    await h.drain();
    const mail = h.mocks.state.resend.sent.find((m) => /auto-assigned/.test(m.subject));
    assert.ok(mail && /(^|\] )URGENT:/.test(mail.subject), "URGENT owner alert");
    assert.ok(!(mail.subject + mail.text).includes("98480") && !(mail.subject + mail.text).includes("Temple Street"));
    h.mocks.state.shiprocket.createExtra = null;
    const b = await h.admin("POST", "/admin/sr/book", { ...bookBody("800001"), said: `ship ${AMAZON_ORDER.orderId}` });
    assert.deepEqual([b.status, b.body.error, b.body.booked?.awb], [409, "already_booking_or_booked", "1490810000077"]);
    assert.equal(assignCalls(h).length, 0);
    // an allowed courier auto-assigned is still flagged (no "ship <ID>"), as CHECK
    const g = harness();
    g.mocks.state.shiprocket.createExtra = { awb_code: "7D140000077", courier_company_id: 54, courier_name: "DTDC Surface" };
    const r2 = await g.admin("POST", "/admin/sr/create", AMAZON_ORDER);
    assert.deepEqual([r2.status, r2.body.error, r2.body.courierAllowed], [409, "awb_auto_assigned", true]);
    await g.drain();
    assert.ok(g.mocks.state.resend.sent.some((m) => /(^|\] )CHECK: Shiprocket auto-assigned/.test(m.subject)));
    // an empty awb_code (the normal reply) is no AWB
    const n = harness();
    n.mocks.state.shiprocket.createExtra = { awb_code: "", courier_name: "" };
    assert.equal((await n.admin("POST", "/admin/sr/create", AMAZON_ORDER)).status, 200);
  });

  test("the website order push also flags an AWB auto-assigned at create (URGENT on Delhivery); the order stays pushed", async () => {
    const h = harness({ env: LIVE_ENV });
    h.mocks.state.shiprocket.createExtra = { awb_code: "1490810000088", courier_company_id: 10, courier_name: "Delhivery Surface" };
    const r = await h.createOrder();
    const gw = r.body.razorpay.orderId;
    const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "pushed");
    assert.ok(h.mocks.state.resend.sent.some((m) => m.subject.endsWith(`URGENT: Shiprocket auto-assigned AWB 1490810000088 at order create for ${r.body.orderId}`)));
    assert.ok(h.logs.some((l) => l.includes("shiprocket_auto_awb") && l.includes("delhivery_never")));
    // no AWB in the reply (the normal case): no such alert
    const n = harness({ env: LIVE_ENV });
    const r2 = await n.createOrder();
    const pay2 = n.mocks.razorpayCapture(r2.body.razorpay.orderId, r2.body.totalPaise);
    await postRazorpayWebhook(n, razorpayOrderPaidEvent(r2.body.razorpay.orderId, pay2, r2.body.totalPaise));
    await n.drain();
    assert.ok(!n.mocks.state.resend.sent.some((m) => /auto-assigned/.test(m.subject)));
  });

  test("a repeated order id -> 409 already_exists with the existing Shiprocket order", async () => {
    const h = harness();
    assert.equal((await h.admin("POST", "/admin/sr/create", AMAZON_ORDER)).status, 200);
    const again = await h.admin("POST", "/admin/sr/create", AMAZON_ORDER);
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_exists");
    assert.deepEqual(again.body.matches.map((m) => [m.srOrderId, m.shipmentId, m.awb]), [["700001", "800001", null]]);
  });

  test("re-push a paid website order whose automatic push failed (from D1); never one the cron still owns", async () => {
    const h = harness({ env: LIVE_ENV });
    h.mocks.state.shiprocket.queue = [422];
    const r = await h.createOrder();
    const gw = r.body.razorpay.orderId;
    const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "failed");
    const c = await h.admin("POST", "/admin/sr/create", { orderId: r.body.orderId });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    const o = await h.store.getOrder(r.body.orderId);
    assert.deepEqual([o.shipStatus, o.srOrderId, o.srShipmentId], ["pushed", c.body.srOrderId, c.body.srShipmentId]);
    assert.equal(callsTo(h, "/orders/create/adhoc").at(-1).body.billing_phone, "9876543210");
    const again = await h.admin("POST", "/admin/sr/create", { orderId: r.body.orderId });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "push_not_failed");
    const unpaid = await h.createOrder();
    assert.equal((await h.admin("POST", "/admin/sr/create", { orderId: unpaid.body.orderId })).body.error, "not_paid");
  });
});

describe("POST /admin/sr/book (spends wallet money)", () => {
  test("happy path: re-quote, wallet, ONE assign with our courier_id, then pickup, label; owner alert without phone/address", async () => {
    const h = harness();
    const { srOrderId, shipmentId } = seed(h);
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.awb, /^7D\d{9}$/);
    assert.deepEqual([r.body.courier, r.body.courierId, r.body.rate, r.body.ref, r.body.srOrderId], ["DTDC Surface", 54, 134.82, AMAZON_ID, srOrderId]);
    assert.equal(r.body.pickup.ok, true);
    assert.equal(r.body.pickup.scheduledDate, "2026-11-12 14:00:00");
    assert.match(r.body.labelUrl, /^https:\/\/.+\.pdf$/);
    assert.equal(r.body.walletAfterRupees, 11221.45);
    assert.equal(r.body.walletLow, false);
    const a = assignCalls(h);
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].body, { shipment_id: Number(shipmentId), courier_id: 54 });
    const q = callsTo(h, "/courier/serviceability/")[0].query;
    assert.deepEqual([q.order_id, q.cod, q.pickup_postcode], [srOrderId, "0", "522601"]);
    const order = srCalls(h).map((c) => c.path.replace(SR, ""));
    const at = (p) => order.indexOf(p);
    assert.ok(at("/courier/serviceability/") < at("/account/details/wallet-balance"));
    assert.ok(at("/account/details/wallet-balance") < at("/courier/assign/awb"));
    assert.ok(at("/courier/assign/awb") < at("/courier/generate/pickup"));
    assert.ok(at("/courier/generate/pickup") < at("/courier/generate/label"));
    assert.deepEqual(callsTo(h, "/courier/generate/pickup")[0].body, { shipment_id: [Number(shipmentId)] });
    assert.equal(callsTo(h, "/manifests/generate").length, 0);
    await h.drain();
    const mail = h.mocks.state.resend.sent.find((m) => m.subject.includes("Booked"));
    assert.ok(mail);
    assert.match(mail.subject, new RegExp(`Booked ${AMAZON_ID}: DTDC Surface AWB 7D\\d{9} Rs 134.82`));
    for (const needle of ["9123456780", "Mock Street", "Mock Buyer", "amazonaws", "label_"]) assert.ok(!(mail.subject + mail.text).includes(needle), needle);
    // a second call is refused by the lock and never reaches the assign endpoint
    const again = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(again.status, 409);
    assert.equal(again.body.error, "already_booking_or_booked");
    assert.equal(again.body.booked.awb, r.body.awb);
    assert.equal(assignCalls(h).length, 1);
  });

  test("said may name the shipment id; pickup none (counter drop), a future pickup date, manifest; Blue Dart", async () => {
    const h = harness();
    const a = seed(h);
    const none = await h.admin("POST", "/admin/sr/book", bookBody(a.shipmentId, { said: `ship ${a.shipmentId}`, pickup: "none" }));
    assert.equal(none.status, 200, JSON.stringify(none.body));
    assert.deepEqual(none.body.pickup, { requested: false });
    assert.equal(callsTo(h, "/courier/generate/pickup").length, 0);
    assert.ok(none.body.labelUrl);
    const b = seed(h, { channelOrderId: "403-1111111-2222222" });
    const blue = await h.admin("POST", "/admin/sr/book", bookBody(b.shipmentId, { said: "ship 403-1111111-2222222", courierId: 99, maxRupees: 196, pickup: "2026-11-13", manifest: true }));
    assert.equal(blue.status, 200, JSON.stringify(blue.body));
    assert.match(blue.body.awb, /^9073\d{7}$/);
    assert.deepEqual(callsTo(h, "/courier/generate/pickup")[0].body, { shipment_id: [Number(b.shipmentId)], pickup_date: ["2026-11-13"] });
    assert.match(blue.body.manifestUrl, /manifest_/);
  });

  test("every refusal happens before the assign call (no money moves)", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    const cases = [
      [bookBody(shipmentId, { confirm: undefined }), 400, "confirm_required"],
      [bookBody(shipmentId, { confirm: "ship 999" }), 400, "confirm_required"],
      [bookBody(shipmentId, { confirm: `Ship ${shipmentId}` }), 400, "confirm_required"],
      [bookBody(shipmentId, { said: undefined }), 400, "said_required"],
      [bookBody(shipmentId, { said: "ship" }), 400, "said_required"],
      [bookBody(shipmentId, { said: "ship all" }), 400, "one_shipment_per_call"],
      [bookBody(shipmentId, { said: "ship 402-0000000-0000000" }), 400, "said_mismatch"],
      [bookBody(shipmentId, { courierId: 10 }), 403, "courier_not_allowed"],
      [bookBody(shipmentId, { courierId: 12 }), 403, "courier_not_allowed"],
      [bookBody(shipmentId, { courierId: 43 }), 403, "courier_not_allowed"],
      [bookBody(shipmentId, { courierId: 777 }), 409, "courier_not_offered"],
      [bookBody(shipmentId, { courierId: "54" }), 400, "invalid"],
      [bookBody(shipmentId, { maxRupees: 130 }), 409, "price_changed"],
      [bookBody(shipmentId, { maxRupees: undefined }), 400, "invalid"],
      [bookBody(shipmentId, { pickup: undefined }), 400, "pickup_required"],
      [bookBody(shipmentId, { pickup: "2026-11-11" }), 400, "invalid"],
      [bookBody(shipmentId, { pickup: "2026-02-30" }), 400, "invalid"],
      [bookBody("12a"), 400, "invalid"],
      [bookBody("555555", { confirm: "ship 555555" }), 404, "unknown_shipment"],
    ];
    for (const [body, status, error] of cases) {
      const r = await h.admin("POST", "/admin/sr/book", body);
      assert.deepEqual([r.status, r.body.error], [status, error], JSON.stringify(body));
    }
    const del = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId, { courierId: 10 }));
    assert.equal(del.body.reason, "delhivery_never");
    assert.ok(!JSON.stringify(del.body).includes("Delhivery"), "the refusal names the rule, not the courier");
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId, { courierId: 43 }))).body.reason, "not_on_allow_list");
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId, { maxRupees: 130 }))).body.rate, 134.82);
    // an allowed courier that Shiprocket marks blocked in the live re-quote
    const dtdc = h.mocks.state.shiprocket.couriers.find((c) => c.courier_company_id === 54);
    dtdc.blocked = 1;
    const blocked = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([blocked.status, blocked.body.error], [409, "courier_blocked"]);
    dtdc.blocked = 0;
    assert.equal(assignCalls(h).length, 0, "the assign endpoint was never called");
    // every refusal released the lock: the right call still books
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).status, 200);
    assert.equal(assignCalls(h).length, 1);
  });

  test("refused for the order itself: not prepaid, not our custom channel, wrong pickup, already booked", async () => {
    const h = harness();
    const cases = [
      [{ paymentMethod: "cod", cod: 1 }, 409, "not_prepaid"],
      [{ paymentMethod: "prepaid", cod: 1 }, 409, "not_prepaid"],
      [{ baseChannel: "AZ" }, 409, "not_custom_channel"],
      [{ pickup: "old-farm" }, 409, "wrong_pickup"],
      [{ awb: "7D100000001", courier: "DTDC Surface" }, 409, "already_booked"],
    ];
    for (const [opts, status, error] of cases) {
      const { shipmentId } = seed(h, opts);
      const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
      assert.deepEqual([r.status, r.body.error], [status, error], JSON.stringify(opts));
    }
    assert.equal(assignCalls(h).length, 0);
  });

  test("orders/show with pickup_location \"\" (the public docs' shape): the pickup is read from the orders-list row", async () => {
    const h = harness();
    const a = seed(h);
    Object.assign(h.mocks.state.shiprocket.orders.get(a.srOrderId), { pickup_location: "", pickup_location_id: "", pickup_address: [], _listPickup: "home" });
    const q = await h.admin("POST", "/admin/sr/quote", { shipmentId: a.shipmentId });
    assert.equal(q.body.refusal, null);
    const r = await h.admin("POST", "/admin/sr/book", bookBody(a.shipmentId));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(callsTo(h, "/orders").some((c) => c.query.search === AMAZON_ID), "looked the order up in the list");
    // the list row says another pickup, or nothing: refused before the assign call
    for (const listPickup of ["old-farm", ""]) {
      const b = seed(h, { channelOrderId: `406-1111111-222222${listPickup ? 1 : 2}` });
      Object.assign(h.mocks.state.shiprocket.orders.get(b.srOrderId), { pickup_location: "", _listPickup: listPickup });
      const x = await h.admin("POST", "/admin/sr/book", bookBody(b.shipmentId, { said: `ship ${b.shipmentId}` }));
      assert.deepEqual([x.status, x.body.error], [409, "wrong_pickup"], listPickup);
    }
    assert.equal(assignCalls(h).length, 1);
  });

  test("over the Rs 500 cap (SR_BOOK_MAX_RUPEES) and wallet short: refused before the assign call", async () => {
    const h = harness({ env: { SR_BOOK_MAX_RUPEES: "120" } });
    const { shipmentId } = seed(h);
    const cap = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([cap.status, cap.body.error, cap.body.cap], [409, "over_cap", 120]);
    const w = harness();
    w.mocks.state.shiprocket.wallet = "100.00";
    const s2 = seed(w);
    const short = await w.admin("POST", "/admin/sr/book", bookBody(s2.shipmentId));
    assert.deepEqual([short.status, short.body.error, short.body.balanceRupees], [402, "wallet_short", 100]);
    const def = harness();
    const s3 = seed(def);
    def.mocks.state.shiprocket.couriers.find((c) => c.courier_company_id === 54).rate = 520;
    const big = await def.admin("POST", "/admin/sr/book", bookBody(s3.shipmentId, { maxRupees: 600 }));
    assert.deepEqual([big.status, big.body.error, big.body.cap], [409, "over_cap", 500], "default cap Rs 500");
    assert.equal(assignCalls(h).length + assignCalls(w).length + assignCalls(def).length, 0);
  });

  test("two bookings at once: exactly one reaches the assign endpoint", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    const [a, b] = await Promise.all([h.admin("POST", "/admin/sr/book", bookBody(shipmentId)), h.admin("POST", "/admin/sr/book", bookBody(shipmentId))]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    assert.equal(assignCalls(h).length, 1);
  });

  test("assign answers without an AWB (status 0, or 500): 502, lock released, a later call can book", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    h.mocks.state.shiprocket.assign = [{ awb_assign_status: 0, response: { data: { awb_assign_error: "Insufficient balance" } } }, 500];
    const r1 = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([r1.status, r1.body.error, r1.body.srMessage], [502, "awb_not_assigned", "Insufficient balance"]);
    const r2 = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([r2.status, r2.body.error, r2.body.http], [502, "awb_not_assigned", 500]);
    assert.equal(callsTo(h, "/courier/generate/pickup").length, 0);
    const r3 = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(r3.status, 200);
    assert.equal(assignCalls(h).length, 3, "one call per request, never retried inside a request");
  });

  test("assign times out: 504 awb_unknown and the lock is KEPT; unlock frees it only while there is no AWB", async () => {
    const h = harness({ env: { SHIPROCKET_TIMEOUT_MS: "30" } });
    const { shipmentId } = seed(h);
    h.mocks.state.shiprocket.assign = ["timeout"];
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([r.status, r.body.error], [504, "awb_unknown"]);
    assert.match(r.body.hint, /track --shipment/);
    const again = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([again.status, again.body.error], [409, "already_booking_or_booked"]);
    assert.equal(assignCalls(h).length, 1);
    assert.equal((await h.admin("POST", "/admin/sr/unlock", { shipmentId })).body.error, "confirm_required");
    const un = await h.admin("POST", "/admin/sr/unlock", { shipmentId, confirm: `unlock ${shipmentId}` });
    assert.equal(un.status, 200, JSON.stringify(un.body));
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).status, 200);
    assert.equal((await h.admin("POST", "/admin/sr/unlock", { shipmentId, confirm: `unlock ${shipmentId}` })).body.error, "already_booked");
  });

  test("assign timed out but Shiprocket DID book: unlock refuses (AWB exists), so no second booking", async () => {
    const h = harness({ env: { SHIPROCKET_TIMEOUT_MS: "30" } });
    const { shipmentId } = seed(h);
    h.mocks.state.shiprocket.assign = ["timeout_booked"];
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).body.error, "awb_unknown");
    const un = await h.admin("POST", "/admin/sr/unlock", { shipmentId, confirm: `unlock ${shipmentId}` });
    assert.deepEqual([un.status, un.body.error], [409, "already_booked"]);
    assert.match(un.body.awb, /^7D/);
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).status, 409);
    assert.equal(assignCalls(h).length, 1);
    const t = await h.admin("GET", `/admin/sr/track?shipment=${shipmentId}`);
    assert.equal(t.status, 200);
    assert.equal(t.body.noActivity, true);
  });

  test("if Shiprocket ever books Delhivery anyway: error, URGENT alert, no pickup or label", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    h.mocks.state.shiprocket.assign = [{ awb_assign_status: 1, response: { data: { awb_code: "1490810000011", courier_company_id: 10, courier_name: "Delhivery Surface", shipment_id: Number(shipmentId) } } }];
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([r.status, r.body.error, r.body.awb], [502, "booked_banned_courier", "1490810000011"]);
    assert.equal(callsTo(h, "/courier/generate/pickup").length + callsTo(h, "/courier/generate/label").length, 0);
    await h.drain();
    assert.ok(h.mocks.state.resend.sent.some((m) => /URGENT/.test(m.subject)));
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).status, 409, "lock kept");
  });

  test("Shiprocket books another allowed-looking courier id, a Delhivery child courier, or an off-list courier: 502, URGENT, no pickup or label, lock kept", async () => {
    const cases = [
      [{ awb_code: "7D1", courier_company_id: 55, courier_name: "DTDC Air 500gm" }, "booked_other_courier"],
      [{ awb_code: "7D2", courier_company_id: 54, courier_name: "DTDC Surface", child_courier_name: "Delhivery Surface" }, "booked_banned_courier"],
      [{ awb_code: "7D3", courier_company_id: 54, courier_name: "Xpressbees Surface" }, "booked_other_courier"],
    ];
    for (const [data, error] of cases) {
      const h = harness();
      const { shipmentId } = seed(h);
      h.mocks.state.shiprocket.assign = [{ awb_assign_status: 1, response: { data: { ...data, shipment_id: Number(shipmentId) } } }];
      const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
      assert.deepEqual([r.status, r.body.error, r.body.awb], [502, error, data.awb_code], JSON.stringify(data));
      assert.equal(callsTo(h, "/courier/generate/pickup").length + callsTo(h, "/courier/generate/label").length, 0);
      await h.drain();
      assert.ok(h.mocks.state.resend.sent.some((m) => /(^|\] )URGENT:/.test(m.subject)), "URGENT alert");
      assert.ok(!h.mocks.state.resend.sent.some((m) => /(^|\] )(CHECK )?Booked/.test(m.subject)), "no normal booked alert");
      assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).body.error, "already_booking_or_booked", "lock kept");
      assert.equal(assignCalls(h).length, 1);
    }
    // an empty courier_name in the reply falls back to the courier we asked for (not a false alarm)
    const h = harness();
    const { shipmentId } = seed(h);
    h.mocks.state.shiprocket.assign = [{ awb_assign_status: 1, response: { data: { awb_code: "7D4", courier_company_id: 54, courier_name: "", shipment_id: Number(shipmentId) } } }];
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.deepEqual([r.status, r.body.courier], [200, "DTDC Surface"]);
  });

  test("what the wallet lost above maxRupees / the cap is flagged (GST may not be in the quote); the booking stands", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    // the wallet drops by Rs 159.09 (134.82 + 18 % GST) once the AWB is assigned
    Object.defineProperty(h.mocks.state.shiprocket, "wallet", { get: () => (assignCalls(h).length ? "11062.36" : "11221.45") });
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.rate, r.body.chargedRupees, r.body.chargedOverMax], [134.82, 159.09, true]);
    await h.drain();
    const mail = h.mocks.state.resend.sent.find((m) => m.subject.includes("Booked"));
    assert.match(mail.subject, /(^|\] )CHECK Booked/);
    assert.match(mail.text, /CHARGED Rs 159\.09 > max Rs 145/);
    assert.ok(h.logs.some((l) => l.includes('"evt":"admin_sr"') && l.includes("charged_over_max")));
    // charged within max: not flagged
    const ok = harness();
    const s2 = seed(ok);
    Object.defineProperty(ok.mocks.state.shiprocket, "wallet", { get: () => (assignCalls(ok).length ? "11086.63" : "11221.45") });
    const r2 = await ok.admin("POST", "/admin/sr/book", bookBody(s2.shipmentId));
    assert.deepEqual([r2.body.chargedRupees, r2.body.chargedOverMax], [134.82, undefined]);
  });

  test("the srbooked record failing to write after the AWB never hides the AWB", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    const kvSet = h.store.kvSet.bind(h.store);
    h.store.kvSet = async (k, v, e) => { if (k.startsWith("srbooked:")) throw new Error("D1 down"); return kvSet(k, v, e); };
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.match(r.body.awb, /^7D/);
    assert.equal(r.body.recorded, false);
    assert.equal(r.body.pickup.ok, true);
    assert.ok(r.body.labelUrl);
    await h.drain();
    assert.ok(h.mocks.state.resend.sent.some((m) => m.subject.includes("Booked") && /could not be written/.test(m.text)));
    assert.equal((await h.admin("POST", "/admin/sr/book", bookBody(shipmentId))).status, 409, "lock still holds");
  });

  test("the money part of a booking runs under ctx.waitUntil (a client disconnect cannot cut off pickup, label, alert)", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    const before = h.ctx.pendingCount();
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(r.status, 200);
    assert.ok(h.ctx.pendingCount() >= before + 2, "the spend promise and the alert were handed to waitUntil");
    // a refusal before the AWB call registers nothing
    const h2 = harness();
    const s2 = seed(h2);
    await h2.admin("POST", "/admin/sr/book", bookBody(s2.shipmentId, { maxRupees: 100 }));
    assert.equal(h2.ctx.pendingCount(), 0);
  });

  test("pickup and label refuse an AWB on Delhivery, an off-list or an unknown courier (an AWB from the panel or a fallback)", async () => {
    const h = harness();
    for (const [courier, reason] of [["Delhivery Surface", "delhivery_never"], ["Ekart Logistics Surface", "not_on_allow_list"], [null, "courier_unknown"]]) {
      const { shipmentId } = seed(h, { awb: `AWB${String(Math.random()).slice(2, 10)}`, courier });
      for (const [path, body] of [["/admin/sr/pickup", { shipmentId }], ["/admin/sr/label", { shipmentId }]]) {
        const r = await h.admin("POST", path, body);
        assert.deepEqual([r.status, r.body.error, r.body.reason], [403, "courier_not_allowed", reason], `${path} ${courier}`);
      }
    }
    assert.equal(callsTo(h, "/courier/generate/pickup").length + callsTo(h, "/courier/generate/label").length, 0);
    // the shipment read leaves the courier out, but our own booking record has it: allowed
    const { shipmentId } = seed(h, { awb: "7D199999999", courier: null });
    await h.store.kvSet(`srbooked:${shipmentId}`, JSON.stringify({ awb: "7D199999999", courierId: 54, courier: "DTDC Surface" }), null);
    assert.equal((await h.admin("POST", "/admin/sr/label", { shipmentId })).status, 200);
  });

  test("pickup or label failing after the AWB never undoes the booking", async () => {
    const h = harness();
    const { shipmentId } = seed(h);
    h.mocks.state.shiprocket.pickup = [500];
    h.mocks.state.shiprocket.label = [503];
    const r = await h.admin("POST", "/admin/sr/book", bookBody(shipmentId, { manifest: true }));
    assert.equal(r.status, 200);
    assert.ok(r.body.awb);
    assert.deepEqual([r.body.pickup.ok, r.body.pickup.reason], [false, "pickup_not_scheduled"]);
    assert.equal(r.body.labelUrl, null);
    assert.equal(r.body.labelError, "label_not_created");
    assert.equal(callsTo(h, "/manifests/generate").length, 0, "no manifest without a pickup");
    const p = await h.admin("POST", "/admin/sr/pickup", { shipmentId, retry: true });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    assert.equal(callsTo(h, "/courier/generate/pickup")[1].body.status, "retry");
    const l = await h.admin("POST", "/admin/sr/label", { shipmentId });
    assert.equal(l.status, 200);
    assert.match(l.body.labelUrl, /label_/);
  });

  test("create then book end to end, on a shipment the worker created", async () => {
    const h = harness();
    const c = await h.admin("POST", "/admin/sr/create", AMAZON_ORDER);
    const q = await h.admin("POST", "/admin/sr/quote", { shipmentId: c.body.srShipmentId });
    assert.equal(q.body.cheapest.courier, "DTDC Surface");
    const r = await h.admin("POST", "/admin/sr/book", {
      shipmentId: c.body.srShipmentId, courierId: q.body.cheapest.courierId, maxRupees: q.body.cheapest.rate + 10,
      said: `ship ${AMAZON_ORDER.orderId}`, confirm: `ship ${c.body.srShipmentId}`, pickup: "today",
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const f = await h.admin("GET", `/admin/sr/find?ref=${AMAZON_ORDER.orderId}`);
    assert.deepEqual(f.body.matches.map((m) => [m.shipmentId, m.awb]), [[c.body.srShipmentId, r.body.awb]]);
  });
});

describe("cancel, track, pickups, find", () => {
  test("cancel: typed confirm; custom channel only; never once an AWB exists; by Shiprocket id or by our ref", async () => {
    const h = harness();
    const a = seed(h);
    assert.equal((await h.admin("POST", "/admin/sr/cancel", { srOrderId: a.srOrderId })).body.error, "confirm_required");
    assert.equal((await h.admin("POST", "/admin/sr/cancel", { srOrderId: a.srOrderId, confirm: "cancel 1" })).body.error, "confirm_required");
    const ok = await h.admin("POST", "/admin/sr/cancel", { srOrderId: a.srOrderId, confirm: `cancel ${a.srOrderId}` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([ok.body.cancelled, ok.body.ref], [a.srOrderId, AMAZON_ID]);
    assert.deepEqual(h.mocks.state.shiprocket.cancelled, [a.srOrderId]);
    assert.equal((await h.admin("POST", "/admin/sr/cancel", { srOrderId: a.srOrderId, confirm: `cancel ${a.srOrderId}` })).body.error, "already_cancelled");
    const booked = seed(h, { channelOrderId: "403-1111111-2222222", awb: "7D100000009" });
    const r = await h.admin("POST", "/admin/sr/cancel", { srOrderId: booked.srOrderId, confirm: `cancel ${booked.srOrderId}` });
    assert.deepEqual([r.status, r.body.error, r.body.awb], [409, "awb_assigned", "7D100000009"]);
    const az = seed(h, { channelOrderId: "404-1111111-2222222", baseChannel: "AZ" });
    assert.equal((await h.admin("POST", "/admin/sr/cancel", { srOrderId: az.srOrderId, confirm: `cancel ${az.srOrderId}` })).body.error, "not_custom_channel");
    const byRef = seed(h, { channelOrderId: "405-1111111-2222222" });
    const rr = await h.admin("POST", "/admin/sr/cancel", { ref: "405-1111111-2222222", confirm: "cancel 405-1111111-2222222" });
    assert.equal(rr.status, 200, JSON.stringify(rr.body));
    assert.equal(rr.body.cancelled, byRef.srOrderId);
    assert.equal(h.mocks.state.shiprocket.cancelled.length, 2);
    // a second guard that does not depend on the AWB field name: only a NEW order
    const rts = seed(h, { channelOrderId: "407-1111111-2222222", status: "READY TO SHIP" });
    const n = await h.admin("POST", "/admin/sr/cancel", { srOrderId: rts.srOrderId, confirm: `cancel ${rts.srOrderId}` });
    assert.deepEqual([n.status, n.body.error, n.body.status], [409, "not_new", "READY TO SHIP"]);
    // the AWB under a key we do not read: still refused, by the status
    const hidden = seed(h, { channelOrderId: "408-1111111-2222222", status: "PICKUP SCHEDULED" });
    assert.equal((await h.admin("POST", "/admin/sr/cancel", { srOrderId: hidden.srOrderId, confirm: `cancel ${hidden.srOrderId}` })).body.error, "not_new");
    assert.equal(h.mocks.state.shiprocket.cancelled.length, 2);
  });

  test("cancel by ref: a search row without an order id is never cancelled (no ids: [0])", async () => {
    const h = harness();
    const { srOrderId } = seed(h, { channelOrderId: "409-1111111-2222222" });
    h.mocks.state.shiprocket.orders.get(srOrderId).id = undefined; // the list row (and orders/show) come back without an id
    const r = await h.admin("POST", "/admin/sr/cancel", { ref: "409-1111111-2222222", confirm: "cancel 409-1111111-2222222" });
    assert.deepEqual([r.status, r.body.error], [502, "search_without_order_id"]);
    assert.equal(srCalls(h).filter((c) => c.path.startsWith(`${SR}/orders/show/`)).length + callsTo(h, "/orders/cancel").length, 0);
  });

  test("track: picked up or not, courier-agent phones removed, by AWB / shipment / our ref", async () => {
    const h = harness();
    const { shipmentId } = seed(h, { awb: "7D141319206", courier: "DTDC Surface" });
    assert.deepEqual((await h.admin("GET", "/admin/sr/track?awb=7D141319206")).body, { ok: true, noActivity: true, message: "Aahh! There is no activities found in our DB. Please have some patience it will be updated soon." });
    // Shiprocket status codes: 19 out for pickup, 3 pickup scheduled (here), 42 picked up, 18 in transit, 15 pickup rescheduled, 20 pickup exception
    const CODE = { "OUT FOR PICKUP": 19, "PICKUP SCHEDULED": 3, "PICKED UP": 42, "IN TRANSIT": 18, "PICKUP RESCHEDULED": 15, "PICKUP EXCEPTION": 20 };
    const td = (labels, activities = labels.map((l) => `${l} - agent 98480 12345 / +919848012345`), courier = "DTDC Surface") => ({
      track_status: 1, shipment_status: CODE[labels[0]], track_url: "https://shiprocket.co/tracking/7D141319206", etd: "2026-11-15 18:00:00",
      shipment_track: [{ awb_code: "7D141319206", courier_name: courier, current_status: labels[0], pickup_date: null, delivered_date: null, edd: null }],
      shipment_track_activities: labels.map((l, i) => ({ date: `2026-11-1${3 - i} 10:00:00`, status: "X", activity: activities[i], location: "NARASARAOPET", "sr-status": String(CODE[l]), "sr-status-label": l })),
    });
    h.mocks.state.shiprocket.tracking.set("7D141319206", td(["OUT FOR PICKUP", "PICKUP SCHEDULED"]));
    let t = await h.admin("GET", "/admin/sr/track?awb=7D141319206");
    assert.equal(t.status, 200);
    assert.equal(t.body.pickedUp, false);
    assert.equal(t.body.activities.length, 2);
    h.mocks.state.shiprocket.tracking.set("7D141319206", td(["IN TRANSIT", "PICKED UP", "OUT FOR PICKUP"]));
    t = await h.admin("GET", `/admin/sr/track?shipment=${shipmentId}`);
    assert.equal(t.body.pickedUp, true);
    assert.deepEqual([t.body.awb, t.body.courier, t.body.currentStatus, t.body.shipmentStatus], ["7D141319206", "DTDC Surface", "IN TRANSIT", 18]);
    const text = JSON.stringify(t.body);
    assert.ok(!text.includes("9848012345") && !text.includes("98480 12345"), "agent phones scrubbed");
    assert.match(t.body.activities[0].activity, /\[phone\]/);
    assert.equal(t.body.courierAllowed, true);
    t = await h.admin("GET", `/admin/sr/track?ref=${AMAZON_ID}`);
    assert.equal(t.body.pickedUp, true);
    // the courier's free text never counts as a pickup: these must stay "not picked up"
    const missed = ["Shipment not picked up - seller not available", "Pickup Rescheduled: will be picked up tomorrow", "Pickup executive reached seller location, shipment not ready"];
    h.mocks.state.shiprocket.tracking.set("7D141319206", td(["PICKUP EXCEPTION", "PICKUP RESCHEDULED", "OUT FOR PICKUP"], missed));
    t = await h.admin("GET", "/admin/sr/track?awb=7D141319206");
    assert.equal(t.body.pickedUp, false, "missed-pickup texts are not pickups");
    // a fallback reassignment to Delhivery shows up
    h.mocks.state.shiprocket.tracking.set("7D141319206", td(["IN TRANSIT"], undefined, "Delhivery Surface"));
    t = await h.admin("GET", "/admin/sr/track?awb=7D141319206");
    assert.deepEqual([t.body.pickedUp, t.body.courierAllowed], [true, false]);
    assert.equal((await h.admin("GET", "/admin/sr/track?awb=bad!")).status, 400);
    assert.equal((await h.admin("GET", "/admin/sr/track?awb=7D141319206&shipment=1")).status, 400);
    assert.equal((await h.admin("GET", "/admin/sr/track")).status, 400);
  });

  test("pickups: 'home' with PIN 522601 found; no address, phone, e-mail or contact name returned", async () => {
    const h = harness();
    const r = await h.admin("GET", "/admin/sr/pickups");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.home, { nickname: "home", expectedPin: "522601", found: true, pin: "522601", ok: true });
    assert.equal(r.body.locations.length, 2);
    const text = JSON.stringify(r.body);
    for (const needle of ["9000000001", "owner@example.test", "Flat 202", "Owner Name", "Mock Farm Road"]) assert.ok(!text.includes(needle), needle);
    h.mocks.state.shiprocket.pickups[0].pin_code = "522002";
    assert.equal((await h.admin("GET", "/admin/sr/pickups")).body.home.ok, false);
  });

  test("wallet: low below Rs 300, negative balances parse", async () => {
    const h = harness();
    h.mocks.state.shiprocket.wallet = "250.50";
    assert.deepEqual((await h.admin("GET", "/admin/sr/wallet")).body, { ok: true, balanceRupees: 250.5, low: true });
    h.mocks.state.shiprocket.wallet = "-291539.83";
    assert.equal((await h.admin("GET", "/admin/sr/wallet")).body.balanceRupees, -291539.83);
    h.mocks.state.shiprocket.wallet = "n/a";
    assert.equal((await h.admin("GET", "/admin/sr/wallet")).body.error, "wallet_unreadable");
  });
});

describe("Shiprocket token, errors and timeouts", () => {
  test("a stale cached token -> one re-login (shared with the order push), then the cached token is reused", async () => {
    const h = harness();
    await h.store.kvSet("shiprocket_token", "stale-token", h.now() + 1e9);
    assert.equal((await h.admin("GET", "/admin/sr/wallet")).status, 200);
    assert.equal(h.mocks.state.shiprocket.logins, 1);
    assert.equal(await h.store.kvGet("shiprocket_token", h.now()), "mock-token-1");
    assert.equal((await h.admin("POST", "/admin/sr/quote", { pin: "490023" })).status, 200);
    assert.equal(h.mocks.state.shiprocket.logins, 1, "no new login");
    // the website order push still works on the same token
    const r = await h.createOrder();
    const gw = r.body.razorpay.orderId;
    const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise));
    await h.drain();
    assert.equal((await h.store.getOrder(r.body.orderId)).shipStatus, "pushed");
    assert.equal(h.mocks.state.shiprocket.logins, 1);
  });

  test("login refused / API user not configured / 403 module / 5xx / timeouts map to clear errors", async () => {
    const h = harness();
    h.mocks.state.shiprocket.loginStatus = 403;
    let r = await h.admin("GET", "/admin/sr/wallet");
    assert.deepEqual([r.status, r.body.error, r.body.reason], [502, "shiprocket_unavailable", "login_failed"]);
    const nc = harness({ env: { SHIPROCKET_API_PASSWORD: undefined } });
    r = await nc.admin("GET", "/admin/sr/wallet");
    assert.deepEqual([r.status, r.body.error], [503, "shiprocket_not_configured"]);
    const m = harness();
    m.mocks.state.shiprocket.override = (method, path) => (path.endsWith("wallet-balance") ? 403 : path.endsWith("/settings/company/pickup") ? 503 : null);
    r = await m.admin("GET", "/admin/sr/wallet");
    assert.deepEqual([r.status, r.body.error], [502, "shiprocket_forbidden"]);
    r = await m.admin("GET", "/admin/sr/pickups");
    assert.deepEqual([r.status, r.body.error, r.body.http], [502, "shiprocket_error", 503]);
    const t = harness({ env: { SHIPROCKET_TIMEOUT_MS: "30" } });
    t.mocks.state.shiprocket.serviceability = "timeout";
    r = await t.admin("POST", "/admin/sr/quote", { pin: "490023" });
    assert.deepEqual([r.status, r.body.error, r.body.reason], [504, "shiprocket_unavailable", "timeout"]);
    // a timeout while re-quoting inside a booking: nothing booked, lock released
    const { shipmentId } = seed(t);
    r = await t.admin("POST", "/admin/sr/book", bookBody(shipmentId));
    assert.equal(r.status, 504);
    assert.equal(assignCalls(t).length, 0);
    t.mocks.state.shiprocket.serviceability = "ok";
    assert.equal((await t.admin("POST", "/admin/sr/book", bookBody(shipmentId))).status, 200);
  });
});

test("no secret or buyer data in any admin reply or log line; one log line per admin call", async () => {
  const h = harness();
  await h.admin("GET", "/admin/sr/wallet", undefined, { token: "wrong" });
  await h.admin("GET", "/admin/sr/pickups");
  await h.admin("POST", "/admin/sr/quote", { pin: "490023", packs: 1 });
  const c = await h.admin("POST", "/admin/sr/create", AMAZON_ORDER);
  const b = await h.admin("POST", "/admin/sr/book", { ...bookBody(c.body.srShipmentId), said: `ship ${AMAZON_ORDER.orderId}` });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  await h.admin("GET", `/admin/sr/track?awb=${b.body.awb}`);
  await h.admin("GET", `/admin/sr/find?ref=${AMAZON_ORDER.orderId}`);
  await h.admin("POST", "/admin/sr/book", bookBody(c.body.srShipmentId, { courierId: 10 }));
  await h.drain();
  const replies = [];
  for (const [m, p, body] of [["GET", "/admin/sr/wallet"], ["GET", "/admin/sr/pickups"], ["POST", "/admin/sr/quote", { shipmentId: c.body.srShipmentId }],
    ["POST", "/admin/sr/create", AMAZON_ORDER], ["GET", `/admin/sr/find?ref=${AMAZON_ORDER.orderId}`]]) {
    replies.push(JSON.stringify((await h.admin(m, p, body)).body));
  }
  replies.push(JSON.stringify(b.body), JSON.stringify(c.body));
  const all = [...h.logs, ...replies].join("\n");
  for (const needle of [...SECRET_VALUES, TEST_ENV.ADMIN_TOKEN, TEST_ENV.SHIPROCKET_API_EMAIL, "mock-token-1", "9848012345", "98480", "Temple Street", "Ravi"]) {
    assert.ok(!all.includes(needle), `leaked ${needle}`);
  }
  const lines = h.logs.map((l) => JSON.parse(l)).filter((l) => l.evt === "admin_sr");
  assert.equal(lines.length, 13);
  for (const l of lines) assert.deepEqual(Object.keys(l).filter((k) => !["evt", "route", "status", "http", "reason", "count", "ms"].includes(k)), []);
});

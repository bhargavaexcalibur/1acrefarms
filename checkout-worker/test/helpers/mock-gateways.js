// A fake internet for tests and the smoke run: Razorpay, Cashfree (sandbox), PhonePe (UAT + production hosts),
// Shiprocket, Resend, Turnstile.
// Behaviour is steered through `state`; every request is recorded in `calls`.

const reply = (status, data, headers = {}) =>
  new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

// Never answers; rejects when the caller aborts (that is what a real hung socket looks like to fetch).
const hang = (signal) => new Promise((_, reject) => {
  if (signal) signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
});

export function createMockGateways() {
  const calls = [];
  const state = {
    razorpay: { create: "ok", orders: new Map(), payments: new Map(), n: 0 },
    cashfree: { create: "ok", orders: new Map(), n: 0 },
    // PhonePe: create / status = "ok" | "timeout" | "network" | <http status>; token = "ok" | <http status> | "timeout".
    // nowMs: the clock used for issued_at / expires_at (the harness points it at its own clock).
    phonepe: {
      create: "ok", status: "ok", token: "ok", tokenTtlSec: 3600, tokens: [], revoked: new Set(), orders: new Map(), n: 0,
      nowMs: () => Date.now(),
    },
    // queue of outcomes for successive adhoc creates: "ok" | "timeout" | <http status>; empty = "ok"
    shiprocket: {
      queue: [], created: new Map(), logins: 0, n: 0, gate: null, loginStatus: 200,
      // ---- admin API (src/admin.js) ----
      // couriers offered by serviceability; recommended deliberately points at Delhivery (never to be used)
      couriers: defaultCouriers(), blockedCouriers: [], recommended: 10,
      serviceability: "ok", // "ok" | "unserviceable" | "timeout" | <http status>
      orders: new Map(), // Shiprocket order id (string) -> GET /orders/show/{id} data
      shipments: new Map(), // shipment id (string) -> GET /shipments/{id} data
      // successive POST /courier/assign/awb outcomes: "ok" | "timeout" | "timeout_booked" | "network" | <http status> | {raw 200 body}
      assign: [], awbN: 0,
      pickup: [], label: [], // "ok" | <http status> | "timeout"
      labelBase: "https://kr-shipmultichannel-mum.s3.ap-south-1.amazonaws.com/mock",
      wallet: "11221.45",
      pickups: defaultPickups(),
      tracking: new Map(), // awb -> tracking_data
      cancelled: [],
      // (method, path) => "timeout" | <http status> | null: forces an answer on any admin endpoint
      override: null,
    },
    // fail: optional (body) => <http status> | "network" | null, to make Resend refuse some mails; failed mails are not in `sent`
    resend: { sent: [], failed: [], fail: null },
    turnstile: { success: true },
  };

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    const bodyText = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    const body = bodyText && headers.get("content-type")?.includes("json") ? JSON.parse(bodyText) : null;
    calls.push({ host: url.host, path: url.pathname, method, body, query: Object.fromEntries(url.searchParams) });

    // ---------------- Razorpay ----------------
    if (url.host === "api.razorpay.com") {
      if (!headers.get("authorization")?.startsWith("Basic ")) return reply(401, { error: { code: "BAD_REQUEST_ERROR" } });
      const rz = state.razorpay;
      if (method === "POST" && url.pathname === "/v1/orders") {
        const mode = typeof rz.create === "function" ? rz.create() : rz.create;
        if (mode === "timeout") return hang(init.signal);
        if (mode === "network") throw new TypeError("fetch failed");
        if (typeof mode === "number") return reply(mode, { error: { code: "SERVER_ERROR", description: "mock" } });
        const id = `order_MOCK${String(++rz.n).padStart(6, "0")}`;
        const o = { id, entity: "order", amount: body.amount, amount_paid: 0, currency: body.currency, receipt: body.receipt, status: "created", notes: body.notes };
        rz.orders.set(id, o);
        return reply(200, o);
      }
      const m = url.pathname.match(/^\/v1\/orders\/([^/]+)\/payments$/);
      if (method === "GET" && m) {
        const items = rz.payments.get(decodeURIComponent(m[1])) || [];
        return reply(200, { entity: "collection", count: items.length, items });
      }
      return reply(404, { error: { code: "NOT_FOUND" } });
    }

    // ---------------- Cashfree (sandbox or prod host) ----------------
    if (url.host === "sandbox.cashfree.com" || url.host === "api.cashfree.com") {
      if (!headers.get("x-client-id") || !headers.get("x-client-secret") || !headers.get("x-api-version")) return reply(401, { message: "auth" });
      const cf = state.cashfree;
      if (method === "POST" && url.pathname === "/pg/orders") {
        const mode = cf.create;
        if (mode === "timeout") return hang(init.signal);
        if (mode === "network") throw new TypeError("fetch failed");
        if (typeof mode === "number") return reply(mode, { message: "mock" });
        if (cf.orders.has(body.order_id)) return reply(409, { message: "order_id already exists" });
        const o = { cf_order_id: 5000 + ++cf.n, order_id: body.order_id, order_amount: body.order_amount, order_currency: "INR", order_status: "ACTIVE", payment_session_id: `session_mock_${body.order_id}`, customer_details: body.customer_details, host: url.host };
        cf.orders.set(body.order_id, o);
        return reply(200, o);
      }
      const m = url.pathname.match(/^\/pg\/orders\/([^/]+)$/);
      if (method === "GET" && m) {
        const o = cf.orders.get(decodeURIComponent(m[1]));
        return o ? reply(200, o) : reply(404, { message: "order not found" });
      }
      return reply(404, { message: "not found" });
    }

    // ---------------- PhonePe PG (UAT: api-preprod.phonepe.com/apis/pg-sandbox; prod: api.phonepe.com/apis/pg + /identity-manager) ----------------
    if (url.host === "api-preprod.phonepe.com" || url.host === "api.phonepe.com") {
      const pp = state.phonepe;
      const uat = url.host === "api-preprod.phonepe.com";
      const pg = uat ? "/apis/pg-sandbox" : "/apis/pg";
      const auth = uat ? "/apis/pg-sandbox" : "/apis/identity-manager";
      const fail = (mode) => {
        if (mode === "timeout") return hang(init.signal);
        if (mode === "network") throw new TypeError("fetch failed");
        if (typeof mode === "number") return reply(mode, { code: mode >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST", message: "mock" });
        return null;
      };
      if (method === "POST" && url.pathname === `${auth}/v1/oauth/token`) {
        const failed = fail(pp.token);
        if (failed) return failed;
        const form = new URLSearchParams(bodyText);
        if (!headers.get("content-type")?.includes("application/x-www-form-urlencoded") || form.get("grant_type") !== "client_credentials" ||
          !form.get("client_id") || !form.get("client_secret") || !form.get("client_version")) {
          return reply(400, { code: "BAD_REQUEST", message: "mock: bad token request" });
        }
        const issued = Math.floor(pp.nowMs() / 1000);
        const tok = `pp-mock-token-${pp.tokens.length + 1}`;
        pp.tokens.push({ token: tok, form: Object.fromEntries(form), host: url.host });
        return reply(200, { access_token: tok, encrypted_access_token: tok, expires_in: null, issued_at: issued, expires_at: issued + pp.tokenTtlSec, session_expires_at: issued + pp.tokenTtlSec, token_type: "O-Bearer" });
      }
      const authz = headers.get("authorization") || "";
      const tokenOk = authz.startsWith("O-Bearer pp-mock-token-") && !pp.revoked.has(authz.slice("O-Bearer ".length));
      if (method === "POST" && url.pathname === `${pg}/checkout/v2/pay`) {
        if (!tokenOk) return reply(401, { code: "UNAUTHORIZED", message: "mock: token" });
        const failed = fail(pp.create);
        if (failed) return failed;
        const redirect = body?.paymentFlow?.merchantUrls?.redirectUrl;
        if (!body || typeof body.merchantOrderId !== "string" || body.merchantOrderId.length > 63 || !/^[A-Za-z0-9_-]+$/.test(body.merchantOrderId) ||
          !Number.isInteger(body.amount) || body.amount < 100 || body.paymentFlow?.type !== "PG_CHECKOUT" || typeof redirect !== "string") {
          return reply(400, { code: "BAD_REQUEST", message: "mock: bad pay request" });
        }
        if (pp.orders.has(body.merchantOrderId)) return reply(400, { code: "BAD_REQUEST", message: "Please check the inputs you have provided." });
        const n = ++pp.n;
        const o = { orderId: `OMO26111${String(n).padStart(6, "0")}`, merchantOrderId: body.merchantOrderId, state: "PENDING", amount: body.amount, expireAt: pp.nowMs() + 1000 * (body.expireAfter || 1200), paymentDetails: [], redirectUrl: redirect, host: url.host, request: body };
        pp.orders.set(body.merchantOrderId, o);
        const page = uat ? "https://mercury-uat.phonepe.com/transact/uat_v2" : "https://mercury-t2.phonepe.com/transact/pg";
        return reply(200, { orderId: o.orderId, state: "PENDING", expireAt: o.expireAt, redirectUrl: `${page}?token=mock${n}` });
      }
      const m = url.pathname.match(new RegExp(`^${pg}/checkout/v2/order/([^/]+)/status$`));
      if (method === "GET" && m) {
        if (!tokenOk) return reply(401, { code: "UNAUTHORIZED", message: "mock: token" });
        const failed = fail(pp.status);
        if (failed) return failed;
        const o = pp.orders.get(decodeURIComponent(m[1]));
        if (!o) return reply(400, { code: "BAD_REQUEST", message: "mock: order not found" });
        return reply(200, { orderId: o.orderId, state: o.state, amount: o.amount, expireAt: o.expireAt, metaInfo: {}, paymentDetails: o.paymentDetails });
      }
      return reply(404, { code: "NOT_FOUND" });
    }

    // ---------------- Shiprocket ----------------
    if (url.host === "apiv2.shiprocket.in") {
      const sr = state.shiprocket;
      if (method === "POST" && url.pathname === "/v1/external/auth/login") {
        sr.logins++;
        if (sr.loginStatus !== 200) return reply(sr.loginStatus, { message: "login failed" });
        return reply(200, { token: `mock-token-${sr.logins}` });
      }
      if (method === "POST" && url.pathname === "/v1/external/orders/create/adhoc") {
        if (!headers.get("authorization")?.startsWith("Bearer mock-token-")) return reply(401, { message: "Token has expired" });
        if (sr.gate) await sr.gate;
        const next = sr.queue.length ? sr.queue.shift() : "ok";
        if (next === "timeout") return hang(init.signal);
        if (typeof next === "number") return reply(next, { message: `mock ${next}` }, next === 429 ? { "retry-after": "1" } : {});
        if (sr.created.has(body.order_id)) return reply(422, { message: "Order Id already exists", status_code: 422 });
        const n = ++sr.n;
        sr.created.set(body.order_id, body);
        seedShiprocketOrder({
          srOrderId: 700000 + n, shipmentId: 800000 + n, channelOrderId: body.order_id, paymentMethod: String(body.payment_method).toLowerCase(),
          pickup: body.pickup_location, pin: body.billing_pincode, weight: body.weight,
        });
        return reply(200, { order_id: 700000 + n, shipment_id: 800000 + n, status: "NEW", status_code: 1, awb_code: null });
      }
      const admin = await shiprocketAdmin(sr, url, method, headers, body, init);
      if (admin) return admin;
      return reply(404, { message: "not found" });
    }

    // ---------------- Resend ----------------
    if (url.host === "api.resend.com" && url.pathname === "/emails") {
      if (!headers.get("authorization")?.startsWith("Bearer ")) return reply(401, { name: "missing_api_key" });
      const failWith = state.resend.fail ? state.resend.fail(body) : null;
      if (failWith === "network") { state.resend.failed.push(body); throw new TypeError("fetch failed"); }
      if (typeof failWith === "number") { state.resend.failed.push(body); return reply(failWith, { name: "mock_error" }); }
      state.resend.sent.push({ ...body, idempotencyKey: headers.get("idempotency-key") });
      return reply(200, { id: `email_${state.resend.sent.length}` });
    }

    // ---------------- Turnstile ----------------
    if (url.host === "challenges.cloudflare.com") {
      return reply(200, { success: state.turnstile.success });
    }

    throw new Error(`unmocked request: ${method} ${url.href}`);
  }

  // Simulate the customer paying at Razorpay (test mode): a captured payment on that order.
  function razorpayCapture(gwOrderId, amount, paymentId = `pay_MOCK${String(state.razorpay.n).padStart(6, "0")}`) {
    const list = state.razorpay.payments.get(gwOrderId) || [];
    list.push({ id: paymentId, entity: "payment", amount, currency: "INR", status: "captured", order_id: gwOrderId, method: "upi" });
    state.razorpay.payments.set(gwOrderId, list);
    const o = state.razorpay.orders.get(gwOrderId);
    if (o) Object.assign(o, { amount_paid: amount, status: "paid" });
    return paymentId;
  }

  function cashfreePay(orderId) {
    const o = state.cashfree.orders.get(orderId);
    if (o) o.order_status = "PAID";
    return o;
  }

  // Simulate the customer at PhonePe's PayPage. outcome "COMPLETED" | "FAILED"; amount defaults to the order amount.
  function phonepeFinish(merchantOrderId, outcome = "COMPLETED", { amount, transactionId } = {}) {
    const o = state.phonepe.orders.get(merchantOrderId);
    if (!o) return null;
    const paid = amount ?? o.amount;
    const tx = transactionId ?? `OM26111${String(state.phonepe.n).padStart(6, "0")}${o.paymentDetails.length + 1}`;
    o.paymentDetails.push({ paymentMode: "UPI_QR", transactionId: tx, timestamp: state.phonepe.nowMs(), amount: paid, state: outcome,
      ...(outcome === "FAILED" ? { errorCode: "TXN_AUTO_FAILED", detailedErrorCode: "ZM" } : {}) });
    o.state = outcome;
    if (outcome === "COMPLETED") o.amount = paid;
    return tx;
  }

  // A Shiprocket order + shipment as GET /orders/show and GET /shipments would return them (custom channel "CS").
  function seedShiprocketOrder({
    srOrderId, shipmentId, channelOrderId, paymentMethod = "prepaid", cod = 0, baseChannel = "CS", pickup = "home", pin = "490023", weight = 0.6, awb = null,
    courier = null, status = "NEW",
  } = {}) {
    const sr = state.shiprocket;
    const oid = srOrderId ?? 900000 + sr.orders.size + 1;
    const sid = shipmentId ?? 950000 + sr.shipments.size + 1;
    sr.orders.set(String(oid), {
      id: oid, channel_id: 12515972, channel_name: baseChannel === "CS" ? "CUSTOM" : "AMAZON", base_channel_code: baseChannel,
      channel_order_id: channelOrderId ?? `402-0000000-${String(oid).padStart(7, "0")}`, customer_name: "Mock Buyer", customer_phone: "9123456780",
      customer_address: "Flat 1, Mock Street, Mock Nagar", customer_pincode: pin, pickup_location: pickup, payment_method: paymentMethod, cod, total: 495,
      status, status_code: 1, shipments: { id: sid, awb, courier },
    });
    sr.shipments.set(String(sid), { id: sid, order_id: oid, awb, courier, sr_courier_id: null, weight: String(weight), status: 1, shipping_address: { name: "Mock Buyer", phone: "9123456780" } });
    return { srOrderId: String(oid), shipmentId: String(sid) };
  }

  return { fetch: fetchImpl, state, calls, razorpayCapture, cashfreePay, phonepeFinish, seedShiprocketOrder };
}

// ---------------- Shiprocket admin endpoints (shapes from apidocs.shiprocket.in, collection 8407119/SzYW1zB2) ----------------
function defaultCouriers() {
  const c = (id, name, rate, days, surface, extra = {}) => ({
    courier_company_id: id, courier_name: name, rate, freight_charge: Math.round(rate * 84.75) / 100, cod_charges: 0, coverage_charges: 0, other_charges: 0,
    estimated_delivery_days: String(days), etd: `Nov ${12 + days}, 2026`, etd_hours: days * 24, cutoff_time: "11:00", charge_weight: 0.6, min_weight: 0.5,
    is_surface: surface, mode: surface ? 0 : 1, blocked: 0, cod: 1, rating: 4.1, ...extra,
  });
  return [
    c(10, "Delhivery Surface", 96.5, 4, true),
    c(43, "Ekart Logistics Surface", 104, 5, true),
    c(54, "DTDC Surface", 134.82, 3, true),
    c(55, "DTDC Air 500gm", 164.42, 2, false),
    c(99, "Blue Dart Air", 185.76, 2, false),
    c(19, "India Post-Business Parcel Surface Prepaid", 134.82, 6, true, { charge_weight: 2 }),
    c(12, "Delhivery Air", 150.1, 2, false),
    c(33, "Xpressbees Surface", 120, 4, true),
  ];
}

function defaultPickups() {
  return [
    { id: 4411, pickup_location: "home", name: "Owner Name", email: "owner@example.test", phone: "9000000001", address: "Flat 202, Mock Apartments", address_2: "",
      city: "Narasaraopet", state: "Andhra Pradesh", country: "India", pin_code: "522601", status: 2, phone_verified: 1, is_primary_location: 1 },
    { id: 4412, pickup_location: "old-farm", name: "Owner Name", email: "owner@example.test", phone: "9000000001", address: "Mock Farm Road",
      city: "Guntur", state: "Andhra Pradesh", country: "India", pin_code: "522002", status: 1, phone_verified: 0, is_primary_location: 0 },
  ];
}

const NO_ACTIVITY = { track_status: 0, shipment_status: 0, shipment_track: [], shipment_track_activities: null, error: "Aahh! There is no activities found in our DB. Please have some patience it will be updated soon." };

async function shiprocketAdmin(sr, url, method, headers, body, init) {
  const P = "/v1/external";
  const path = url.pathname;
  const known = [
    "/courier/serviceability/", "/courier/assign/awb", "/courier/generate/pickup", "/courier/generate/label", "/manifests/generate",
    "/orders/cancel", "/settings/company/pickup", "/account/details/wallet-balance", "/orders", "/courier/track",
  ].map((x) => P + x);
  const isAdmin = known.includes(path) || /^\/v1\/external\/(orders\/show|shipments|courier\/track\/awb|courier\/track\/shipment)\/[^/]+$/.test(path);
  if (!isAdmin) return null;
  if (!headers.get("authorization")?.startsWith("Bearer mock-token-")) return reply(401, { message: "Token has expired" });
  const forced = sr.override ? sr.override(method, path) : null;
  if (forced === "timeout") return hang(init.signal);
  if (typeof forced === "number") return reply(forced, { message: `mock ${forced}` });
  const q = url.searchParams;
  const orderOf = (id) => sr.orders.get(String(id));
  const shipmentOf = (id) => sr.shipments.get(String(id));
  const trackingFor = (awb) => (awb && sr.tracking.get(awb)) || NO_ACTIVITY;

  if (method === "GET" && path === `${P}/courier/serviceability/`) {
    if (sr.serviceability === "timeout") return hang(init.signal);
    if (typeof sr.serviceability === "number") return reply(sr.serviceability, { message: "mock" });
    if (!q.get("pickup_postcode") || !q.get("delivery_postcode") && !q.get("order_id")) return reply(422, { message: "Oops! Invalid Data.", errors: { delivery_postcode: ["required"] } });
    if (q.get("order_id") && !orderOf(q.get("order_id"))) return reply(200, { status: 404, message: "Order does not exist!" });
    if (!q.get("order_id") && (!q.get("weight") || q.get("cod") === null)) return reply(422, { message: "Oops! Invalid Data.", errors: { weight: ["required"], cod: ["required"] } });
    if (sr.serviceability === "unserviceable") return reply(200, { status: 404, message: "Delivery postcode not serviceable" });
    return reply(200, {
      company_auto_shipment_insurance_setting: false, covid_zones: {}, currency: "INR", is_recommendation_enabled: 1, status: 200,
      data: {
        available_courier_companies: sr.couriers.map((c) => ({ ...c })), blocked_courier_companies: sr.blockedCouriers.map((c) => ({ ...c })),
        recommended_courier_company_id: sr.recommended, shiprocket_recommended_courier_id: sr.recommended,
        recommended_by: { id: 6, title: "Best in Class" },
      },
    });
  }
  if (method === "POST" && path === `${P}/courier/assign/awb`) {
    const next = sr.assign.length ? sr.assign.shift() : "ok";
    if (next === "timeout") return hang(init.signal);
    if (next === "network") throw new TypeError("fetch failed");
    if (typeof next === "number") return reply(next, { message: `mock ${next}` });
    if (next && typeof next === "object") return reply(200, next);
    const s = shipmentOf(body?.shipment_id);
    if (!s) return reply(422, { message: "Oops! Invalid Data.", errors: { shipment_id: ["The selected shipment id is invalid."] } });
    if (s.awb) return reply(400, { message: "Oops! Cannot reassign courier for this shipment." });
    // without courier_id Shiprocket picks its own default: here the (banned) recommended one, to show why we always send it
    const c = sr.couriers.find((x) => x.courier_company_id === Number(body.courier_id ?? sr.recommended));
    if (!c) return reply(400, { message: "Selected courier is not serviceable" });
    const awb = /blue\s*dart/i.test(c.courier_name) ? `9073${String(1000000 + ++sr.awbN)}` : `7D${String(140000000 + ++sr.awbN)}`;
    Object.assign(s, { awb, courier: c.courier_name, sr_courier_id: c.courier_company_id, awb_assign_date: "2026-11-12 10:05:00" });
    const o = orderOf(s.order_id);
    if (o) o.shipments = { ...o.shipments, awb, courier: c.courier_name };
    sr.tracking.set(awb, sr.tracking.get(awb) || NO_ACTIVITY);
    const out = reply(200, {
      awb_assign_status: 1, no_pickup_popup: 0, quick_pick: 0,
      response: { data: { courier_company_id: c.courier_company_id, awb_code: awb, cod: 0, order_id: s.order_id, shipment_id: s.id, awb_code_status: 1,
        assigned_date_time: { date: "2026-11-12 10:05:00.000000", timezone_type: 3, timezone: "Asia/Kolkata" }, applied_weight: 0.6, company_id: 1, courier_name: c.courier_name,
        child_courier_name: null, pickup_scheduled_date: null, routing_code: "", rto_routing_code: "", invoice_no: "Retail0001", transporter_id: "", transporter_name: "",
        shipped_by: { shipper_company_name: "1ACREFARMS", shipper_phone: "9000000001" } } },
    });
    if (next === "timeout_booked") return hang(init.signal); // Shiprocket booked it, but the answer never arrives
    return out;
  }
  if (method === "POST" && path === `${P}/courier/generate/pickup`) {
    const next = sr.pickup.length ? sr.pickup.shift() : "ok";
    if (next === "timeout") return hang(init.signal);
    if (typeof next === "number") return reply(next, { message: `mock ${next}` });
    const s = Array.isArray(body?.shipment_id) ? shipmentOf(body.shipment_id[0]) : null;
    if (!s) return reply(400, { message: "Invalid shipment id" });
    if (!s.awb) return reply(400, { message: "Please assign AWB first" });
    const date = Array.isArray(body.pickup_date) ? body.pickup_date[0] : "2026-11-12";
    s.pickup_scheduled = date;
    return reply(200, { pickup_status: 1, response: { pickup_scheduled_date: `${date} 14:00:00`, pickup_token_number: "Reference No: 194582194", status: 3,
      others: "{}", pickup_generated_date: { date: "2026-11-12 10:06:00.000000", timezone_type: 3, timezone: "Asia/Kolkata" }, data: `Pickup is confirmed by DTDC For AWB :- ${s.awb}` } });
  }
  if (method === "POST" && path === `${P}/courier/generate/label`) {
    const next = sr.label.length ? sr.label.shift() : "ok";
    if (next === "timeout") return hang(init.signal);
    if (typeof next === "number") return reply(next, { message: `mock ${next}` });
    if (!Array.isArray(body?.shipment_id)) return reply(422, { message: "Oops! Invalid Data.", errors: { shipment_id: ["The shipment id must be an array."] } });
    const s = shipmentOf(body.shipment_id[0]);
    if (!s?.awb) return reply(200, { label_created: 0, response: "No valid shipment ids to print label", not_created: body.shipment_id });
    return reply(200, { label_created: 1, label_url: `${sr.labelBase}/label_${s.id}.pdf`, response: "Label has been created and uploaded successfully!", not_created: [] });
  }
  if (method === "POST" && path === `${P}/manifests/generate`) {
    const s = Array.isArray(body?.shipment_id) ? shipmentOf(body.shipment_id[0]) : null;
    if (!s?.awb) return reply(400, { message: "Invalid shipment ids" });
    if (s.manifested) return reply(400, { message: "Manifest already generated", already_manifested_shipment_ids: [s.id] });
    s.manifested = true;
    return reply(200, { status: 1, manifest_url: `https://s3-ap-southeast-1.amazonaws.com/kr-shipmultichannel/mock/manifest_${s.id}.pdf` });
  }
  const show = path.match(/^\/v1\/external\/orders\/show\/([^/]+)$/);
  if (method === "GET" && show) {
    const o = orderOf(decodeURIComponent(show[1]));
    return o ? reply(200, { data: structuredClone(o) }) : reply(400, { message: "Order ID not found" });
  }
  const ship = path.match(/^\/v1\/external\/shipments\/([^/]+)$/);
  if (method === "GET" && ship) {
    const s = shipmentOf(decodeURIComponent(ship[1]));
    return reply(200, s ? { data: structuredClone(s) } : {}); // unknown id: 200 with {}
  }
  if (method === "GET" && path === `${P}/orders`) {
    const term = q.get("search") || "";
    const rows = [...sr.orders.values()].filter((o) => term && (o.channel_order_id === term || o.shipments?.awb === term));
    return reply(200, { data: rows.map((o) => ({ id: o.id, channel_order_id: o.channel_order_id, channel_name: o.channel_name, status: o.status, customer_name: o.customer_name,
      customer_phone: o.customer_phone, shipments: [{ id: o.shipments.id, awb: o.shipments.awb, courier: o.shipments.courier }] })), meta: { pagination: { total: rows.length } } });
  }
  if (method === "POST" && path === `${P}/orders/cancel`) {
    if (!Array.isArray(body?.ids)) return reply(422, { message: "Oops! Invalid Data.", errors: { ids: ["The ids field is required."] } });
    const o = orderOf(body.ids[0]);
    if (!o) return reply(500, { message: "Trying to get property of non-object" });
    o.status = "CANCELED";
    sr.cancelled.push(String(body.ids[0]));
    return reply(204);
  }
  if (method === "GET" && path === `${P}/settings/company/pickup`) {
    return reply(200, { data: { shipping_address: structuredClone(sr.pickups), allow_more: "1", is_blackbox_seller: false, company_name: "1ACREFARMS", recent_addresses: [] } });
  }
  if (method === "GET" && path === `${P}/account/details/wallet-balance`) {
    return reply(200, { data: { balance_amount: sr.wallet } });
  }
  const tAwb = path.match(/^\/v1\/external\/courier\/track\/awb\/([^/]+)$/);
  if (method === "GET" && tAwb) return reply(200, { tracking_data: structuredClone(trackingFor(decodeURIComponent(tAwb[1]))) });
  const tShip = path.match(/^\/v1\/external\/courier\/track\/shipment\/([^/]+)$/);
  if (method === "GET" && tShip) {
    const s = shipmentOf(decodeURIComponent(tShip[1]));
    return reply(200, { tracking_data: structuredClone(trackingFor(s?.awb)) });
  }
  if (method === "GET" && path === `${P}/courier/track`) {
    const o = [...sr.orders.values()].find((x) => x.channel_order_id === q.get("order_id"));
    if (!o) return reply(200, []);
    return reply(200, [{ tracking_data: structuredClone(trackingFor(o.shipments?.awb)) }]);
  }
  return null;
}

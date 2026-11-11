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
    shiprocket: { queue: [], created: new Map(), logins: 0, n: 0, gate: null, loginStatus: 200 },
    resend: { sent: [] },
    turnstile: { success: true },
  };

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = (init.method || "GET").toUpperCase();
    const headers = new Headers(init.headers || {});
    const bodyText = typeof init.body === "string" ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : "";
    const body = bodyText && headers.get("content-type")?.includes("json") ? JSON.parse(bodyText) : null;
    calls.push({ host: url.host, path: url.pathname, method, body });

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
        return reply(200, { order_id: 700000 + n, shipment_id: 800000 + n, status: "NEW", status_code: 1, awb_code: null });
      }
      return reply(404, { message: "not found" });
    }

    // ---------------- Resend ----------------
    if (url.host === "api.resend.com" && url.pathname === "/emails") {
      state.resend.sent.push(body);
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

  return { fetch: fetchImpl, state, calls, razorpayCapture, cashfreePay, phonepeFinish };
}

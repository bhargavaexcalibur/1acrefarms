// A fake internet for tests and the smoke run: Razorpay, Cashfree (sandbox), Shiprocket, Resend, Turnstile.
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

  return { fetch: fetchImpl, state, calls, razorpayCapture, cashfreePay };
}

// Test harness: the real Worker (createWorker) wired to the mock gateways, an in-memory (or SQLite-backed D1)
// store, a controllable clock, instant sleeps and a captured log.
import { createHash, createHmac } from "node:crypto";
import { createWorker } from "../../src/index.js";
import { makeLogger } from "../../src/log.js";
import { createMemoryStore } from "../../src/storage/memory.js";
import { createMockGateways } from "./mock-gateways.js";

// Fake, test-only values. None of these is a real key.
export const TEST_ENV = Object.freeze({
  MODE: "test",
  RAZORPAY_KEY_ID: "rzp_test_MOCKKEY0000001",
  RAZORPAY_KEY_SECRET: "mock_razorpay_key_secret_XYZ",
  RAZORPAY_WEBHOOK_SECRET: "mock_razorpay_webhook_secret_ABC",
  CASHFREE_APP_ID: "MOCKCFAPP0001",
  CASHFREE_SECRET_KEY: "cfsk_mock_secret_DEF",
  PHONEPE_CLIENT_ID: "MOCKPPCLIENT01",
  PHONEPE_CLIENT_SECRET: "mock_phonepe_client_secret_MNO",
  PHONEPE_CLIENT_VERSION: "1",
  PHONEPE_WEBHOOK_USERNAME: "onacre_hook",
  PHONEPE_WEBHOOK_PASSWORD: "mockHookPass123",
  SHIPROCKET_API_EMAIL: "api-user@shop.test",
  SHIPROCKET_API_PASSWORD: "mock-shiprocket-password-GHI",
  RESEND_API_KEY: "re_mock_key_JKL",
  SHIPROCKET_PUSH: "on",
  SHIPROCKET_PICKUP_LOCATION: "home",
  SITE_URL: "https://1acrefarms.co.in",
  PUBLIC_URL: "https://1acrefarms-checkout.example.workers.dev",
  CUSTOMER_MAIL_FROM: "1acrefarms orders <orders@mail.example.test>",
});

// Test fixture ONLY, built at runtime: fourteen zeros, the shape of an FSSAI licence number and obviously not one.
// Never shown anywhere; the real number goes into wrangler.toml only on grant day.
export const FAKE_TEST_LICENCE = "0".repeat(14);

// Every live-mode gate open (src/config.js checkoutGuard). Tests remove one at a time.
export const LIVE_ENV = Object.freeze({
  MODE: "live",
  LIVE_ENABLED: "yes-owner-approved",
  RAZORPAY_KEY_ID: "rzp_live_MOCK",
  FSSAI_ECOM_LIC: FAKE_TEST_LICENCE,
  FSSAI_ECOM_KOB_ENDORSED: "yes",
});

export const SECRET_VALUES = [
  "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "CASHFREE_SECRET_KEY", "PHONEPE_CLIENT_SECRET", "PHONEPE_WEBHOOK_PASSWORD",
  "SHIPROCKET_API_PASSWORD", "RESEND_API_KEY",
].map((k) => TEST_ENV[k]);

export const CUSTOMER = Object.freeze({
  name: "Lakshmi Devi",
  phone: "98765 43210",
  email: "lakshmi.devi@example.com",
  address: "12-3-45, Gandhi Nagar, Near Water Tank",
  city: "Guntur",
  state: "Andhra Pradesh",
  pin: "522002",
});

export const SITE = "https://1acrefarms.co.in";
export const T0 = Date.parse("2026-11-12T10:00:00+05:30");

export function makeCtx() {
  const pending = [];
  return {
    waitUntil(p) { pending.push(p); },
    pendingCount: () => pending.length,
    async drain() {
      while (pending.length) await Promise.all(pending.splice(0));
    },
  };
}

export function harness({ env = {}, store = createMemoryStore(), now = T0 } = {}) {
  const mocks = createMockGateways();
  const logs = [];
  const sleeps = [];
  let clock = now;
  mocks.state.phonepe.nowMs = () => clock; // PhonePe token expiry follows the harness clock
  let seq = 0;
  const fullEnv = { ...TEST_ENV, ...env };
  for (const [k, v] of Object.entries(fullEnv)) if (v === undefined) delete fullEnv[k];
  const worker = createWorker({
    store,
    fetch: mocks.fetch,
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); },
    log: makeLogger({ log: (line) => logs.push(line) }),
    // deterministic but unique order ids
    random: (n) => { seq++; return Uint8Array.from({ length: n }, (_, i) => (seq * 7 + i * 13) % 256); },
  });
  const ctx = makeCtx();

  async function call(method, path, { body, raw, headers = {}, origin = SITE } = {}) {
    const h = new Headers(headers);
    if (origin) h.set("origin", origin);
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) {
      payload = JSON.stringify(body);
      h.set("content-type", "application/json");
    }
    const res = await worker.fetch(new Request(`https://checkout.test${path}`, { method, headers: h, body: payload }), fullEnv, ctx);
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, body: data, headers: res.headers };
  }

  return {
    worker, store, mocks, env: fullEnv, ctx, logs, sleeps, call,
    advance(ms) { clock += ms; },
    now: () => clock,
    drain: () => ctx.drain(),
    scheduled: async () => { await worker.scheduled({ cron: "*/15 * * * *" }, fullEnv, ctx); await ctx.drain(); },
    createOrder: (items = [{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], customer = CUSTOMER, extra = {}) =>
      call("POST", "/create-order", { body: { items, customer, ...extra } }),
  };
}

// ---- independent signers (node:crypto), used as the oracle against our Web Crypto code ----
export const razorpaySignature = (secret, orderId, paymentId) => createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
export const razorpayWebhookSignature = (secret, raw) => createHmac("sha256", secret).update(raw).digest("hex");
export const cashfreeWebhookSignature = (secret, ts, raw) => createHmac("sha256", secret).update(ts + raw).digest("base64");
export const phonepeWebhookAuth = (username, password) => createHash("sha256").update(`${username}:${password}`).digest("hex");

export function razorpayOrderPaidEvent(gwOrderId, paymentId, amount, { receipt = "" } = {}) {
  return JSON.stringify({
    entity: "event", account_id: "acc_MOCK", event: "order.paid", contains: ["payment", "order"],
    payload: {
      payment: { entity: { id: paymentId, entity: "payment", amount, currency: "INR", status: "captured", order_id: gwOrderId, method: "upi", captured: true } },
      order: { entity: { id: gwOrderId, entity: "order", amount, amount_paid: amount, amount_due: 0, currency: "INR", receipt, status: "paid" } },
    },
    created_at: 1762921800,
  });
}

export function razorpayPaymentEvent(event, gwOrderId, paymentId, amount, status) {
  return JSON.stringify({
    entity: "event", account_id: "acc_MOCK", event, contains: ["payment"],
    payload: { payment: { entity: { id: paymentId, entity: "payment", amount, currency: "INR", status, order_id: gwOrderId } } },
    created_at: 1762921800,
  });
}

export function cashfreeEvent(type, orderId, amountRupees, { cfPaymentId = 99001, status = "SUCCESS" } = {}) {
  return JSON.stringify({
    data: {
      order: { order_id: orderId, order_amount: amountRupees, order_currency: "INR", order_tags: null },
      payment: { cf_payment_id: cfPaymentId, payment_status: status, payment_amount: amountRupees, payment_currency: "INR", payment_message: "mock", payment_time: "2026-11-12T10:05:00+05:30", payment_group: "upi" },
      customer_details: { customer_name: "x", customer_id: "c1", customer_email: "x@example.com", customer_phone: "9999999999" },
    },
    event_time: "2026-11-12T10:05:01+05:30",
    type,
  });
}

export async function postRazorpayWebhook(h, raw, { eventId = "evt_MOCK_1", secret = TEST_ENV.RAZORPAY_WEBHOOK_SECRET, signature } = {}) {
  return h.call("POST", "/razorpay-webhook", {
    raw,
    origin: null,
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature ?? razorpayWebhookSignature(secret, raw),
      ...(eventId ? { "x-razorpay-event-id": eventId } : {}),
    },
  });
}

export async function postCashfreeWebhook(h, raw, { ts = "1762921801", secret = TEST_ENV.CASHFREE_SECRET_KEY, signature } = {}) {
  return h.call("POST", "/cashfree-webhook", {
    raw,
    origin: null,
    headers: { "content-type": "application/json", "x-webhook-timestamp": ts, "x-webhook-signature": signature ?? cashfreeWebhookSignature(secret, ts, raw) },
  });
}

// PhonePe webhook body (Standard Checkout v2 shape: event + payload; "type" is deprecated and ignored).
export function phonepeEvent(event, merchantOrderId, amount, { state = "COMPLETED", orderId = "OMO26111000001", transactionId = "OM261110000011" } = {}) {
  return JSON.stringify({
    event,
    payload: {
      orderId, merchantId: "MOCKMERCHANT", merchantOrderId, state, amount, expireAt: 1762923000000,
      metaInfo: {},
      paymentDetails: [{ paymentMode: "UPI_QR", transactionId, timestamp: 1762921800000, amount, state }],
    },
  });
}

export async function postPhonePeWebhook(h, raw, { username = TEST_ENV.PHONEPE_WEBHOOK_USERNAME, password = TEST_ENV.PHONEPE_WEBHOOK_PASSWORD, authorization } = {}) {
  const auth = authorization === undefined ? phonepeWebhookAuth(username, password) : authorization;
  return h.call("POST", "/phonepe-webhook", {
    raw,
    origin: null,
    headers: { "content-type": "application/json", ...(auth === null ? {} : { authorization: auth }) },
  });
}

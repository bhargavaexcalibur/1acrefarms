#!/usr/bin/env node
// Local API for working on the hidden page WITHOUT Cloudflare or any account:
// the real Worker code on http://127.0.0.1:8787 with mocked gateways and an in-memory store.
//   node scripts/dev-server.mjs            then serve the site (python3 -m http.server 4321 at the repo root)
//                                           and open http://localhost:4321/checkout-test/
//   MOCK_RAZORPAY=down                      forces the Cashfree path
//   MOCK_RAZORPAY=down MOCK_CASHFREE=down   forces the PhonePe path: the page is sent to a MOCK PhonePe pay page on
//                                           this server (Pay / Fail / Back buttons), which returns to /checkout-test/
// The mock gateways cannot open a real Razorpay, Cashfree or PhonePe window (the keys are fake). For a real test-mode
// payment use `npx wrangler dev` with your TEST / SANDBOX / UAT keys in .dev.vars (see README).
import { createServer } from "node:http";
import { createWorker } from "../src/index.js";
import { createMemoryStore } from "../src/storage/memory.js";
import { createMockGateways } from "../test/helpers/mock-gateways.js";
import { TEST_ENV } from "../test/helpers/harness.js";

const PORT = Number(process.env.PORT || 8787);
const mocks = createMockGateways();
// MOCK_RAZORPAY=down makes every Razorpay order fail, to see the Cashfree failover on the page.
if (process.env.MOCK_RAZORPAY === "down") mocks.state.razorpay.create = 503;
if (process.env.MOCK_CASHFREE === "down") mocks.state.cashfree.create = 503;
const worker = createWorker({ store: createMemoryStore(), fetch: mocks.fetch });
const SITE = process.env.SITE_URL || "http://localhost:4321"; // where PhonePe / Cashfree send the customer back
const env = { ...TEST_ENV, SITE_URL: SITE, DEV_ORIGINS: "http://localhost:4321,http://127.0.0.1:4321" };
const ctx = { waitUntil: (p) => p.catch(() => {}) };
const ORDER_RE = /^1AF-T-\d{6}-[0-9A-Z]{6}$/;

// A stand-in for PhonePe's pay page (dev only). The customer's choice is applied to the mock PhonePe order, then
// the browser goes back to the redirectUrl the Worker sent to PhonePe, exactly like the real flow.
function mockPhonePePage(url, res) {
  const id = url.searchParams.get("order") || "";
  const o = ORDER_RE.test(id) ? mocks.state.phonepe.orders.get(id) : null;
  if (!o) {
    res.writeHead(404, { "content-type": "text/plain" });
    return res.end("unknown mock PhonePe order");
  }
  const outcome = url.searchParams.get("outcome");
  if (outcome) {
    if (outcome === "COMPLETED" || outcome === "FAILED") mocks.phonepeFinish(id, outcome);
    res.writeHead(302, { location: o.redirectUrl });
    return res.end();
  }
  const link = (v, label) => `<a href="/__mock/phonepe-pay?order=${id}&outcome=${v}" style="display:block;margin:12px 0;padding:14px;border-radius:8px;background:#5f259f;color:#fff;text-align:center;text-decoration:none;font:600 16px system-ui">${label}</a>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>MOCK PhonePe</title>
<body style="font:16px system-ui;max-width:420px;margin:40px auto;padding:0 16px">
<p style="background:#fff3cd;padding:8px;border-radius:6px">MOCK PhonePe pay page (dev-server only, no money)</p>
<h1 style="font-size:20px">Pay Rs ${(o.amount / 100).toFixed(2)}</h1><p>Order ${id}</p>
${link("COMPLETED", "Pay (mock success)")}${link("FAILED", "Fail (mock)")}${link("BACK", "Back to the shop without paying")}</body>`);
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/__mock/phonepe-pay") return mockPhonePePage(url, res);
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const out = await worker.fetch(request, env, ctx);
  let payload = Buffer.from(await out.arrayBuffer());
  // Point the page at the mock pay page above instead of the (fake) mercury-uat.phonepe.com link.
  if (url.pathname === "/create-order" && out.status === 200) {
    const data = JSON.parse(payload.toString("utf8"));
    if (data.gateway === "phonepe") {
      data.phonepe.redirectUrl = `http://127.0.0.1:${PORT}/__mock/phonepe-pay?order=${data.orderId}`;
      payload = Buffer.from(JSON.stringify(data));
    }
  }
  const headers = Object.fromEntries(out.headers);
  delete headers["content-length"];
  res.writeHead(out.status, headers);
  res.end(payload);
}).listen(PORT, "127.0.0.1", () => console.log(`mock checkout API on http://127.0.0.1:${PORT} (test mode, mocked gateways; order: ${env.GATEWAY_ORDER || "razorpay,cashfree,phonepe"})`));

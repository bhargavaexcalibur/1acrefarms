#!/usr/bin/env node
// Local API for working on the hidden page WITHOUT Cloudflare or any account:
// the real Worker code on http://127.0.0.1:8787 with mocked gateways and an in-memory store.
//   node scripts/dev-server.mjs            [MOCK_RAZORPAY=down to force the Cashfree path] (then serve the site, e.g. python3 -m http.server 4321 at the repo root,
//                                           and open http://localhost:4321/checkout-test/)
// The mock gateways cannot open a real Razorpay window (the key is fake). For a real test-mode payment use
// `npx wrangler dev` with your Razorpay TEST keys in .dev.vars (see README).
import { createServer } from "node:http";
import { createWorker } from "../src/index.js";
import { createMemoryStore } from "../src/storage/memory.js";
import { createMockGateways } from "../test/helpers/mock-gateways.js";
import { TEST_ENV } from "../test/helpers/harness.js";

const PORT = Number(process.env.PORT || 8787);
const mocks = createMockGateways();
// MOCK_RAZORPAY=down makes every Razorpay order fail, to see the Cashfree failover on the page.
if (process.env.MOCK_RAZORPAY === "down") mocks.state.razorpay.create = 503;
const worker = createWorker({ store: createMemoryStore(), fetch: mocks.fetch });
const env = { ...TEST_ENV, DEV_ORIGINS: "http://localhost:4321,http://127.0.0.1:4321" };
const ctx = { waitUntil: (p) => p.catch(() => {}) };

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(`http://127.0.0.1:${PORT}${req.url}`, {
    method: req.method,
    headers: Object.fromEntries(Object.entries(req.headers).filter(([, v]) => typeof v === "string")),
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });
  const out = await worker.fetch(request, env, ctx);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, "127.0.0.1", () => console.log(`mock checkout API on http://127.0.0.1:${PORT} (test mode, mocked gateways)`));

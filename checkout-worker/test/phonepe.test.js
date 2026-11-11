// PhonePe PG Standard Checkout v2 unit tests: OAuth token caching, create payment, Order Status mapping,
// webhook (SHA256(username:password)) verification. Worker-level flows (failover, /verify, webhook dedupe,
// reconcile) are in worker.test.js.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createMemoryStore } from "../src/storage/memory.js";
import { createPhonePeOrder, fetchPhonePePaid, isPhonePePayPage, verifyPhonePeWebhook } from "../src/gateways/phonepe.js";
import { createMockGateways } from "./helpers/mock-gateways.js";
import { TEST_ENV, T0 } from "./helpers/harness.js";

function setup(envOver = {}) {
  const env = { ...TEST_ENV, ...envOver };
  const mocks = createMockGateways();
  let clock = T0;
  mocks.state.phonepe.nowMs = () => clock;
  const store = createMemoryStore();
  const cfg = loadConfig(env);
  const deps = () => ({ cfg, env, fetchImpl: mocks.fetch, store, now: clock });
  let n = 0;
  const order = (totalPaise = 102600) => ({ id: `1AF-T-261112-PP${String(++n).padStart(4, "0")}`, totalPaise, packs: 3 });
  return {
    env, mocks, store, cfg, deps, order,
    advance: (ms) => { clock += ms; },
    tokenCalls: () => mocks.calls.filter((c) => c.path.endsWith("/v1/oauth/token")),
    payCalls: () => mocks.calls.filter((c) => c.path.endsWith("/checkout/v2/pay")),
  };
}

describe("PhonePe OAuth token", () => {
  test("form-encoded client_id / client_version / client_secret / grant_type; cached across calls", async () => {
    const s = setup();
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    const o = s.order();
    await createPhonePeOrder({ ...s.deps(), order: o });
    s.mocks.phonepeFinish(o.id, "COMPLETED");
    await fetchPhonePePaid({ ...s.deps(), gwOrderId: o.id, amountPaise: o.totalPaise });
    assert.equal(s.tokenCalls().length, 1, "one token for 3 creates + 1 status");
    assert.deepEqual(s.mocks.state.phonepe.tokens[0].form, {
      client_id: "MOCKPPCLIENT01", client_version: "1", client_secret: "mock_phonepe_client_secret_MNO", grant_type: "client_credentials",
    });
    assert.equal(await s.store.kvGet("phonepe_token:test", T0), "O-Bearer pp-mock-token-1", "header value cached, per mode");
  });

  test("refreshed 10 min before expires_at, not before", async () => {
    const s = setup();
    s.mocks.state.phonepe.tokenTtlSec = 3600; // expires_at = issued_at + 1 h
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    s.advance(49 * 60 * 1000);
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    assert.equal(s.tokenCalls().length, 1, "49 min: still the cached token");
    s.advance(2 * 60 * 1000);
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    assert.equal(s.tokenCalls().length, 2, "51 min (< 10 min left): a new token");
  });

  test("short-lived token is refreshed at half-life; a 401 drops the token and retries once with a new one", async () => {
    const s = setup();
    s.mocks.state.phonepe.tokenTtlSec = 600; // 10 min: refresh after 5
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    s.advance(6 * 60 * 1000);
    await createPhonePeOrder({ ...s.deps(), order: s.order() });
    assert.equal(s.tokenCalls().length, 2);
    s.mocks.state.phonepe.revoked.add("pp-mock-token-2"); // PhonePe stops accepting it early
    const r = await createPhonePeOrder({ ...s.deps(), order: s.order() });
    assert.match(r.client.redirectUrl, /^https:\/\/mercury-uat\.phonepe\.com\//);
    assert.equal(s.tokenCalls().length, 3, "one re-login");
    assert.equal(s.payCalls().length, 4, "the rejected call + its single retry");
  });

  test("token endpoint down -> GatewayError auth_failed / auth_timeout, nothing cached", async () => {
    const s = setup();
    s.mocks.state.phonepe.token = 500;
    await assert.rejects(createPhonePeOrder({ ...s.deps(), order: s.order() }), (e) => e.gateway === "phonepe" && e.reason === "auth_failed" && e.http === 500);
    assert.equal(await s.store.kvGet("phonepe_token:test", T0), null);
    const t = setup({ GATEWAY_TIMEOUT_MS: "30" });
    t.mocks.state.phonepe.token = "timeout";
    const t0 = Date.now();
    await assert.rejects(createPhonePeOrder({ ...t.deps(), order: t.order() }), (e) => e.reason === "auth_timeout");
    assert.ok(Date.now() - t0 < 1000, "token + create share one GATEWAY_TIMEOUT_MS budget");
  });

  test("not configured -> not_configured, no network call", async () => {
    const s = setup({ PHONEPE_CLIENT_SECRET: "" });
    await assert.rejects(createPhonePeOrder({ ...s.deps(), order: s.order() }), (e) => e.reason === "not_configured");
    assert.equal(s.mocks.calls.length, 0);
  });
});

describe("PhonePe create payment", () => {
  test("O-Bearer header, PG_CHECKOUT, paise, expireAfter, redirect back to the hidden page", async () => {
    const s = setup({ PHONEPE_EXPIRE_AFTER_SEC: "99999" });
    const o = s.order(23400);
    const r = await createPhonePeOrder({ ...s.deps(), order: o });
    assert.equal(r.gwOrderId, o.id);
    assert.equal(r.client.mode, "sandbox");
    const sent = s.payCalls()[0].body;
    assert.deepEqual(sent, {
      merchantOrderId: o.id, amount: 23400, expireAfter: 3600,
      paymentFlow: { type: "PG_CHECKOUT", message: `1acrefarms order ${o.id}`, merchantUrls: { redirectUrl: `https://1acrefarms.co.in/checkout-test/?order_id=${o.id}&gw=phonepe` } },
    }, "expireAfter clamped to PhonePe's 3600 s maximum");
  });

  test("4xx / 5xx / bad response / non-PhonePe pay page all fail (so the chain moves on or ends)", async () => {
    for (const [mode, reason, http] of [[400, "rejected", 400], [503, "server_error", 503], ["network", "network", 0]]) {
      const s = setup();
      s.mocks.state.phonepe.create = mode;
      await assert.rejects(createPhonePeOrder({ ...s.deps(), order: s.order() }), (e) => e.reason === reason && e.http === http, String(mode));
    }
    const dup = setup();
    const o = dup.order();
    await createPhonePeOrder({ ...dup.deps(), order: o });
    await assert.rejects(createPhonePeOrder({ ...dup.deps(), order: o }), (e) => e.reason === "rejected", "same merchantOrderId twice: BAD_REQUEST");
    assert.equal(isPhonePePayPage("https://mercury-uat.phonepe.com/transact/uat_v2?token=x"), true);
    assert.equal(isPhonePePayPage("https://mercury-t2.phonepe.com/transact/pg?token=x"), true);
    assert.equal(isPhonePePayPage("http://mercury.phonepe.com/x"), false, "https only");
    assert.equal(isPhonePePayPage("https://phonepe.com.evil.example/x"), false);
    assert.equal(isPhonePePayPage("https://evilphonepe.com/x"), false);
    assert.equal(isPhonePePayPage("not a url"), false);
  });

  test("a create that hangs is cut at GATEWAY_TIMEOUT_MS", async () => {
    const s = setup({ GATEWAY_TIMEOUT_MS: "30" });
    s.mocks.state.phonepe.create = "timeout";
    await assert.rejects(createPhonePeOrder({ ...s.deps(), order: s.order() }), (e) => e.reason === "timeout");
  });
});

describe("PhonePe Order Status", () => {
  test("PENDING / COMPLETED (with transactionId) / FAILED / wrong amount", async () => {
    const s = setup();
    const o = s.order();
    await createPhonePeOrder({ ...s.deps(), order: o });
    const look = () => fetchPhonePePaid({ ...s.deps(), gwOrderId: o.id, amountPaise: o.totalPaise });
    assert.deepEqual(await look(), { paid: false, failed: false, status: "PENDING" });
    s.mocks.phonepeFinish(o.id, "FAILED");
    assert.deepEqual(await look(), { paid: false, failed: true, status: "FAILED" });
    s.mocks.phonepeFinish(o.id, "COMPLETED", { transactionId: "OM2611TX42" });
    assert.deepEqual(await look(), { paid: true, paymentId: "OM2611TX42", amountOk: true });
    const call = s.mocks.calls.filter((c) => c.path.includes("/status")).at(-1);
    assert.equal(call.path, `/apis/pg-sandbox/checkout/v2/order/${o.id}/status`);
    const m = s.order();
    await createPhonePeOrder({ ...s.deps(), order: m });
    s.mocks.phonepeFinish(m.id, "COMPLETED", { amount: 100 });
    assert.equal((await fetchPhonePePaid({ ...s.deps(), gwOrderId: m.id, amountPaise: m.totalPaise })).amountOk, false);
  });

  test("status API error -> lookup_failed (the caller treats it as unknown)", async () => {
    const s = setup();
    const o = s.order();
    await createPhonePeOrder({ ...s.deps(), order: o });
    s.mocks.state.phonepe.status = 502;
    await assert.rejects(fetchPhonePePaid({ ...s.deps(), gwOrderId: o.id, amountPaise: o.totalPaise }), (e) => e.reason === "lookup_failed" && e.http === 502);
  });
});

// Vectors computed independently with Python's hashlib (and shasum -a 256):
//   sha256(b"1acrefarms_pp:Uat2026hookPw").hexdigest()
const PP_HOOK = { username: "1acrefarms_pp", password: "Uat2026hookPw", header: "177230017c0879b73a834df96516a38943724f24f365e6350429b0b16a759572" };

test("PhonePe webhook Authorization = hex SHA256(username:password): known vector and tampering", async () => {
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, PP_HOOK.header), true);
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, ` ${PP_HOOK.header} `), true, "surrounding spaces trimmed");
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, PP_HOOK.header.toUpperCase()), true, "hex case does not matter");
  assert.equal(await verifyPhonePeWebhook("onacre_hook", "mockHookPass123", "abef34a64d389307ec7a923e2e45e9a28655a9fb53e23bcbfbebb586f0f600cf"), true, "the test harness pair");
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, "Uat2026hookPx", PP_HOOK.header), false, "other password");
  assert.equal(await verifyPhonePeWebhook("1acrefarms_pq", PP_HOOK.password, PP_HOOK.header), false, "other username");
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, `SHA256 ${PP_HOOK.header}`), false, "the SDK compares the bare hex");
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, PP_HOOK.header.slice(0, 62)), false, "short");
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, `${PP_HOOK.header}00`), false, "long");
  assert.equal(await verifyPhonePeWebhook(PP_HOOK.username, PP_HOOK.password, null), false, "no header");
  assert.equal(await verifyPhonePeWebhook("", "", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"), false, "secrets not set: refused (not sha256 of empty)");
});

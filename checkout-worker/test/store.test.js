// Storage contract: the in-memory store and the D1 store (on real SQLite via node:sqlite + schema.sql)
// must behave the same. Focus: idempotent markPaid, webhook dedupe, the shipment lease.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createMemoryStore } from "../src/storage/memory.js";
import { createD1Store } from "../src/storage/d1.js";
import { createSqliteD1 } from "./helpers/d1-sqlite.js";
import { harness, razorpayOrderPaidEvent, postRazorpayWebhook } from "./helpers/harness.js";

const NOW = 1_762_921_800_000;
const order = (id, extra = {}) => ({
  id, createdAt: NOW, updatedAt: NOW, mode: "test", status: "new",
  items: [{ code: "TURM", sku: "1AF-TURM-0540", name: "Turmeric Powder", grams: 540, qty: 1, unitPaise: 39600, totalPaise: 39600, hsn: "09103030" }],
  packs: 1, subtotalPaise: 39600, deliveryPaise: 9900, totalPaise: 49500,
  customer: { name: "A B", phone: "9876543210", email: "a@b.in", address: "1-2-3 Some Road Town", city: "Guntur", state: "Andhra Pradesh", pin: "522002" },
  ...extra,
});

const STORES = {
  memory: () => createMemoryStore(),
  "d1 (sqlite)": () => createD1Store(createSqliteD1()),
};

for (const [name, make] of Object.entries(STORES)) {
  describe(`store: ${name}`, () => {
    test("order lifecycle round-trips", async () => {
      const s = make();
      await s.insertOrder(order("1AF-T-261112-AAAAAA"));
      await assert.rejects(s.insertOrder(order("1AF-T-261112-AAAAAA")), "duplicate id rejected");
      assert.equal(await s.setGatewayOrder("1AF-T-261112-AAAAAA", "razorpay", "order_1", NOW), true);
      assert.equal(await s.setGatewayOrder("1AF-T-261112-AAAAAA", "razorpay", "order_1", NOW), false, "only from new");
      const o = await s.findByGatewayOrder("razorpay", "order_1");
      assert.equal(o.id, "1AF-T-261112-AAAAAA");
      assert.equal(o.status, "created");
      assert.equal(o.customer.pin, "522002");
      assert.equal(o.items[0].sku, "1AF-TURM-0540");
      assert.equal(await s.findByGatewayOrder("cashfree", "order_1"), null);
      assert.equal(await s.getOrder("nope"), null);
    });

    test("markPaid is idempotent: exactly one winner, even when racing", async () => {
      const s = make();
      await s.insertOrder(order("1AF-T-261112-BBBBBB"));
      await s.setGatewayOrder("1AF-T-261112-BBBBBB", "razorpay", "order_2", NOW);
      const results = await Promise.all([
        s.markPaid("1AF-T-261112-BBBBBB", { paymentId: "pay_1", source: "webhook", now: NOW, shipStatus: "pending" }),
        s.markPaid("1AF-T-261112-BBBBBB", { paymentId: "pay_1", source: "verify", now: NOW, shipStatus: "pending" }),
        s.markPaid("1AF-T-261112-BBBBBB", { paymentId: "pay_1", source: "reconcile", now: NOW, shipStatus: "pending" }),
      ]);
      assert.deepEqual(results.filter(Boolean).length, 1);
      const o = await s.getOrder("1AF-T-261112-BBBBBB");
      assert.equal(o.status, "paid");
      assert.equal(o.paymentId, "pay_1");
      assert.equal(o.shipStatus, "pending");
      assert.equal(o.shipNextAt, NOW);
      assert.equal(await s.markPaid("1AF-T-261112-BBBBBB", { paymentId: "pay_2", source: "webhook", now: NOW + 1, shipStatus: "pending" }), false);
      assert.equal((await s.getOrder("1AF-T-261112-BBBBBB")).paymentId, "pay_1", "a second payment id never overwrites");
      assert.equal(await s.markPaymentFailed("1AF-T-261112-BBBBBB", NOW), false, "paid never goes back to failed");
      assert.equal(await s.markExpired("1AF-T-261112-BBBBBB", NOW), false);
    });

    test("markPaid allowed from created/verified/failed/expired, not from new/gateway_error/mismatch", async () => {
      const s = make();
      for (const [id, prep, want] of [
        ["1AF-T-261112-C00001", async () => {}, false],
        ["1AF-T-261112-C00002", async (i) => { await s.setGatewayOrder(i, "razorpay", "o2", NOW); await s.markVerified(i, "pay_v", NOW); }, true],
        ["1AF-T-261112-C00003", async (i) => { await s.setGatewayOrder(i, "razorpay", "o3", NOW); await s.markPaymentFailed(i, NOW); }, true],
        ["1AF-T-261112-C00004", async (i) => { await s.setGatewayOrder(i, "razorpay", "o4", NOW); await s.markExpired(i, NOW); }, true],
        ["1AF-T-261112-C00005", async (i) => { await s.markGatewayError(i, NOW); }, false],
        ["1AF-T-261112-C00006", async (i) => { await s.setGatewayOrder(i, "razorpay", "o6", NOW); await s.markAmountMismatch(i, NOW); }, false],
      ]) {
        await s.insertOrder(order(id));
        await prep(id);
        assert.equal(await s.markPaid(id, { paymentId: null, source: "webhook", now: NOW, shipStatus: "skipped" }), want, id);
      }
      assert.equal((await s.getOrder("1AF-T-261112-C00002")).paymentId, "pay_v", "keeps the verified payment id when none is given");
    });

    test("webhook events dedupe; forgetEvent allows a retry", async () => {
      const s = make();
      assert.equal(await s.recordEvent("rzp:evt_1", NOW), true);
      assert.equal(await s.recordEvent("rzp:evt_1", NOW + 5), false);
      assert.equal(await s.recordEvent("rzp:evt_2", NOW), true);
      await s.forgetEvent("rzp:evt_1");
      assert.equal(await s.recordEvent("rzp:evt_1", NOW), true);
    });

    test("shipment lease: one claimant; expired lease can be reclaimed; due list", async () => {
      const s = make();
      await s.insertOrder(order("1AF-T-261112-DDDDDD"));
      await s.setGatewayOrder("1AF-T-261112-DDDDDD", "razorpay", "order_d", NOW);
      await s.markPaid("1AF-T-261112-DDDDDD", { paymentId: "pay_d", source: "webhook", now: NOW, shipStatus: "pending" });
      assert.equal((await s.listShipmentsDue(NOW, 10)).length, 1);
      const claims = await Promise.all([s.claimShipment("1AF-T-261112-DDDDDD", NOW, 120000), s.claimShipment("1AF-T-261112-DDDDDD", NOW, 120000)]);
      assert.equal(claims.filter(Boolean).length, 1);
      assert.equal((await s.listShipmentsDue(NOW + 1000, 10)).length, 0, "leased");
      assert.equal(await s.claimShipment("1AF-T-261112-DDDDDD", NOW + 1000, 120000), false);
      assert.equal(await s.claimShipment("1AF-T-261112-DDDDDD", NOW + 120000, 120000), true, "lease ran out (crashed push)");
      await s.updateShipment("1AF-T-261112-DDDDDD", { shipStatus: "pushed", shipAttempts: 2, shipNextAt: null, shipError: null, srOrderId: "7001", srShipmentId: "8001" }, NOW);
      const o = await s.getOrder("1AF-T-261112-DDDDDD");
      assert.deepEqual([o.shipStatus, o.shipAttempts, o.srOrderId, o.srShipmentId], ["pushed", 2, "7001", "8001"]);
      assert.equal((await s.listShipmentsDue(NOW + 1e9, 10)).length, 0);
    });

    test("reconcile list, kv with expiry, stock", async () => {
      const s = make();
      await s.insertOrder(order("1AF-T-261112-EEEEEE"));
      await s.setGatewayOrder("1AF-T-261112-EEEEEE", "razorpay", "order_e", NOW);
      assert.equal((await s.listUnpaidForReconcile(NOW + 60_000, 10 * 60_000, 10)).length, 0, "too fresh");
      assert.equal((await s.listUnpaidForReconcile(NOW + 11 * 60_000, 10 * 60_000, 10)).length, 1);
      await s.touchReconcile("1AF-T-261112-EEEEEE", NOW + 11 * 60_000);
      assert.equal((await s.listUnpaidForReconcile(NOW + 12 * 60_000, 10 * 60_000, 10)).length, 0, "checked recently");
      await s.kvSet("k", "v", NOW + 10);
      assert.equal(await s.kvGet("k", NOW), "v");
      assert.equal(await s.kvGet("k", NOW + 10), null, "expired");
      await s.kvSet("k", "v2", null);
      assert.equal(await s.kvGet("k", NOW + 1e9), "v2");
      await s.kvDelete("k");
      assert.equal(await s.kvGet("k", NOW), null);
      assert.equal(await s.getStock("TURM"), null);
      await s.setStock("TURM", 3);
      assert.equal(await s.getStock("TURM"), 3);
    });
  });
}

test("full webhook flow on the D1 store (SQLite): dedupe + one Shiprocket order", async () => {
  const h = harness({ store: createD1Store(createSqliteD1()) });
  const r = await h.createOrder();
  assert.equal(r.status, 200);
  const gw = r.body.razorpay.orderId;
  const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
  const raw = razorpayOrderPaidEvent(gw, pay, r.body.totalPaise);
  await postRazorpayWebhook(h, raw, { eventId: "evt_X" });
  assert.equal((await postRazorpayWebhook(h, raw, { eventId: "evt_X" })).body.duplicate, true);
  await postRazorpayWebhook(h, raw, { eventId: "evt_Y" });
  await h.drain();
  const o = await h.store.getOrder(r.body.orderId);
  assert.equal(o.status, "paid");
  assert.equal(o.shipStatus, "pushed");
  assert.equal(h.mocks.calls.filter((c) => c.path === "/v1/external/orders/create/adhoc").length, 1);
});

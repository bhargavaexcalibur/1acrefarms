// In-memory store with the same interface and semantics as storage/d1.js. Used by tests and the smoke run.
// Every method is async so callers cannot tell the two apart.

const PAYABLE = new Set(["created", "verified", "failed", "expired"]);
const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export function createMemoryStore() {
  const orders = new Map();
  const events = new Map();
  const kv = new Map();
  const stock = new Map();

  const upd = (o, fields, now) => Object.assign(o, fields, { updatedAt: now });

  return {
    kind: "memory",
    _orders: orders, // test inspection only

    async insertOrder(order) {
      if (orders.has(order.id)) throw new Error("duplicate order id");
      orders.set(order.id, clone({
        gateway: null, gwOrderId: null, gwFailover: null, paymentId: null, paidAt: null, paidSource: null,
        shipStatus: null, shipAttempts: 0, shipNextAt: null, shipError: null, srOrderId: null, srShipmentId: null,
        reconcileAt: null, ...order,
      }));
    },
    async getOrder(id) {
      return clone(orders.get(id)) ?? null;
    },
    async findByGatewayOrder(gateway, gwOrderId) {
      for (const o of orders.values()) if (o.gateway === gateway && o.gwOrderId === gwOrderId) return clone(o);
      return null;
    },
    async setGatewayOrder(id, gateway, gwOrderId, now, failover = null) {
      const o = orders.get(id);
      if (!o || o.status !== "new") return false;
      if (!["razorpay", "cashfree", "phonepe"].includes(gateway)) throw new Error("unknown gateway"); // = the D1 CHECK
      for (const x of orders.values()) if (x.gateway === gateway && x.gwOrderId === gwOrderId) throw new Error("duplicate gateway order");
      upd(o, { gateway, gwOrderId, gwFailover: failover ?? null, status: "created" }, now);
      return true;
    },
    async markGatewayError(id, now, failover = null) {
      const o = orders.get(id);
      if (!o || o.status !== "new") return false;
      upd(o, { status: "gateway_error", gwFailover: failover ?? null }, now);
      return true;
    },
    async markVerified(id, paymentId, now) {
      const o = orders.get(id);
      if (!o || !(o.status === "created" || o.status === "failed")) return false;
      upd(o, { status: "verified", paymentId }, now);
      return true;
    },
    // The one transition that matters: exactly one caller ever gets `true` for an order.
    async markPaid(id, { paymentId = null, source, now, shipStatus }) {
      const o = orders.get(id);
      if (!o || !PAYABLE.has(o.status)) return false;
      upd(o, {
        status: "paid", paymentId: paymentId ?? o.paymentId, paidAt: now, paidSource: source,
        shipStatus, shipNextAt: shipStatus === "pending" ? now : null,
      }, now);
      return true;
    },
    async markPaymentFailed(id, now) {
      const o = orders.get(id);
      if (!o || o.status !== "created") return false;
      upd(o, { status: "failed" }, now);
      return true;
    },
    async markAmountMismatch(id, now) {
      const o = orders.get(id);
      if (!o || !PAYABLE.has(o.status)) return false;
      upd(o, { status: "amount_mismatch" }, now);
      return true;
    },
    async markExpired(id, now) {
      const o = orders.get(id);
      if (!o || !(o.status === "created" || o.status === "failed")) return false;
      upd(o, { status: "expired" }, now);
      return true;
    },
    async touchReconcile(id, now) {
      const o = orders.get(id);
      if (o) o.reconcileAt = now;
    },
    async listUnpaidForReconcile(now, olderThanMs, limit) {
      return [...orders.values()]
        .filter((o) => ["created", "verified", "failed"].includes(o.status) && o.gwOrderId &&
          o.createdAt <= now - olderThanMs && (o.reconcileAt === null || o.reconcileAt <= now - 15 * 60 * 1000))
        .sort((a, b) => a.createdAt - b.createdAt)
        .slice(0, limit)
        .map(clone);
    },

    async recordEvent(key, now) {
      if (events.has(key)) return false;
      events.set(key, now);
      return true;
    },
    async forgetEvent(key) {
      events.delete(key);
    },

    async listShipmentsDue(now, limit) {
      return [...orders.values()]
        .filter((o) => o.status === "paid" && ["pending", "retry", "pushing"].includes(o.shipStatus) && o.shipNextAt !== null && o.shipNextAt <= now)
        .sort((a, b) => a.shipNextAt - b.shipNextAt)
        .slice(0, limit)
        .map(clone);
    },
    // Lease: only one worker pushes an order at a time; a crashed push is retried after the lease ends.
    async claimShipment(id, now, leaseMs) {
      const o = orders.get(id);
      if (!o || o.status !== "paid" || !["pending", "retry", "pushing"].includes(o.shipStatus) || o.shipNextAt === null || o.shipNextAt > now) return false;
      upd(o, { shipStatus: "pushing", shipNextAt: now + leaseMs }, now);
      return true;
    },
    async updateShipment(id, fields, now) {
      const o = orders.get(id);
      if (o) upd(o, fields, now);
    },

    async kvGet(k, now) {
      const e = kv.get(k);
      if (!e) return null;
      if (e.expiresAt !== null && e.expiresAt <= now) {
        kv.delete(k);
        return null;
      }
      return e.v;
    },
    async kvSet(k, v, expiresAt = null) {
      kv.set(k, { v, expiresAt });
    },
    async kvDelete(k) {
      kv.delete(k);
    },

    async getStock(code) {
      return stock.has(code) ? stock.get(code) : null;
    },
    async setStock(code, qty) {
      stock.set(code, qty);
    },
  };
}

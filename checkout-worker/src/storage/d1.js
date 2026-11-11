// D1-backed store (binding env.DB). Same interface and semantics as storage/memory.js.
// Idempotency comes from conditional UPDATEs (WHERE status IN ...) and PRIMARY KEY / UNIQUE constraints:
// a statement that changes 0 rows means "someone else already did it".

const PAYABLE = "('created','verified','failed','expired')";

function rowToOrder(r) {
  if (!r) return null;
  return {
    id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, mode: r.mode, status: r.status,
    gateway: r.gateway, gwOrderId: r.gw_order_id, gwFailover: r.gw_failover, paymentId: r.payment_id,
    items: JSON.parse(r.items_json), packs: r.packs,
    subtotalPaise: r.subtotal_paise, deliveryPaise: r.delivery_paise, totalPaise: r.total_paise,
    customer: JSON.parse(r.customer_json),
    paidAt: r.paid_at, paidSource: r.paid_source,
    shipStatus: r.ship_status, shipAttempts: r.ship_attempts, shipNextAt: r.ship_next_at, shipError: r.ship_error,
    srOrderId: r.sr_order_id, srShipmentId: r.sr_shipment_id, reconcileAt: r.reconcile_at,
  };
}

const changed = (res) => (res?.meta?.changes ?? 0) > 0;

const SHIP_COLS = {
  shipStatus: "ship_status", shipAttempts: "ship_attempts", shipNextAt: "ship_next_at",
  shipError: "ship_error", srOrderId: "sr_order_id", srShipmentId: "sr_shipment_id",
};

export function createD1Store(db) {
  if (!db || typeof db.prepare !== "function") throw new Error("D1 binding DB is missing (see wrangler.toml.example)");
  const q = (sql, ...args) => db.prepare(sql).bind(...args);

  return {
    kind: "d1",

    async insertOrder(o) {
      await q(
        `INSERT INTO orders (id, created_at, updated_at, mode, status, items_json, packs, subtotal_paise,
           delivery_paise, total_paise, customer_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        o.id, o.createdAt, o.updatedAt, o.mode, o.status, JSON.stringify(o.items), o.packs, o.subtotalPaise,
        o.deliveryPaise, o.totalPaise, JSON.stringify(o.customer),
      ).run();
    },
    async getOrder(id) {
      return rowToOrder(await q("SELECT * FROM orders WHERE id = ?", id).first());
    },
    async findByGatewayOrder(gateway, gwOrderId) {
      return rowToOrder(await q("SELECT * FROM orders WHERE gateway = ? AND gw_order_id = ?", gateway, gwOrderId).first());
    },
    async setGatewayOrder(id, gateway, gwOrderId, now, failover = null) {
      return changed(await q(
        "UPDATE orders SET gateway = ?, gw_order_id = ?, gw_failover = ?, status = 'created', updated_at = ? WHERE id = ? AND status = 'new'",
        gateway, gwOrderId, failover ?? null, now, id,
      ).run());
    },
    async markGatewayError(id, now, failover = null) {
      return changed(await q("UPDATE orders SET status = 'gateway_error', gw_failover = ?, updated_at = ? WHERE id = ? AND status = 'new'", failover ?? null, now, id).run());
    },
    async markVerified(id, paymentId, now) {
      return changed(await q(
        "UPDATE orders SET status = 'verified', payment_id = ?, updated_at = ? WHERE id = ? AND status IN ('created','failed')",
        paymentId, now, id,
      ).run());
    },
    async markPaid(id, { paymentId = null, source, now, shipStatus }) {
      return changed(await q(
        `UPDATE orders SET status = 'paid', payment_id = COALESCE(?, payment_id), paid_at = ?, paid_source = ?,
           ship_status = ?, ship_next_at = ?, updated_at = ?
         WHERE id = ? AND status IN ${PAYABLE}`,
        paymentId, now, source, shipStatus, shipStatus === "pending" ? now : null, now, id,
      ).run());
    },
    async markPaymentFailed(id, now) {
      return changed(await q("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'created'", now, id).run());
    },
    async markAmountMismatch(id, now) {
      return changed(await q(`UPDATE orders SET status = 'amount_mismatch', updated_at = ? WHERE id = ? AND status IN ${PAYABLE}`, now, id).run());
    },
    async markExpired(id, now) {
      return changed(await q("UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status IN ('created','failed')", now, id).run());
    },
    async touchReconcile(id, now) {
      await q("UPDATE orders SET reconcile_at = ? WHERE id = ?", now, id).run();
    },
    async listUnpaidForReconcile(now, olderThanMs, limit) {
      const { results } = await q(
        `SELECT * FROM orders WHERE status IN ('created','verified','failed') AND gw_order_id IS NOT NULL
           AND created_at <= ? AND (reconcile_at IS NULL OR reconcile_at <= ?)
         ORDER BY created_at LIMIT ?`,
        now - olderThanMs, now - 15 * 60 * 1000, limit,
      ).all();
      return results.map(rowToOrder);
    },

    async recordEvent(key, now) {
      return changed(await q("INSERT OR IGNORE INTO webhook_events (event_key, received_at) VALUES (?, ?)", key, now).run());
    },
    async forgetEvent(key) {
      await q("DELETE FROM webhook_events WHERE event_key = ?", key).run();
    },

    async listShipmentsDue(now, limit) {
      const { results } = await q(
        `SELECT * FROM orders WHERE status = 'paid' AND ship_status IN ('pending','retry','pushing')
           AND ship_next_at IS NOT NULL AND ship_next_at <= ? ORDER BY ship_next_at LIMIT ?`,
        now, limit,
      ).all();
      return results.map(rowToOrder);
    },
    async claimShipment(id, now, leaseMs) {
      return changed(await q(
        `UPDATE orders SET ship_status = 'pushing', ship_next_at = ?, updated_at = ?
         WHERE id = ? AND status = 'paid' AND ship_status IN ('pending','retry','pushing')
           AND ship_next_at IS NOT NULL AND ship_next_at <= ?`,
        now + leaseMs, now, id, now,
      ).run());
    },
    async updateShipment(id, fields, now) {
      const sets = [];
      const args = [];
      for (const [k, col] of Object.entries(SHIP_COLS)) {
        if (k in fields) {
          sets.push(`${col} = ?`);
          args.push(fields[k]);
        }
      }
      if (!sets.length) return;
      await q(`UPDATE orders SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...args, now, id).run();
    },

    async kvGet(k, now) {
      const r = await q("SELECT v, expires_at FROM kv WHERE k = ?", k).first();
      if (!r) return null;
      if (r.expires_at !== null && r.expires_at <= now) return null;
      return r.v;
    },
    async kvSet(k, v, expiresAt = null) {
      await q("INSERT INTO kv (k, v, expires_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at", k, v, expiresAt).run();
    },
    async kvDelete(k) {
      await q("DELETE FROM kv WHERE k = ?", k).run();
    },

    async getStock(code) {
      const r = await q("SELECT qty FROM stock WHERE code = ?", code).first();
      return r ? r.qty : null;
    },
    async setStock(code, qty, now = Date.now()) {
      await q("INSERT INTO stock (code, qty, updated_at) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET qty = excluded.qty, updated_at = excluded.updated_at", code, qty, now).run();
    },
  };
}

// Meta catalogue checkout link: ?products=<SKU>%3A<qty>,... -> cart (src/cart-link.js, used by checkout-test/checkout.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE, LIMITS, skuOf } from "../src/pricing.js";
import { SKU_ALIASES, parseProductsParam } from "../src/cart-link.js";

const fromUrl = (query) => parseProductsParam(new URLSearchParams(query).get("products"));

test("Meta's format, as the browser hands it over (%3A and %2C decoded by URLSearchParams)", () => {
  const r = fromUrl("products=1AF-TURM-0540%3A2%2C1AF-CBEL-0540%3A1&coupon=SAVE50");
  assert.deepEqual(r, { items: [{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], ignored: [], clampedLine: false, clampedTotal: false });
  assert.deepEqual(parseProductsParam("1AF-KPAS-0540%3A3,1af-tbel-0540:1").items, [{ code: "KPAS", qty: 3 }, { code: "TBEL", qty: 1 }], "still-encoded colon, lower case");
  assert.deepEqual(parseProductsParam(" 1AF-TURM-0540 : 2 , ,1AF-CBEL-0540").items, [{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], "spaces, empty parts, missing qty = 1");
});

test("every sellable SKU is understood; PALM is palm jaggery (TBEL)", () => {
  for (const code of Object.keys(CATALOGUE).filter((c) => CATALOGUE[c].sellable)) {
    assert.deepEqual(parseProductsParam(`${skuOf(code)}:1`).items, [{ code, qty: 1 }], code);
  }
  assert.deepEqual(SKU_ALIASES, { "1AF-PALM-0540": "TBEL" });
  assert.deepEqual(fromUrl("products=1AF-PALM-0540%3A2").items, [{ code: "TBEL", qty: 2 }]);
  assert.deepEqual(parseProductsParam("1AF-PALM-0540:1,1AF-TBEL-0540:2").items, [{ code: "TBEL", qty: 3 }], "alias and SKU merge");
});

test("unknown, held/parked and bad-quantity items are left out and reported", () => {
  const r = parseProductsParam("1AF-SANN-0540:1,1AF-TEJA-0540:2,1AF-CASH-0540:1,1AF-XXXX-0540:1,1AF-TURM-1000:1,1AF-TURM-0540:0,1AF-CBEL-0540:-1,1AF-KPAS-0540:two,1AF-TBEL-0540:1.5,1AF-TURM-0540:1");
  assert.deepEqual(r.items, [{ code: "TURM", qty: 1 }]);
  assert.deepEqual(r.ignored, [
    { sku: "1AF-SANN-0540", reason: "not_sellable" },
    { sku: "1AF-TEJA-0540", reason: "not_sellable" },
    { sku: "1AF-CASH-0540", reason: "not_sellable" },
    { sku: "1AF-XXXX-0540", reason: "unknown" },
    { sku: "1AF-TURM-1000", reason: "unknown" },
    { sku: "1AF-TURM-0540", reason: "bad_qty" },
    { sku: "1AF-CBEL-0540", reason: "bad_qty" },
    { sku: "1AF-KPAS-0540", reason: "bad_qty" },
    { sku: "1AF-TBEL-0540", reason: "bad_qty" },
  ]);
  const long = parseProductsParam(`${"<script>".repeat(10)}:1`);
  assert.equal(long.ignored[0].sku.length, 24, "reported SKU text is cut short (the page escapes it too)");
});

test("quantities are clamped: per pack to maxQtyPerLine, then per order to maxPacksPerOrder", () => {
  assert.deepEqual([LIMITS.maxQtyPerLine, LIMITS.maxPacksPerOrder], [10, 12]);
  const one = parseProductsParam("1AF-TURM-0540:50");
  assert.deepEqual([one.items, one.clampedLine, one.clampedTotal], [[{ code: "TURM", qty: 10 }], true, false]);
  const two = parseProductsParam("1AF-TURM-0540:7,1AF-CBEL-0540:9,1AF-KPAS-0540:1");
  assert.deepEqual(two.items, [{ code: "TURM", qty: 7 }, { code: "CBEL", qty: 5 }], "link order kept; the last packs give way");
  assert.deepEqual([two.clampedLine, two.clampedTotal], [false, true]);
  const dup = parseProductsParam("1AF-TURM-0540:6,1AF-TURM-0540:6");
  assert.deepEqual([dup.items, dup.clampedLine], [[{ code: "TURM", qty: 10 }], true], "repeats add up, then clamp");
});

test("empty, missing or hostile input", () => {
  const empty = { items: [], ignored: [], clampedLine: false, clampedTotal: false };
  for (const v of [null, undefined, "", "   ", 42, {}]) assert.deepEqual(parseProductsParam(v), empty, String(v));
  const many = Array.from({ length: 30 }, () => "1AF-XXXX-0540:1").join(",");
  assert.equal(parseProductsParam(many).ignored.length, 20, "at most 20 entries are read");
  assert.equal(parseProductsParam(`1AF-TURM-0540:1${",".repeat(5000)}1AF-CBEL-0540:1`).items.length, 1, "at most 1000 characters are read");
});

// The site-wide cart (product pages, home cards, /checkout/): clampCart / cartAdd keep it inside the Worker's rules.
import { CART_KEY, cartAdd, cartCount, clampCart } from "../src/cart-link.js";

test("stored cart: only sellable packs, whole quantities, per-pack and per-order limits", () => {
  assert.equal(CART_KEY, "oneacre_cart_v1");
  assert.deepEqual(clampCart({ TURM: 2, CBEL: 1 }), { items: [{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], clamped: false });
  for (const bad of [null, undefined, "x", 3, [], [["TURM", 1]]]) assert.deepEqual(clampCart(bad), { items: [], clamped: false }, String(bad));
  const r = clampCart({ SANN: 1, CASH: 2, XXXX: 1, TURM: 0, KPAS: -1, TBEL: 1.5, CBEL: "2", __proto__x: 1 });
  assert.deepEqual(r.items, [], "held, parked, unknown and bad quantities are dropped");
  assert.equal(r.clamped, true);
  assert.deepEqual(clampCart({ TURM: 50 }).items, [{ code: "TURM", qty: LIMITS.maxQtyPerLine }]);
  assert.deepEqual(clampCart({ TURM: 10, KPAS: 10 }).items, [{ code: "TURM", qty: 10 }, { code: "KPAS", qty: LIMITS.maxPacksPerOrder - 10 }]);
  assert.equal(clampCart({ TURM: 10, KPAS: 10, CBEL: 1 }).items.length, 2, "nothing past the order limit");
  assert.equal(cartCount({ TURM: 2, CBEL: 1, SANN: 4 }), 3);
});

test("Add to cart / Buy now: one more, or at least one; never past the limits; held packs refused", () => {
  assert.deepEqual(cartAdd({}, "TURM"), { ok: true, cart: { TURM: 1 }, added: true });
  assert.deepEqual(cartAdd({ TURM: 1 }, "turm"), { ok: true, cart: { TURM: 2 }, added: true });
  assert.deepEqual(cartAdd({ TURM: 2 }, "TURM", { atLeastOne: true }), { ok: true, cart: { TURM: 2 }, added: false }, "Buy now keeps the quantity");
  assert.deepEqual(cartAdd({ CBEL: 1 }, "TURM", { atLeastOne: true }), { ok: true, cart: { CBEL: 1, TURM: 1 }, added: true });
  assert.deepEqual(cartAdd({ TURM: 10 }, "TURM"), { ok: true, cart: { TURM: 10 }, added: false }, "per-pack limit");
  assert.deepEqual(cartAdd({ TURM: 10, KPAS: 2 }, "CBEL"), { ok: true, cart: { TURM: 10, KPAS: 2 }, added: false }, "order limit");
  for (const code of ["SANN", "TEJA", "CASH", "XXXX", "", null]) assert.deepEqual(cartAdd({ TURM: 1 }, code), { ok: false }, String(code));
  assert.deepEqual(cartAdd({ SANN: 3, TURM: 1 }, "KPAS").cart, { TURM: 1, KPAS: 1 }, "a held pack left in storage is dropped");
});

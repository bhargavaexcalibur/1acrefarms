// Meta (Facebook / Instagram) catalogue checkout link -> cart. Meta opens our checkout URL with
//   ?products=<SKU>%3A<qty>,<SKU>%3A<qty>   e.g. ?products=1AF-TURM-0540%3A2,1AF-CBEL-0540%3A1
// (URLSearchParams has already turned %3A into ":"). Pure function; the hidden page imports this file.
//  - SKUs are our catalogue SKUs (pricing.js skuOf: 1AF-TURM-0540 ...). 1AF-PALM-0540 is accepted for palm jaggery
//    (TBEL), the name some catalogue feeds use.
//  - Unknown SKUs, packs that are not sellable now and bad quantities are left out and reported, so the page can say so.
//  - Quantities are clamped to LIMITS (per pack, then per order, in link order). Nothing is ever added that the link
//    did not ask for; any coupon or price in the link is ignored (prices come from pricing.js only).
import { CATALOGUE, LIMITS, skuOf } from "./pricing.js";

export const SKU_ALIASES = Object.freeze({ [skuOf("PALM")]: "TBEL" }); // 1AF-PALM-0540 -> palm jaggery

const BY_SKU = Object.freeze(Object.fromEntries([
  ...Object.keys(CATALOGUE).map((code) => [skuOf(code), code]),
  ...Object.entries(SKU_ALIASES),
]));

const MAX_ENTRIES = 20;
const MAX_LEN = 1000;

// -> { items: [{code, qty}], ignored: [{sku, reason: "unknown" | "not_sellable" | "bad_qty"}], clampedLine, clampedTotal }
export function parseProductsParam(raw) {
  const out = { items: [], ignored: [], clampedLine: false, clampedTotal: false };
  if (typeof raw !== "string" || !raw.trim()) return out;
  const text = raw.slice(0, MAX_LEN).replace(/%3A/gi, ":").replace(/%2C/gi, ",");
  const want = new Map(); // code -> qty, in link order
  for (const part of text.split(",").slice(0, MAX_ENTRIES)) {
    const entry = part.trim();
    if (!entry) continue;
    const i = entry.indexOf(":");
    const sku = (i < 0 ? entry : entry.slice(0, i)).trim().toUpperCase().slice(0, 24);
    const qtyText = i < 0 ? "1" : entry.slice(i + 1).trim();
    const code = BY_SKU[sku];
    if (!code) { out.ignored.push({ sku, reason: "unknown" }); continue; }
    if (!CATALOGUE[code].sellable) { out.ignored.push({ sku, reason: "not_sellable" }); continue; }
    if (!/^\d{1,4}$/.test(qtyText) || Number(qtyText) < 1) { out.ignored.push({ sku, reason: "bad_qty" }); continue; }
    want.set(code, (want.get(code) || 0) + Number(qtyText));
  }
  let total = 0;
  for (const [code, asked] of want) {
    let qty = asked;
    if (qty > LIMITS.maxQtyPerLine) { qty = LIMITS.maxQtyPerLine; out.clampedLine = true; }
    if (total + qty > LIMITS.maxPacksPerOrder) { qty = LIMITS.maxPacksPerOrder - total; out.clampedTotal = true; }
    if (qty < 1) continue;
    out.items.push({ code, qty });
    total += qty;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// The site-wide cart (product pages, home cards and /checkout/ share it). It lives only in the buyer's own browser:
// localStorage[CART_KEY] = { cart: { CODE: qty }, pin, lang }. No account, nothing pre-filled or pre-ticked, and nothing
// is ever added that the buyer did not press. These pure helpers keep it inside the Worker's own rules (sellable packs
// only, LIMITS per pack and per order), so the page never shows a cart the Worker would refuse.
export const CART_KEY = "oneacre_cart_v1";

// Any stored value -> { items: [{code, qty}], clamped } with unknown / not-sellable packs and bad quantities dropped,
// each pack at most LIMITS.maxQtyPerLine and the whole cart at most LIMITS.maxPacksPerOrder (in stored order).
export function clampCart(raw) {
  const out = { items: [], clamped: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let total = 0;
  for (const [code, value] of Object.entries(raw).slice(0, MAX_ENTRIES)) {
    if (!CATALOGUE[code]?.sellable || !Number.isInteger(value) || value < 1) { out.clamped = true; continue; }
    let qty = Math.min(value, LIMITS.maxQtyPerLine);
    if (total + qty > LIMITS.maxPacksPerOrder) qty = LIMITS.maxPacksPerOrder - total;
    if (qty !== value) out.clamped = true;
    if (qty < 1) continue;
    out.items.push({ code, qty });
    total += qty;
  }
  return out;
}

export const cartObject = (items) => Object.fromEntries(items.map((i) => [i.code, i.qty]));
export const cartCount = (raw) => clampCart(raw).items.reduce((n, i) => n + i.qty, 0);

// One more of `code` ("Add to cart"), or at least one ("Buy now", atLeastOne = true).
// -> { ok: false } for a pack that cannot be ordered here; else { ok: true, cart: {CODE: qty}, added: bool }, where
// added = false means the cart already held the most one order can take (nothing changed).
export function cartAdd(raw, code, { atLeastOne = false } = {}) {
  const c = String(code ?? "").toUpperCase();
  if (!CATALOGUE[c]?.sellable) return { ok: false };
  const items = clampCart(raw).items;
  const line = items.find((i) => i.code === c);
  const total = items.reduce((n, i) => n + i.qty, 0);
  if (line && atLeastOne) return { ok: true, cart: cartObject(items), added: false };
  if (total >= LIMITS.maxPacksPerOrder || (line && line.qty >= LIMITS.maxQtyPerLine)) {
    return { ok: true, cart: cartObject(items), added: false };
  }
  if (line) line.qty += 1;
  else items.push({ code: c, qty: 1 });
  return { ok: true, cart: cartObject(items), added: true };
}

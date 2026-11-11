// Prices and parcel sizes: the ONE place they live. There is no delivery fee (see DELIVERY_FEE_RUPEES).
// The Worker prices every order from this file and never from the browser. The hidden test page
// (/checkout-test/) imports this same file only to show the numbers before the Worker confirms them.
// No secrets here: this file is served publicly by GitHub Pages.
//
// MRPs = the 540 g Amazon.in MRPs (Rs, incl. GST). test/pricing.test.js fails if they drift from app.js.

export const PACK_GRAMS = 540;

// hsn: only codes on record (turmeric 09103030, cane jaggery 17011310, palm jaggery 17029010).
// Chilli HSN is left blank until the invoice master (ChittaGupta) confirms it; Shiprocket treats hsn as optional.
// sellable:false = parked, cannot be ordered (cashew).
export const CATALOGUE = Object.freeze({
  TURM: Object.freeze({ name: "Turmeric Powder", mrp: 396, hsn: "09103030", sellable: true }),
  KPAS: Object.freeze({ name: "Hill Turmeric Powder", mrp: 495, hsn: "09103030", sellable: true }),
  SANN: Object.freeze({ name: "Sannam Chilli Powder", mrp: 495, hsn: "", sellable: true }),
  TEJA: Object.freeze({ name: "Teja Chilli Powder", mrp: 495, hsn: "", sellable: true }),
  CBEL: Object.freeze({ name: "Cane Jaggery", mrp: 234, hsn: "17011310", sellable: true }),
  TBEL: Object.freeze({ name: "Palm Jaggery", mrp: 495, hsn: "17029010", sellable: true }),
  CASH: Object.freeze({ name: "Cashew Kernels", mrp: 891, hsn: "", sellable: false }),
});

export const skuOf = (code) => `1AF-${code}-${String(PACK_GRAMS).padStart(4, "0")}`;

export const LIMITS = Object.freeze({ maxQtyPerLine: 10, maxPacksPerOrder: 12 });

// Delivery: FREE on every order, anywhere in India (Bhargava 11-11-2026: "lets never charge our customers other
// than MRP"; this replaces the earlier Rs 999 / Rs 990 threshold rule). The customer pays the sum of the MRPs and
// nothing else. There is no fee function and no fee table: this one constant is all that is left, read by
// quoteCart (deliveryPaise) and by Shiprocket's shipping_charges. It must stay 0; test/pricing.test.js fails otherwise.
export const DELIVERY_FEE_RUPEES = 0;

// PIN table. No price depends on it: it only checks the address (a valid Indian PIN, the Army Postal 9xxxxx
// range refused, and a PIN that clearly contradicts the chosen state caught as a typo), so Shiprocket gets
// a deliverable address and the right state. The longest matching prefix wins.
// Source: India Post PIN allocation (first two digits): 50 = Telangana, 51-53 = Andhra Pradesh
// (Wikipedia "Postal Index Number", checked 11-11-2026). Notes:
//  - 510-514 are not allotted; AP runs 515-535.
//  - The seven mandals moved from Khammam to AP in 2014 kept their 507xxx PINs: AP or Telangana both pass.
//  - Yanam (533464) is Puducherry inside AP's Kakinada district: Puducherry, AP or Telangana all pass.
//  - Everything else in India (1xxxxx-8xxxxx) is the "rest of India" band. 9xxxxx is the Army Postal
//    Service, which couriers cannot reach, so the form rejects it.
export const PIN_TABLE = Object.freeze([
  Object.freeze({ prefix: "50", state: "Telangana", band: "AP_TS" }),
  Object.freeze({ prefix: "51", state: "Andhra Pradesh", band: "AP_TS" }),
  Object.freeze({ prefix: "52", state: "Andhra Pradesh", band: "AP_TS" }),
  Object.freeze({ prefix: "53", state: "Andhra Pradesh", band: "AP_TS" }),
  Object.freeze({ prefix: "533464", state: "Puducherry", band: "AP_TS" }),
]);

export const PIN_RE = /^[1-8][0-9]{5}$/;

export function pinInfo(pin) {
  const p = String(pin ?? "").trim();
  if (!PIN_RE.test(p)) return null;
  let best = null;
  for (const row of PIN_TABLE) {
    if (p.startsWith(row.prefix) && (!best || row.prefix.length > best.prefix.length)) best = row;
  }
  return best ? { pin: p, state: best.state, band: best.band } : { pin: p, state: null, band: "REST" };
}

const AP_TS = new Set(["Andhra Pradesh", "Telangana"]);

// true when the PIN and the chosen state clearly disagree (a typo that would misroute the parcel)
export function pinStateMismatch(pin, state) {
  const info = pinInfo(pin);
  if (!info || !state) return false;
  if (info.band === "AP_TS") return !(AP_TS.has(state) || state === info.state);
  return AP_TS.has(state);
}

// Prices a cart from CATALOGUE. items = [{code, qty}] or {CODE: qty}. Amounts in paise (integers).
// total = the sum of MRP x qty, whatever the PIN (the PIN is checked by validate.js, not priced).
export function quoteCart(items) {
  const list = Array.isArray(items)
    ? items
    : Object.entries(items || {}).map(([code, qty]) => ({ code, qty }));
  const errors = [];
  const merged = new Map();
  for (const it of list) {
    const code = String(it?.code ?? "").toUpperCase();
    const qty = it?.qty;
    const item = CATALOGUE[code];
    if (!item) { errors.push({ field: "items", code: "unknown_item", item: code.slice(0, 8) }); continue; }
    if (!item.sellable) { errors.push({ field: "items", code: "not_sellable", item: code }); continue; }
    if (!Number.isInteger(qty) || qty < 1) { errors.push({ field: "items", code: "bad_qty", item: code }); continue; }
    merged.set(code, (merged.get(code) || 0) + qty);
  }
  const lines = [];
  let packs = 0;
  let subtotalRupees = 0;
  for (const [code, qty] of merged) {
    if (qty > LIMITS.maxQtyPerLine) errors.push({ field: "items", code: "qty_over_limit", item: code });
    const { name, mrp, hsn } = CATALOGUE[code];
    lines.push({ code, sku: skuOf(code), name, grams: PACK_GRAMS, qty, unitPaise: mrp * 100, totalPaise: mrp * qty * 100, hsn });
    packs += qty;
    subtotalRupees += mrp * qty;
  }
  if (!lines.length && !errors.length) errors.push({ field: "items", code: "empty_cart" });
  if (packs > LIMITS.maxPacksPerOrder) errors.push({ field: "items", code: "too_many_packs" });
  return {
    ok: errors.length === 0,
    errors,
    lines,
    packs,
    subtotalPaise: subtotalRupees * 100,
    deliveryPaise: DELIVERY_FEE_RUPEES * 100, // always 0: stored on the order and sent to Shiprocket as shipping_charges
    totalPaise: (subtotalRupees + DELIVERY_FEE_RUPEES) * 100, // = sum of MRP x qty
  };
}

// Parcel for Shiprocket (weight kg, dimensions cm). Measured parcels: 1 pouch about 0.6 kg in the
// 10x12 in tamper-proof bag (30x25x5 cm); 2 pouches 1.18 kg in a 30x22x8 box; 3 pouches 1.9 kg in a
// 26x21x13 box. Above 3 it is an estimate and the owner alert says "check the box before booking".
const PARCELS = [
  null,
  { weightKg: 0.6, lengthCm: 30, breadthCm: 25, heightCm: 5 },
  { weightKg: 1.18, lengthCm: 30, breadthCm: 22, heightCm: 8 },
  { weightKg: 1.9, lengthCm: 26, breadthCm: 21, heightCm: 13 },
];
export function parcelFor(packs) {
  if (!Number.isInteger(packs) || packs < 1) throw new Error("parcelFor: packs must be >= 1");
  if (packs < PARCELS.length) return { ...PARCELS[packs], estimated: false };
  const extra = packs - 3;
  return {
    weightKg: Math.round((1.9 + 0.62 * extra) * 100) / 100,
    lengthCm: 30, breadthCm: 26, heightCm: 13 + 5 * extra,
    estimated: true,
  };
}

export const rupees = (paise) => paise / 100;

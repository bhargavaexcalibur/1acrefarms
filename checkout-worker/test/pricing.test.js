// Prices, no delivery fee (total = sum of MRPs), the AP/TS PIN check, limits, parcels, form validation, and drift vs app.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { CATALOGUE, DELIVERY_FEE_RUPEES, GST_PCT, PIN_TABLE, parcelFor, pinInfo, pinStateMismatch, quoteCart, skuOf, unitPaisePerGram } from "../src/pricing.js";
import { normalisePhone, validateCustomer } from "../src/validate.js";
import { CUSTOMER } from "./helpers/harness.js";

test("server price table = the Amazon MRPs in the brief", () => {
  const mrp = Object.fromEntries(Object.entries(CATALOGUE).map(([k, v]) => [k, v.mrp]));
  assert.deepEqual(mrp, { TURM: 396, KPAS: 495, SANN: 495, TEJA: 495, CBEL: 234, TBEL: 495, CASH: 891 });
  assert.equal(CATALOGUE.CASH.sellable, true, "cashew on sale since 13-11-2026");
  assert.equal(skuOf("TURM"), "1AF-TURM-0540");
});

test("what can be ordered: one flag per pack; all 7 packs on sale since 13-11-2026 (chilli + cashew go-live)", () => {
  const sellable = Object.keys(CATALOGUE).filter((c) => CATALOGUE[c].sellable);
  assert.deepEqual(sellable, ["TURM", "KPAS", "SANN", "TEJA", "CBEL", "TBEL", "CASH"]);
  for (const code of ["SANN", "TEJA", "CASH"]) assert.deepEqual(quoteCart([{ code, qty: 1 }]).errors, [], code);
  // a pack switched off again ("sellable": false) is refused: checked for every such pack (none right now)
  for (const code of Object.keys(CATALOGUE).filter((c) => !CATALOGUE[c].sellable)) {
    assert.equal(CATALOGUE[code].sellable, false, code);
    assert.deepEqual(quoteCart([{ code, qty: 1 }]).errors.map((e) => e.code), ["not_sellable"], code);
  }
  // HSN as on record in docs/invoices/sales/templates/make_invoice.py (chillies 0904 22 11 chilly powder;
  // cashew 0801 32 20 cashew kernel, whole), never invented
  assert.deepEqual(Object.fromEntries(Object.entries(CATALOGUE).map(([k, v]) => [k, v.hsn])),
    { TURM: "09103030", KPAS: "09103030", SANN: "09042211", TEJA: "09042211", CBEL: "17011310", TBEL: "17029010", CASH: "08013220" });
  // switching a pack on is one line: the page and the Meta link both read CATALOGUE[code].sellable
  const page = readFileSync(new URL("../../checkout-test/checkout.js", import.meta.url), "utf8");
  assert.match(page, /Object\.entries\(CATALOGUE\)\.filter\(\(\[, p\]\) => p\.sellable\)/);
  const link = readFileSync(new URL("../src/cart-link.js", import.meta.url), "utf8");
  assert.match(link, /CATALOGUE\[code\]\.sellable/);
});

test("each pack links to its product page (slug), and that page exists in the site", () => {
  const want = { TURM: "turmeric-powder", KPAS: "hill-turmeric-powder", SANN: "sannam-chilli-powder", TEJA: "teja-chilli-powder",
    CBEL: "cane-jaggery", TBEL: "palm-jaggery", CASH: "cashew-kernels" };
  assert.deepEqual(Object.fromEntries(Object.entries(CATALOGUE).map(([k, v]) => [k, v.slug])), want);
  for (const slug of Object.values(want)) assert.ok(existsSync(new URL(`../../${slug}/index.html`, import.meta.url)), slug);
});

test("unit sale price per gram (2 decimals, half-up), as on the product pages", () => {
  const per = Object.fromEntries(Object.entries(CATALOGUE).map(([k, v]) => [k, unitPaisePerGram(v.mrp)]));
  assert.deepEqual(per, { TURM: 73, KPAS: 92, SANN: 92, TEJA: 92, CBEL: 43, TBEL: 92, CASH: 165 });
  assert.equal(unitPaisePerGram(396, 540), 73);
  assert.equal(unitPaisePerGram(1, 200), 1, "0.5 paise rounds up");
  assert.throws(() => unitPaisePerGram(396, 0));
  assert.equal(GST_PCT, 5);
});

test("server price table matches the 540 g MRPs in the site's app.js (drift guard)", () => {
  const app = readFileSync(new URL("../../app.js", import.meta.url), "utf8");
  for (const [code, item] of Object.entries(CATALOGUE)) {
    const block = app.slice(app.indexOf(`code: "${code}"`));
    const m = block.match(/\[540,\s*(\d+)/);
    assert.ok(m, `540 g SKU for ${code} found in app.js`);
    assert.equal(Number(m[1]), item.mrp, `${code} MRP in app.js`);
  }
});

// Owner 11-11-2026: "lets never charge our customers other than MRP". No delivery fee at any order value, anywhere.
test("no delivery fee: the fee machinery is gone, one constant is left and it is 0", async () => {
  assert.equal(DELIVERY_FEE_RUPEES, 0);
  const mod = await import("../src/pricing.js");
  for (const gone of ["DELIVERY", "deliveryFeeRupees"]) assert.equal(gone in mod, false, `${gone} no longer exists`);
});

test("any basket, any PIN: fee 0, total = sum of MRP x qty (outside a website offer)", () => {
  const AT_MRP = Date.parse("2026-11-12T10:00:00+05:30"); // before the 25-11 offer
  const codes = Object.keys(CATALOGUE).filter((c) => CATALOGUE[c].sellable);
  const pins = ["522601", "500081", "507111", "533464", "110001", "560001", "799001", "", "999999"];
  // every single pack at qty 1..3, every pair of packs, and the 12-pack maximum
  const baskets = [];
  for (const a of codes) for (let q = 1; q <= 3; q++) baskets.push([{ code: a, qty: q }]);
  for (const a of codes) for (const b of codes) if (a < b) baskets.push([{ code: a, qty: 1 }, { code: b, qty: 1 }]);
  baskets.push([{ code: "TURM", qty: 6 }, { code: "CBEL", qty: 6 }]);
  let checked = 0;
  for (const items of baskets) {
    const want = items.reduce((sum, i) => sum + CATALOGUE[i.code].mrp * i.qty, 0) * 100;
    for (const pin of pins) {
      const q = quoteCart(items, AT_MRP); // the PIN never changes the price
      assert.equal(q.ok, true);
      assert.equal(q.deliveryPaise, 0, `fee for ${JSON.stringify(items)} to ${pin}`);
      assert.equal(q.subtotalPaise, want);
      assert.equal(q.totalPaise, want, `total for ${JSON.stringify(items)} to ${pin}`);
      checked++;
    }
  }
  assert.equal(checked, baskets.length * pins.length);
  assert.ok(checked > 150, "every sellable pack, every pair, the 12-pack maximum, 9 PINs");
  // the cheapest order (1 cane jaggery) is Rs 234 flat, to AP and to Delhi alike; two Rs 495 packs are Rs 990
  assert.equal(quoteCart([{ code: "CBEL", qty: 1 }], AT_MRP).totalPaise, 23400);
  assert.equal(quoteCart([{ code: "CBEL", qty: 1 }], AT_MRP).totalPaise, 23400);
  assert.equal(quoteCart([{ code: "KPAS", qty: 1 }, { code: "TBEL", qty: 1 }], AT_MRP).totalPaise, 99000);
  assert.equal(quoteCart([{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], AT_MRP).totalPaise, 102600, "no PIN needed to know the total");
  assert.deepEqual(Object.keys(quoteCart([{ code: "TURM", qty: 1 }], AT_MRP)).sort(),
    ["deliveryPaise", "errors", "lines", "mrpTotalPaise", "offer", "ok", "packs", "savedPaise", "subtotalPaise", "totalPaise"],
    "no band / shortfall fields left");
  assert.equal(quoteCart([{ code: "TURM", qty: 1 }], AT_MRP).savedPaise, 0);
});

test("PIN table: AP/TS prefixes, rest of India, Army Postal 9xxxxx refused (address check only, no price)", () => {
  const band = (p) => pinInfo(p)?.band ?? "INVALID";
  const state = (p) => pinInfo(p)?.state ?? null;
  assert.equal(band("500001"), "AP_TS"); assert.equal(state("500001"), "Telangana");
  assert.equal(band("509001"), "AP_TS"); assert.equal(state("509001"), "Telangana");
  assert.equal(band("515001"), "AP_TS"); assert.equal(state("515001"), "Andhra Pradesh");
  assert.equal(band("522601"), "AP_TS"); assert.equal(state("522601"), "Andhra Pradesh");
  assert.equal(band("530001"), "AP_TS");
  assert.equal(band("535001"), "AP_TS");
  assert.equal(band("533464"), "AP_TS"); assert.equal(state("533464"), "Puducherry", "Yanam: longest prefix wins");
  assert.equal(band("499999"), "REST");
  assert.equal(band("540001"), "REST");
  assert.equal(band("560001"), "REST", "Bengaluru");
  assert.equal(band("600001"), "REST", "Chennai");
  assert.equal(band("110001"), "REST", "Delhi");
  assert.equal(band("900001"), "INVALID", "Army Postal Service: not deliverable by courier");
  assert.equal(band("012345"), "INVALID");
  assert.equal(band("52260"), "INVALID");
  assert.equal(band("5226011"), "INVALID");
  assert.equal(band(" 522601 "), "AP_TS", "spaces trimmed");
  assert.deepEqual(PIN_TABLE.map((r) => r.prefix), ["50", "51", "52", "53", "533464"]);
});

test("PIN vs state consistency", () => {
  assert.equal(pinStateMismatch("522601", "Andhra Pradesh"), false);
  assert.equal(pinStateMismatch("507111", "Andhra Pradesh"), false, "AP mandals that kept 507 PINs");
  assert.equal(pinStateMismatch("500001", "Telangana"), false);
  assert.equal(pinStateMismatch("522601", "Karnataka"), true);
  assert.equal(pinStateMismatch("560001", "Andhra Pradesh"), true);
  assert.equal(pinStateMismatch("533464", "Puducherry"), false);
  assert.equal(pinStateMismatch("605001", "Puducherry"), false);
  assert.equal(pinStateMismatch("110001", "Delhi"), false);
});

test("cart rules: client prices ignored, unknown/parked items, limits, merge", () => {
  const AT_MRP = Date.parse("2026-11-12T10:00:00+05:30"); // before the 25-11 website offer
  const q = quoteCart([{ code: "turm", qty: 1, price: 1, unitPaise: 100 }, { code: "TURM", qty: 1 }], AT_MRP);
  assert.equal(q.ok, true);
  assert.equal(q.lines.length, 1, "same code merged");
  assert.equal(q.lines[0].qty, 2);
  assert.equal(q.lines[0].unitPaise, 39600, "price from the server table only");
  assert.deepEqual(quoteCart([{ code: "XXXX", qty: 1 }], AT_MRP).errors.map((e) => e.code), ["unknown_item"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 0 }], AT_MRP).errors.map((e) => e.code), ["bad_qty"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 1.5 }], AT_MRP).errors.map((e) => e.code), ["bad_qty"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: "2" }], AT_MRP).errors.map((e) => e.code), ["bad_qty"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 11 }], AT_MRP).errors.map((e) => e.code), ["qty_over_limit"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 7 }, { code: "CBEL", qty: 6 }], AT_MRP).errors.map((e) => e.code), ["too_many_packs"]);
  assert.deepEqual(quoteCart([], AT_MRP).errors.map((e) => e.code), ["empty_cart"]);
  assert.deepEqual(quoteCart({ TURM: 1, CBEL: 2 }, AT_MRP).lines.map((l) => [l.code, l.qty]), [["TURM", 1], ["CBEL", 2]]);
});

test("parcel weights and sizes", () => {
  assert.deepEqual(parcelFor(1), { weightKg: 0.6, lengthCm: 30, breadthCm: 25, heightCm: 5, estimated: false });
  assert.equal(parcelFor(2).weightKg, 1.18);
  assert.equal(parcelFor(3).weightKg, 1.9);
  assert.equal(parcelFor(5).weightKg, 3.14);
  assert.equal(parcelFor(5).estimated, true);
  assert.throws(() => parcelFor(0));
});

test("address form validation", () => {
  const ok = validateCustomer(CUSTOMER);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.phone, "9876543210");
  assert.equal(normalisePhone("+91 98765-43210"), "9876543210");
  assert.equal(normalisePhone("09876543210"), "9876543210");
  assert.equal(normalisePhone("919876543210"), "9876543210");
  assert.equal(normalisePhone("5876543210"), null, "Indian mobiles start 6-9");
  assert.equal(normalisePhone("98765"), null);
  const bad = validateCustomer({ name: "A", phone: "123", email: "x@y", address: "short", city: "", state: "Narnia", pin: "999999" });
  assert.deepEqual(bad.errors.map((e) => `${e.field}:${e.code}`), [
    "name:required", "phone:invalid", "email:invalid", "address:too_short", "city:required", "state:invalid", "pin:invalid",
  ]);
  const mismatch = validateCustomer({ ...CUSTOMER, state: "Karnataka" });
  assert.deepEqual(mismatch.errors.map((e) => `${e.field}:${e.code}`), ["pin:state_mismatch"]);
  assert.equal(validateCustomer({ ...CUSTOMER, address: "<script>alert(1)</script> road" }).ok, false);
  assert.equal(validateCustomer(null).ok, false);
});

// Website offer 25-11-2026 -> end of 24-12-2026 (catalogue.json "offer"; Bhargava via Shiva 25-11: "go 9%, except the cane jaggery").
test("website offer: offer price only inside its window, never cane jaggery, never above MRP", async () => {
  const { OFFER, offerActive, offerProblems, unitRupees, NO_DISCOUNT } = await import("../src/pricing.js");
  assert.ok(OFFER, "the offer block is valid (no problems)");
  assert.deepEqual(offerProblems(await import("../src/catalogue.json", { with: { type: "json" } }).then((m) => m.default)), []);
  const before = Date.parse("2026-11-24T23:59:59+05:30");
  const first = Date.parse("2026-11-25T00:00:00+05:30");
  const last = Date.parse("2026-12-24T23:59:59+05:30");
  const after = Date.parse("2026-12-25T00:00:00+05:30");
  assert.equal(offerActive(before), false);
  assert.equal(offerActive(first), true);
  assert.equal(offerActive(last), true);
  assert.equal(offerActive(after), false, "ends at the end of 24-12 (IST)");
  const want = { TURM: 360, KPAS: 450, SANN: 450, TEJA: 450, TBEL: 450, CASH: 810, CBEL: 234 };
  for (const [code, price] of Object.entries(want)) {
    assert.equal(unitRupees(code, first), price, `${code} on offer`);
    assert.equal(unitRupees(code, before), CATALOGUE[code].mrp, `${code} at MRP before`);
    assert.equal(unitRupees(code, after), CATALOGUE[code].mrp, `${code} at MRP after`);
    assert.ok(unitRupees(code, first) <= CATALOGUE[code].mrp, `${code} never above MRP`);
  }
  assert.ok(NO_DISCOUNT.includes("CBEL"));
  // one hill turmeric during the offer = Rs 450, MRP 495 kept on the line; mixed cart with cane jaggery
  const q1 = quoteCart([{ code: "KPAS", qty: 1 }], first);
  assert.equal(q1.totalPaise, 45000);
  assert.equal(q1.lines[0].mrpPaise, 49500);
  assert.equal(q1.savedPaise, 4500);
  assert.equal(q1.offer, "Website offer");
  const q2 = quoteCart([{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }], first);
  assert.equal(q2.totalPaise, 2 * 36000 + 23400);
  assert.equal(q2.mrpTotalPaise, 102600);
  assert.equal(quoteCart([{ code: "CBEL", qty: 2 }], first).savedPaise, 0, "cane jaggery alone: no offer");
  assert.equal(quoteCart([{ code: "CBEL", qty: 2 }], first).offer, null);
});

test("website offer: a broken offer block is refused (fail closed to MRP)", async () => {
  const { offerProblems } = await import("../src/pricing.js");
  const packs = [{ code: "TURM", mrp: 396 }, { code: "CBEL", mrp: 234 }];
  const base = { label: "x", start: "2026-11-25T00:00:00+05:30", end: "2026-12-25T00:00:00+05:30" };
  assert.deepEqual(offerProblems({ packs, offer: { ...base, prices: { TURM: 360 } } }), []);
  assert.match(offerProblems({ packs, offer: { ...base, prices: { CBEL: 225 } } })[0], /never discounted/);
  assert.match(offerProblems({ packs, offer: { ...base, prices: { TURM: 396 } } })[0], /below its MRP/);
  assert.match(offerProblems({ packs, offer: { ...base, prices: { TURM: 361 } } })[0], /Rule of Nine/);
  assert.match(offerProblems({ packs, offer: { ...base, prices: { XXXX: 9 } } })[0], /not in the catalogue/);
  assert.match(offerProblems({ packs, offer: { ...base, end: base.start, prices: { TURM: 360 } } })[0], /start before end/);
});

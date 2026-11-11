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
  assert.equal(CATALOGUE.CASH.sellable, false, "cashew is parked");
  assert.equal(skuOf("TURM"), "1AF-TURM-0540");
});

test("what can be ordered: one flag per pack; Sannam and Teja held, cashew parked (G12)", () => {
  const sellable = Object.keys(CATALOGUE).filter((c) => CATALOGUE[c].sellable);
  assert.deepEqual(sellable, ["TURM", "KPAS", "CBEL", "TBEL"]);
  for (const code of ["SANN", "TEJA", "CASH"]) {
    assert.equal(CATALOGUE[code].sellable, false, code);
    assert.deepEqual(quoteCart([{ code, qty: 1 }]).errors.map((e) => e.code), ["not_sellable"], code);
  }
  // HSN stays as on record: blank for the chillies and cashew (not sellable), never invented
  assert.deepEqual(Object.fromEntries(Object.entries(CATALOGUE).map(([k, v]) => [k, v.hsn])),
    { TURM: "09103030", KPAS: "09103030", SANN: "", TEJA: "", CBEL: "17011310", TBEL: "17029010", CASH: "" });
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

test("any basket, any PIN: fee 0, total = sum of MRP x qty", () => {
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
      const q = quoteCart(items, pin);
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
  assert.equal(quoteCart([{ code: "CBEL", qty: 1 }], "522601").totalPaise, 23400);
  assert.equal(quoteCart([{ code: "CBEL", qty: 1 }], "110001").totalPaise, 23400);
  assert.equal(quoteCart([{ code: "KPAS", qty: 1 }, { code: "TBEL", qty: 1 }], "500081").totalPaise, 99000);
  assert.equal(quoteCart([{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }]).totalPaise, 102600, "no PIN needed to know the total");
  assert.deepEqual(Object.keys(quoteCart([{ code: "TURM", qty: 1 }], "522601")).sort(),
    ["deliveryPaise", "errors", "lines", "ok", "packs", "subtotalPaise", "totalPaise"], "no band / shortfall fields left");
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
  const q = quoteCart([{ code: "turm", qty: 1, price: 1, unitPaise: 100 }, { code: "TURM", qty: 1 }], "522601");
  assert.equal(q.ok, true);
  assert.equal(q.lines.length, 1, "same code merged");
  assert.equal(q.lines[0].qty, 2);
  assert.equal(q.lines[0].unitPaise, 39600, "price from the server table only");
  assert.deepEqual(quoteCart([{ code: "CASH", qty: 1 }], "522601").errors.map((e) => e.code), ["not_sellable"]);
  assert.deepEqual(quoteCart([{ code: "XXXX", qty: 1 }], "522601").errors.map((e) => e.code), ["unknown_item"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 0 }], "522601").errors.map((e) => e.code), ["bad_qty"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 1.5 }], "522601").errors.map((e) => e.code), ["bad_qty"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: "2" }], "522601").errors.map((e) => e.code), ["bad_qty"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 11 }], "522601").errors.map((e) => e.code), ["qty_over_limit"]);
  assert.deepEqual(quoteCart([{ code: "TURM", qty: 7 }, { code: "CBEL", qty: 6 }], "522601").errors.map((e) => e.code), ["too_many_packs"]);
  assert.deepEqual(quoteCart([], "522601").errors.map((e) => e.code), ["empty_cart"]);
  assert.deepEqual(quoteCart({ TURM: 1, CBEL: 2 }, "522601").lines.map((l) => [l.code, l.qty]), [["TURM", 1], ["CBEL", 2]]);
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

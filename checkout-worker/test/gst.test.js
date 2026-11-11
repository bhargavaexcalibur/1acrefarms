// G09: GST shown inside the MRP (display only). Numbers = our invoices 1AF/26-27/0001-0003 and the audit's worked examples.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOGUE, quoteCart } from "../src/pricing.js";
import { INDIAN_STATES } from "../src/validate.js";
import { HOME_STATE, cgstPerUnitPaise, gstBreakup, igstPerUnitPaise } from "../src/gst.js";
import { gstLine } from "../src/confirmation.js";

const line = (code, qty) => ({ unitPaise: CATALOGUE[code].mrp * 100, qty });

test("per unit: CGST = SGST = MRP/42, IGST = MRP/21, rounded to the paisa", () => {
  // [MRP, CGST (= SGST), IGST] in paise
  for (const [mrp, cgst, igst] of [[396, 943, 1886], [495, 1179, 2357], [234, 557, 1114], [891, 2121, 4243]]) {
    assert.equal(cgstPerUnitPaise(mrp * 100), cgst, `CGST on ${mrp}`);
    assert.equal(igstPerUnitPaise(mrp * 100), igst, `IGST on ${mrp}`);
  }
  assert.equal(HOME_STATE, "Andhra Pradesh");
});

test("Andhra Pradesh delivery: CGST 2.5% + SGST 2.5%; worked examples", () => {
  const t = gstBreakup([line("TURM", 1)], "Andhra Pradesh");
  assert.deepEqual([t.kind, t.cgstPaise, t.sgstPaise, t.igstPaise, t.taxPaise, t.totalPaise, t.taxablePaise], ["intra", 943, 943, 0, 1886, 39600, 37714]);
  const k = gstBreakup([line("KPAS", 1)], "Andhra Pradesh");
  assert.deepEqual([k.cgstPaise, k.sgstPaise, k.taxPaise, k.taxablePaise], [1179, 1179, 2358, 47142], "Rs 495: 11.79 + 11.79, taxable 471.42 (invoice 0003)");
  const c = gstBreakup([line("CBEL", 1)], "Andhra Pradesh");
  assert.deepEqual([c.cgstPaise, c.sgstPaise], [557, 557], "Rs 234: 5.57 + 5.57 (invoice 0002)");
});

test("quantity: per-unit tax x qty, like invoice 0003 (4 x cane jaggery CGST 22.28, not 936/42 = 22.29)", () => {
  const g = gstBreakup([line("CBEL", 4)], "Andhra Pradesh");
  assert.equal(g.cgstPaise, 2228);
  assert.equal(g.sgstPaise, 2228);
  assert.equal(gstBreakup([line("TBEL", 4)], "Andhra Pradesh").cgstPaise, 4716, "4 x palm jaggery 47.16 (invoice 0003)");
  const mixed = gstBreakup([line("TURM", 2), line("CBEL", 1)], "Andhra Pradesh");
  assert.equal(mixed.cgstPaise, 2 * 943 + 557);
  assert.equal(mixed.totalPaise, 102600);
  assert.equal(gstBreakup([line("CBEL", 4)], "Delhi").igstPaise, 4456, "IGST 11.14 x 4");
});

test("any other state: IGST 5%; worked examples", () => {
  for (const [code, igst] of [["TURM", 1886], ["KPAS", 2357], ["TBEL", 2357], ["CBEL", 1114]]) {
    const g = gstBreakup([line(code, 1)], "Telangana");
    assert.deepEqual([g.kind, g.igstPaise, g.cgstPaise, g.sgstPaise, g.taxPaise], ["inter", igst, 0, 0, igst], code);
  }
  assert.equal(gstBreakup([line("KPAS", 1)], "Karnataka").taxablePaise, 47143);
});

test("no state yet (or not a state): rate only, no amounts", () => {
  for (const st of [undefined, null, "", "  ", "Narnia", "andhra pradesh"]) {
    const g = gstBreakup([line("TURM", 1)], st);
    assert.equal(g.kind, "unknown", String(st));
    assert.equal(g.ratePct, 5);
    assert.equal(g.taxPaise, null);
    assert.equal(g.totalPaise, 39600);
  }
});

test("display only: the total is always the sum of MRP x qty, for every state", () => {
  const q = quoteCart([{ code: "TURM", qty: 3 }, { code: "KPAS", qty: 2 }, { code: "CBEL", qty: 4 }, { code: "TBEL", qty: 3 }]);
  assert.equal(q.ok, true);
  for (const st of ["", ...INDIAN_STATES]) {
    const g = gstBreakup(q.lines, st);
    assert.equal(g.totalPaise, q.totalPaise, st);
    if (g.taxPaise !== null) {
      assert.equal(g.taxablePaise + g.taxPaise, q.totalPaise);
      assert.ok(g.taxPaise > 0 && g.taxPaise < q.totalPaise * 0.05, `tax is inside the MRP (${st})`);
    }
  }
});

test("summary / e-mail wording", () => {
  assert.equal(gstLine(gstBreakup([line("TURM", 1)], "Andhra Pradesh")), "GST included in the MRP: ₹18.86 (CGST 2.5% ₹9.43 + SGST 2.5% ₹9.43)");
  assert.equal(gstLine(gstBreakup([line("KPAS", 1)], "Andhra Pradesh")), "GST included in the MRP: ₹23.58 (CGST 2.5% ₹11.79 + SGST 2.5% ₹11.79)");
  assert.equal(gstLine(gstBreakup([line("TURM", 1)], "Kerala")), "GST included in the MRP: ₹18.86 (IGST 5%)");
  assert.equal(gstLine(gstBreakup([line("KPAS", 1)], "Delhi")), "GST included in the MRP: ₹23.57 (IGST 5%)");
  assert.equal(gstLine(gstBreakup([line("CBEL", 1)], "Delhi")), "GST included in the MRP: ₹11.14 (IGST 5%)");
  assert.equal(gstLine(gstBreakup([line("TURM", 1)], "")), "GST included in the MRP (5%)");
});

// GST break-up of an order, for DISPLAY only (checkout summary and the customer e-mail). The price never changes:
// the customer pays the sum of MRP x qty, and the MRP already includes GST. Pure function, no I/O; the hidden page
// imports this same file, so the page, the e-mail and our invoices show the same figures.
//
// Method = our GST invoices (1AF/26-27/0001-0003): tax is worked out PER UNIT from the GST-inclusive MRP, rounded
// to the paisa, then multiplied by the quantity.
//   Delivery in Andhra Pradesh (our state): CGST = SGST = MRP x 2.5/105 = MRP/42 per unit.
//     Rs 396 -> 9.43 + 9.43; Rs 495 -> 11.79 + 11.79; Rs 234 -> 5.57 + 5.57; 4 x cane jaggery -> CGST 22.28 (invoice 0003).
//   Delivery anywhere else: IGST = MRP x 5/105 = MRP/21 per unit. Rs 396 -> 18.86; Rs 495 -> 23.57; Rs 234 -> 11.14.
//   TODO(ChittaGupta): IGST rounding to be confirmed before the first inter-state invoice (no IGST invoice on record).
//   No state chosen yet: only the rate is shown ("GST included in the MRP (5%)").
import { GST_PCT } from "./pricing.js";
import { INDIAN_STATES } from "./validate.js";

export const HOME_STATE = "Andhra Pradesh"; // seller's GSTIN state (37): delivery here = intra-state supply

// a / b rounded half-up, for non-negative integers (no floating point anywhere in the tax maths)
const roundDiv = (a, b) => Math.floor((2 * a + b) / (2 * b));

// Per-unit tax in paise on a GST-inclusive unit price (paise), at `pct` percent.
export const cgstPerUnitPaise = (unitPaise, pct = GST_PCT) => roundDiv(unitPaise * pct, 2 * (100 + pct)); // = SGST
export const igstPerUnitPaise = (unitPaise, pct = GST_PCT) => roundDiv(unitPaise * pct, 100 + pct);

// lines: [{ unitPaise, qty }] (quoteCart lines or the stored order items). state: the delivery state.
// Returns amounts in paise. kind: "intra" (CGST + SGST), "inter" (IGST) or "unknown" (no valid state yet: no amounts).
export function gstBreakup(lines, state) {
  const list = Array.isArray(lines) ? lines : [];
  const totalPaise = list.reduce((s, l) => s + l.unitPaise * l.qty, 0);
  const ratePct = GST_PCT;
  const st = typeof state === "string" ? state.trim() : "";
  const kind = !INDIAN_STATES.includes(st) ? "unknown" : st === HOME_STATE ? "intra" : "inter";
  const out = { kind, ratePct, halfRatePct: ratePct / 2, totalPaise, cgstPaise: null, sgstPaise: null, igstPaise: null, taxPaise: null, taxablePaise: null };
  if (kind === "unknown") return out;
  if (kind === "intra") {
    const cgst = list.reduce((s, l) => s + cgstPerUnitPaise(l.unitPaise, ratePct) * l.qty, 0);
    Object.assign(out, { cgstPaise: cgst, sgstPaise: cgst, igstPaise: 0, taxPaise: 2 * cgst });
  } else {
    const igst = list.reduce((s, l) => s + igstPerUnitPaise(l.unitPaise, ratePct) * l.qty, 0);
    Object.assign(out, { cgstPaise: 0, sgstPaise: 0, igstPaise: igst, taxPaise: igst });
  }
  out.taxablePaise = totalPaise - out.taxPaise;
  return out;
}

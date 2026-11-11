// Expected delivery window: dispatch 1–2 working days (no Sundays, IST) + the area's usual days from policies.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DELIVERY_ZONES, addWorkingDays, deliveryZones, expectedDelivery, zonesForPin } from "../src/delivery.js";

const at = (s) => Date.parse(s);
const THU = at("2026-11-12T10:00:00+05:30"); // Thursday 12 Nov 2026

test("areas and days are policies.html's: 1–3 / 3–5 / 4–10", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DELIVERY_ZONES).map(([k, z]) => [k, [...z.days]])),
    { GNT_PLN: [1, 3], AP_SOUTH: [3, 5], REST: [4, 10] });
});

test("PIN -> areas", () => {
  assert.deepEqual(zonesForPin("522601"), ["GNT_PLN", "AP_SOUTH"], "Narasaraopet: 522 is Guntur + Palnadu but also part of Bapatla");
  assert.deepEqual(zonesForPin("522002"), ["GNT_PLN", "AP_SOUTH"]);
  for (const pin of ["530001", "520001", "515001", "507111", "500081", "533464"]) assert.deepEqual(zonesForPin(pin), ["AP_SOUTH"], pin);
  for (const pin of ["560001", "590001", "600001", "605001", "641001", "682001", "695001"]) assert.deepEqual(zonesForPin(pin), ["AP_SOUTH"], pin);
  for (const pin of ["110001", "400001", "700001", "799001", "744101", "403001"]) assert.deepEqual(zonesForPin(pin), ["REST"], pin);
  for (const pin of ["999999", "012345", "52260", ""]) assert.equal(zonesForPin(pin), null, pin);
});

test("PIN + state: agreement narrows, disagreement (or an ambiguous PIN) takes the wider range", () => {
  const days = (pin, state) => expectedDelivery({ paidAt: THU, pin, state }).days;
  assert.deepEqual(days("522601", "Andhra Pradesh"), [1, 5], "ambiguous 522: 1–3 or 3–5 -> 1–5");
  assert.deepEqual(days("530001", "Andhra Pradesh"), [3, 5], "Visakhapatnam: rest of AP");
  assert.deepEqual(days("500081", "Telangana"), [3, 5]);
  assert.deepEqual(days("560001", "Karnataka"), [3, 5]);
  assert.deepEqual(days("600001", "Tamil Nadu"), [3, 5]);
  assert.deepEqual(days("605001", "Puducherry"), [3, 5]);
  assert.deepEqual(days("533464", "Andhra Pradesh"), [3, 5], "Yanam, written as AP");
  assert.deepEqual(days("110001", "Delhi"), [4, 10]);
  assert.deepEqual(days("110001", "Karnataka"), [3, 10], "PIN says Delhi, state says Karnataka: wider");
  assert.deepEqual(days("682555", "Lakshadweep"), [3, 10], "Kerala PIN range, Lakshadweep state: wider");
  assert.deepEqual(days("522601", ""), [1, 5], "no state: the PIN alone");
  assert.deepEqual(deliveryZones("522601", "Telangana"), ["AP_SOUTH"]);
  assert.equal(expectedDelivery({ paidAt: THU, pin: "999999", state: "Delhi" }), null);
  assert.equal(expectedDelivery({ paidAt: undefined, pin: "110001", state: "Delhi" }), null);
});

test("dates: paid Thursday 12 Nov 2026 (IST)", () => {
  // dispatch Fri 13 (1st working day) to Sat 14 (2nd); Sunday 15 never counts
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "110001", state: "Delhi" }), { from: "2026-11-18", to: "2026-11-26", days: [4, 10], zones: ["REST"] });
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "522601", state: "Andhra Pradesh" }), { from: "2026-11-14", to: "2026-11-20", days: [1, 5], zones: ["GNT_PLN", "AP_SOUTH"] });
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "530001", state: "Andhra Pradesh" }), { from: "2026-11-17", to: "2026-11-20", days: [3, 5], zones: ["AP_SOUTH"] });
});

test("dates: Sunday payment and the IST day boundary", () => {
  const sun = at("2026-11-15T10:00:00+05:30");
  assert.deepEqual(expectedDelivery({ paidAt: sun, pin: "110001", state: "Delhi" }), { from: "2026-11-20", to: "2026-11-28", days: [4, 10], zones: ["REST"] });
  // 00:30 IST on Saturday 14 Nov is still Friday 13 Nov in UTC: the IST day (Saturday) is day 0
  const satEarly = at("2026-11-14T00:30:00+05:30");
  assert.deepEqual(expectedDelivery({ paidAt: satEarly, pin: "110001", state: "Delhi" }), { from: "2026-11-20", to: "2026-11-28", days: [4, 10], zones: ["REST"] });
  const friLate = at("2026-11-13T23:59:00+05:30");
  assert.deepEqual(expectedDelivery({ paidAt: friLate, pin: "110001", state: "Delhi" }).from, "2026-11-19", "Friday IST: dispatch Sat 14 / Mon 16, earliest Thu 19");
});

test("never a Sunday, never sooner than the policy allows (sweep over 5 weeks, every area)", () => {
  const DAY = 24 * 3600 * 1000;
  const start = at("2026-11-02T09:00:00+05:30");
  for (let i = 0; i < 35 * 4; i++) {
    const paidAt = start + i * DAY / 4;
    for (const [pin, state] of [["522601", "Andhra Pradesh"], ["530001", "Andhra Pradesh"], ["110001", "Delhi"], ["110001", "Kerala"]]) {
      const w = expectedDelivery({ paidAt, pin, state });
      const day0 = Date.parse(new Date(paidAt + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
      const from = Date.parse(w.from);
      const to = Date.parse(w.to);
      assert.notEqual(new Date(from).getUTCDay(), 0, `from on a Sunday: ${w.from}`);
      assert.notEqual(new Date(to).getUTCDay(), 0, `to on a Sunday: ${w.to}`);
      assert.ok(from >= day0 + (1 + w.days[0]) * DAY, `${pin} from ${w.from}`);
      assert.ok(to >= day0 + (2 + w.days[1]) * DAY, `${pin} to ${w.to}`);
      assert.ok(to <= day0 + (2 + w.days[1]) * DAY * 7 / 6 + 2 * DAY, "only Sundays are skipped");
      assert.ok(from <= to);
    }
  }
  assert.equal(new Date(addWorkingDays(Date.parse("2026-11-14"), 1)).toISOString().slice(0, 10), "2026-11-16", "Saturday + 1 working day = Monday");
});

// Expected delivery window: we ship the next working day (Monday to Saturday, IST; Saturday and Sunday orders ship on
// Monday) + the area's usual days from policies.html (2–4 AP & Telangana, 4–7 rest of India, up to 10 remote); an
// earliest date on a Sunday is shown as the Monday after it, the latest date is never moved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DELIVERY_ZONES, DISPATCH_WORKING_DAYS, addWorkingDays, deliveryZones, expectedDelivery, zonesForPin, zonesForState } from "../src/delivery.js";
import { INDIAN_STATES } from "../src/validate.js";

const DAY = 24 * 3600 * 1000;
const at = (s) => Date.parse(s);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const THU = at("2026-11-12T10:00:00+05:30"); // Thursday 12 Nov 2026
// The day the parcel ships, read back from the window (Delhi: 7 calendar days after dispatch at the latest; the latest
// date is never moved, unlike the earliest).
const shipsOn = (paidAt) => iso(Date.parse(expectedDelivery({ paidAt, pin: "110001", state: "Delhi" }).to) - 7 * DAY);

test("areas and days are policies.html's: 2–4 / 4–7 / up to 10; dispatch on the next working day", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(DELIVERY_ZONES).map(([k, z]) => [k, [...z.days]])),
    { AP_TS: [2, 4], REST: [4, 7], REMOTE: [4, 10] });
  assert.deepEqual([...DISPATCH_WORKING_DAYS], [1, 1]);
  // the policies.html table, row by row: the same areas, the same days
  const html = readFileSync(new URL("../../policies.html", import.meta.url), "utf8");
  const table = html.slice(html.indexOf("Usual delivery time after dispatch"), html.indexOf("</table>", html.indexOf("Usual delivery time after dispatch")));
  const rows = [...table.matchAll(/<tr><th scope="row">(.*?)<\/th><td>(.*?)<\/td><\/tr>/g)].map((m) => [m[1].replace(/&amp;/g, "&"), m[2]]);
  assert.deepEqual(rows, [
    [DELIVERY_ZONES.AP_TS.area, "2–4 days"],
    [DELIVERY_ZONES.REST.area, "4–7 days"],
    [DELIVERY_ZONES.REMOTE.area, "up to 10 days"],
  ]);
});

test("PIN -> area", () => {
  // AP/TS band of the pricing.js PIN table: 50 Telangana, 51-53 Andhra Pradesh, 533464 Yanam
  for (const pin of ["522601", "522002", "530001", "520001", "515001", "507111", "500001", "500081", "533464"]) assert.deepEqual(zonesForPin(pin), ["AP_TS"], pin);
  // remote, by India Post prefix: Assam 78, the other North-East states 79, J&K and Ladakh 18-19, Sikkim 737,
  // Andaman & Nicobar 744, Lakshadweep 682551-682559
  for (const pin of ["781001", "785001", "791111", "793001", "795001", "796001", "797001", "799001", "180001", "190001", "194101", "194103",
    "737101", "744101", "744301", "682551", "682555", "682559"]) assert.deepEqual(zonesForPin(pin), ["REMOTE"], pin);
  // everything else, South India included now: rest of India. Also the neighbours of the remote prefixes: Punjab and
  // Chandigarh 14x-16x, Bihar 80x-85x, West Bengal 734-736, 738, 741-743 and 745 (around Sikkim 737 and Andaman 744),
  // and the PINs just outside Lakshadweep's 682551-682559
  for (const pin of ["110001", "400001", "700001", "734101", "560001", "600001", "605001", "641001", "682001", "682030", "695001", "403001", "171001",
    "140001", "151001", "160001", "800001", "845401", "851001", "741101", "743101", "745001", "736101", "738101", "682550", "682560"]) {
    assert.deepEqual(zonesForPin(pin), ["REST"], pin);
  }
  for (const pin of ["999999", "012345", "52260", ""]) assert.equal(zonesForPin(pin), null, pin);
});

test("PIN -> area, every 3-digit prefix: remote is exactly 18x, 19x, 737, 744, 78x, 79x and 682551-682559", () => {
  const remote3 = (p) => /^(1[89]\d|737|744|7[89]\d)$/.test(p);
  for (let p = 100; p <= 899; p++) {
    const pin = `${p}001`;
    const want = p >= 500 && p <= 539 ? "AP_TS" : remote3(String(p)) ? "REMOTE" : "REST";
    assert.deepEqual(zonesForPin(pin), [want], pin);
  }
  // Lakshadweep is nine PINs inside Kerala's 682, not a prefix
  for (let n = 682500; n <= 682599; n++) {
    assert.deepEqual(zonesForPin(String(n)), [n >= 682551 && n <= 682559 ? "REMOTE" : "REST"], String(n));
  }
});

test("state -> area: every state name the checkout form offers", () => {
  const remote = ["Jammu and Kashmir", "Ladakh", "Assam", "Arunachal Pradesh", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Tripura", "Sikkim",
    "Andaman and Nicobar Islands", "Lakshadweep"];
  for (const s of remote) assert.ok(INDIAN_STATES.includes(s), `${s} is spelt as in validate.js`);
  for (const s of INDIAN_STATES) {
    const want = ["Andhra Pradesh", "Telangana"].includes(s) ? "AP_TS" : remote.includes(s) ? "REMOTE" : "REST";
    assert.deepEqual(zonesForState(s), [want], s);
  }
  assert.equal(zonesForState(""), null);
});

test("PIN + state: agreement gives that area, disagreement the union (the wider window)", () => {
  const w = (pin, state) => { const r = expectedDelivery({ paidAt: THU, pin, state }); return [r.days, r.zones]; };
  assert.deepEqual(w("522601", "Andhra Pradesh"), [[2, 4], ["AP_TS"]], "Narasaraopet");
  assert.deepEqual(w("530001", "Andhra Pradesh"), [[2, 4], ["AP_TS"]], "Visakhapatnam");
  assert.deepEqual(w("500001", "Telangana"), [[2, 4], ["AP_TS"]], "Hyderabad");
  assert.deepEqual(w("533464", "Puducherry"), [[2, 4], ["AP_TS"]], "Yanam: a Puducherry PIN in the AP band (the PIN table says so)");
  assert.deepEqual(w("533464", "Andhra Pradesh"), [[2, 4], ["AP_TS"]], "Yanam, written as AP");
  assert.deepEqual(w("110001", "Delhi"), [[4, 7], ["REST"]]);
  assert.deepEqual(w("560001", "Karnataka"), [[4, 7], ["REST"]]);
  assert.deepEqual(w("605001", "Puducherry"), [[4, 7], ["REST"]], "Puducherry town: rest of India");
  assert.deepEqual(w("781001", "Assam"), [[4, 10], ["REMOTE"]], "Guwahati");
  assert.deepEqual(w("190001", "Jammu and Kashmir"), [[4, 10], ["REMOTE"]], "Srinagar");
  assert.deepEqual(w("194101", "Ladakh"), [[4, 10], ["REMOTE"]], "Leh");
  assert.deepEqual(w("744101", "Andaman and Nicobar Islands"), [[4, 10], ["REMOTE"]], "Port Blair");
  assert.deepEqual(w("737101", "Sikkim"), [[4, 10], ["REMOTE"]], "Gangtok");
  assert.deepEqual(w("682555", "Lakshadweep"), [[4, 10], ["REMOTE"]], "Kavaratti");
  // disagreement (a typo the form did not catch): the union of both areas
  assert.deepEqual(w("110001", "Assam"), [[4, 10], ["REST", "REMOTE"]], "PIN says Delhi, state says Assam");
  assert.deepEqual(w("682555", "Kerala"), [[4, 10], ["REMOTE", "REST"]], "Lakshadweep PIN, Kerala state");
  assert.deepEqual(w("682001", "Lakshadweep"), [[4, 10], ["REST", "REMOTE"]], "Kochi PIN, Lakshadweep state");
  assert.deepEqual(w("110001", "Telangana"), [[2, 7], ["REST", "AP_TS"]], "PIN says Delhi, state says Telangana");
  assert.deepEqual(w("500001", "Karnataka"), [[2, 7], ["AP_TS", "REST"]], "PIN says Hyderabad, state says Karnataka");
  assert.deepEqual(w("522601", ""), [[2, 4], ["AP_TS"]], "no state: the PIN alone");
  assert.deepEqual(deliveryZones("522601", "Telangana"), ["AP_TS"]);
  assert.equal(expectedDelivery({ paidAt: THU, pin: "999999", state: "Delhi" }), null);
  assert.equal(expectedDelivery({ paidAt: undefined, pin: "110001", state: "Delhi" }), null);
});

test("dates: paid Thursday 12 Nov 2026 (IST) -> ships Friday 13", () => {
  // transit counts calendar days from the dispatch day, as policies.html reads
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "110001", state: "Delhi" }), { from: "2026-11-17", to: "2026-11-20", days: [4, 7], zones: ["REST"] });
  // AP/TS: Fri 13 + 2 = Sun 15, no Sunday deliveries -> earliest Mon 16; latest Fri 13 + 4 = Tue 17
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "522601", state: "Andhra Pradesh" }), { from: "2026-11-16", to: "2026-11-17", days: [2, 4], zones: ["AP_TS"] });
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "500001", state: "Telangana" }), { from: "2026-11-16", to: "2026-11-17", days: [2, 4], zones: ["AP_TS"] });
  assert.deepEqual(expectedDelivery({ paidAt: THU, pin: "781001", state: "Assam" }), { from: "2026-11-17", to: "2026-11-23", days: [4, 10], zones: ["REMOTE"] });
});

test("an earliest date on a Sunday becomes the Monday after it; the latest date never moves", () => {
  // paid Tue 10 Nov -> ships Wed 11; rest of India 4–7: Wed 11 + 4 = Sun 15 -> Mon 16; latest Wed 11 + 7 = Wed 18
  const tue = at("2026-11-10T10:00:00+05:30");
  assert.deepEqual(expectedDelivery({ paidAt: tue, pin: "110001", state: "Delhi" }), { from: "2026-11-16", to: "2026-11-18", days: [4, 7], zones: ["REST"] });
  assert.deepEqual(expectedDelivery({ paidAt: tue, pin: "781001", state: "Assam" }), { from: "2026-11-16", to: "2026-11-21", days: [4, 10], zones: ["REMOTE"] });
  // the same order to AP: Wed 11 + 2 = Fri 13, not a Sunday, unchanged
  assert.deepEqual(expectedDelivery({ paidAt: tue, pin: "522601", state: "Andhra Pradesh" }), { from: "2026-11-13", to: "2026-11-15", days: [2, 4], zones: ["AP_TS"] });
});

test("a Friday payment ships Saturday; Saturday and Sunday payments ship Monday", () => {
  assert.equal(shipsOn(at("2026-11-09T10:00:00+05:30")), "2026-11-10", "Monday -> Tuesday");
  assert.equal(shipsOn(THU), "2026-11-13", "Thursday -> Friday");
  const fri = at("2026-11-13T10:00:00+05:30");
  assert.equal(shipsOn(fri), "2026-11-14", "Friday -> Saturday");
  assert.deepEqual(expectedDelivery({ paidAt: fri, pin: "522601", state: "Andhra Pradesh" }), { from: "2026-11-16", to: "2026-11-18", days: [2, 4], zones: ["AP_TS"] });
  assert.deepEqual(expectedDelivery({ paidAt: fri, pin: "110001", state: "Delhi" }), { from: "2026-11-18", to: "2026-11-21", days: [4, 7], zones: ["REST"] });
  const sat = at("2026-11-14T10:00:00+05:30");
  const sun = at("2026-11-15T10:00:00+05:30");
  assert.equal(shipsOn(sat), "2026-11-16", "Saturday -> Monday");
  assert.equal(shipsOn(sun), "2026-11-16", "Sunday -> Monday");
  for (const paidAt of [sat, sun]) {
    assert.deepEqual(expectedDelivery({ paidAt, pin: "110001", state: "Delhi" }), { from: "2026-11-20", to: "2026-11-23", days: [4, 7], zones: ["REST"] });
    assert.deepEqual(expectedDelivery({ paidAt, pin: "522601", state: "Andhra Pradesh" }), { from: "2026-11-18", to: "2026-11-20", days: [2, 4], zones: ["AP_TS"] });
  }
});

test("dates: the IST day boundary", () => {
  // 00:30 IST on Saturday 14 Nov is still Friday 13 Nov in UTC: the IST day (Saturday) is day 0 -> ships Monday 16
  assert.equal(shipsOn(at("2026-11-14T00:30:00+05:30")), "2026-11-16");
  // 23:59 IST on Friday 13 Nov is Friday: ships Saturday 14, earliest Delhi delivery Wed 18 (Sat 14 + 4 calendar days)
  const friLate = at("2026-11-13T23:59:00+05:30");
  assert.equal(shipsOn(friLate), "2026-11-14");
  assert.equal(expectedDelivery({ paidAt: friLate, pin: "110001", state: "Delhi" }).from, "2026-11-18");
  // 00:01 IST on Monday 16 Nov: Monday -> ships Tuesday 17
  assert.equal(shipsOn(at("2026-11-16T00:01:00+05:30")), "2026-11-17");
});

test("dispatch is the next working day (never a Sunday), transit is calendar days, no Sunday earliest date (sweep over 5 weeks, every area)", () => {
  const start = at("2026-11-02T09:00:00+05:30");
  for (let i = 0; i < 35 * 4; i++) {
    const paidAt = start + i * DAY / 4;
    const day0 = Date.parse(new Date(paidAt + 5.5 * 3600 * 1000).toISOString().slice(0, 10));
    const ship = addWorkingDays(day0, 1);
    assert.notEqual(new Date(ship).getUTCDay(), 0, "never ships on a Sunday");
    assert.equal((ship - day0) / DAY, new Date(day0).getUTCDay() === 6 ? 2 : 1, "next day; Saturday -> Monday");
    for (const [pin, state] of [["522601", "Andhra Pradesh"], ["500001", "Telangana"], ["110001", "Delhi"], ["781001", "Assam"], ["110001", "Kerala"], ["110001", "Assam"]]) {
      const w = expectedDelivery({ paidAt, pin, state });
      const earliest = ship + w.days[0] * DAY;
      const sunday = new Date(earliest).getUTCDay() === 0;
      assert.equal(Date.parse(w.from), sunday ? earliest + DAY : earliest, `${pin} from = ship day + ${w.days[0]} calendar days, a Sunday -> Monday`);
      assert.notEqual(new Date(Date.parse(w.from)).getUTCDay(), 0, `${pin} earliest date is never a Sunday`);
      assert.equal(Date.parse(w.to), ship + w.days[1] * DAY, `${pin} to = ship day + ${w.days[1]} calendar days, never moved`);
      assert.ok(w.from < w.to);
    }
  }
  assert.equal(iso(addWorkingDays(Date.parse("2026-11-14"), 1)), "2026-11-16", "Saturday + 1 working day = Monday");
  assert.equal(iso(addWorkingDays(Date.parse("2026-11-15"), 1)), "2026-11-16", "Sunday + 1 working day = Monday");
  assert.equal(iso(addWorkingDays(Date.parse("2026-11-13"), 1)), "2026-11-14", "Friday + 1 working day = Saturday");
});

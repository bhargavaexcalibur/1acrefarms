// Seller block, short terms and page copy: same facts as policies.html and the pouch; no licence number unless real;
// no claim words; the checkout never invites paid WhatsApp orders.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { ADDRESS_LABELS, SELLER, TERMS, isFssaiLicence } from "../src/seller.js";
import { DELIVERY_ZONES } from "../src/delivery.js";
import { buildConfirmationEmail } from "../src/confirmation.js";

const repo = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const plain = (html) => html.replace(/<[^>]+>/g, "").replace(/&rsquo;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const POLICIES = plain(repo("policies.html"));
const PAGE_HTML = repo("checkout-test/index.html");
// Every visible string of the checkout page: checkout-test/strings.en.json (the i18n source of /checkout/i18n/*.json).
const STRINGS = Object.fromEntries(Object.entries(JSON.parse(repo("checkout-test/strings.en.json")).strings).map(([k, v]) => [k, v.en]));
const STRINGS_BLOCK = Object.values(STRINGS).join("\n");

// The site's banned claim words, read from tools/build_pages.py itself so the two can never drift apart.
const BANNED = (() => {
  const py = repo("tools/build_pages.py");
  const src = py.slice(py.indexOf("BANNED = re.compile("), py.indexOf("re.I)", py.indexOf("BANNED = re.compile(")));
  const parts = [...src.matchAll(/r"([^"]*)"/g)].map((m) => m[1]);
  assert.ok(parts.length >= 2, "BANNED regex found in build_pages.py");
  return new RegExp(parts.join(""), "i");
})();

test("seller facts = policies.html (legal name, shop address, GSTIN, FSSAI Reg. No., care and grievance contacts)", () => {
  assert.ok(POLICIES.includes(SELLER.legalName), "legal name");
  assert.ok(POLICIES.includes(SELLER.addresses.find((a) => a.key === "shop").text), "shop address");
  assert.ok(POLICIES.includes(SELLER.gstin));
  assert.ok(POLICIES.includes(`Registration No. ${SELLER.fssaiRegNo}`));
  assert.ok(POLICIES.includes(`${SELLER.care.name}, ${SELLER.care.designation}`), "grievance officer and designation");
  assert.ok(POLICIES.includes(SELLER.care.phone) && POLICIES.includes(SELLER.care.email));
  assert.ok(POLICIES.includes(`wa.me/${SELLER.care.whatsapp}`) || repo("policies.html").includes(`wa.me/${SELLER.care.whatsapp}`));
});

test("packing-unit address = the pouch text, as in Pack details on the product pages", () => {
  const packing = SELLER.addresses.find((a) => a.key === "packing").text;
  assert.equal(packing, "1acrefarms, Flat No. 202, Prudhvi Exotica, D.No. 13-1-375/7/A, Srinivasa Nagar, Narasaraopet, Palnadu Dist., A.P. 522601");
  assert.ok(plain(repo("turmeric-powder/index.html")).includes(packing));
  assert.ok(repo("tools/build_pages.py").includes('ADDRESS = ("1acrefarms, Flat No. 202, Prudhvi Exotica, D.No. 13-1-375/7/A, Srinivasa Nagar, '));
});

test("address labels: one place", () => {
  assert.deepEqual(ADDRESS_LABELS, { shop: "Shop (walk in)", packing: "Packing unit (as printed on the pack)" });
  assert.deepEqual(SELLER.addresses.map((a) => a.label), [ADDRESS_LABELS.shop, ADDRESS_LABELS.packing]);
  assert.ok(POLICIES.includes(ADDRESS_LABELS.shop), "the shop label is the one policies.html uses");
});

test("short terms keep policies.html's figures", () => {
  for (const fig of ["1–2 working days", "1–3 days", "3–5 days", "4–10 days", "5–7 working days", "48 hours", "one month", "1AF-C-0001"]) {
    assert.ok(POLICIES.includes(fig), `policies.html has ${fig}`);
    assert.ok(Object.values(TERMS).some((t) => t.includes(fig)), `TERMS has ${fig}`);
  }
  for (const z of Object.values(DELIVERY_ZONES)) assert.ok(TERMS.delivery.includes(`${z.days[0]}–${z.days[1]} days`), z.area);
  assert.match(TERMS.returns, /free of charge before dispatch/);
  assert.match(TERMS.returns, /never pay return shipping/);
  assert.match(TERMS.returns, /not-as-described/); // policies.html #returns "Quality problems"
  assert.match(TERMS.returns, /later than the usual delivery time for your area/); // policies.html "Late delivery"
  assert.match(TERMS.returns, /original payment method/);
  assert.match(TERMS.privacy, /\{link\}/);
});

test("Amazon.in store link = tools/amazon.json", () => {
  assert.equal(SELLER.amazonStoreUrl, JSON.parse(repo("tools/amazon.json")).store);
});

test("FSSAI licence: only a real-looking 14-digit number counts", () => {
  assert.equal(isFssaiLicence("0".repeat(14)), true);
  for (const v of [undefined, null, "", "applied for", "PENDING", "1".repeat(13), "1".repeat(15), ` ${"1".repeat(14)}`, "1234567890123X", SELLER.fssaiRegNo, 12345678901234]) {
    assert.equal(isFssaiLicence(v), false, String(v));
  }
});

test("no licence number, placeholder or 'applied for' anywhere in the public checkout files", () => {
  const files = [
    ...readdirSync(new URL("../src/", import.meta.url)).filter((f) => f.endsWith(".js")).map((f) => `checkout-worker/src/${f}`),
    ...readdirSync(new URL("../src/gateways/", import.meta.url)).map((f) => `checkout-worker/src/gateways/${f}`),
    "checkout-test/checkout.js", "checkout-test/index.html", "checkout-test/checkout.css", "checkout-test/cart.js",
    "checkout-test/strings.en.json", "checkout-worker/src/catalogue.json", "checkout-worker/wrangler.toml.example",
  ];
  for (const f of files) {
    const text = repo(f);
    for (const m of text.matchAll(/\d{14,}/g)) assert.equal(m[0], SELLER.fssaiRegNo, `${f}: unexpected long number ${m[0]}`);
    assert.doesNotMatch(text, /applied for|lic(?:ence|ense) (?:no\.?|number):? *(?:pending|xxx|tbd|to be)/i, f);
  }
});

test("copy obeys the site's banned claim words", () => {
  assert.ok(Object.keys(STRINGS).length > 90, "strings.en.json read");
  assert.doesNotMatch(STRINGS_BLOCK, BANNED);
  for (const t of Object.values(TERMS)) assert.doesNotMatch(t, BANNED);
  for (const a of SELLER.addresses) assert.doesNotMatch(`${a.label} ${a.text}`, BANNED);
  const order = {
    id: "1AF-W-261112-ABCDEF", mode: "live", status: "paid", paidAt: Date.parse("2026-11-12T10:00:00+05:30"), totalPaise: 63000,
    items: [{ code: "TURM", name: "Turmeric Powder", grams: 540, qty: 1, unitPaise: 39600, totalPaise: 39600 }, { code: "CBEL", name: "Cane Jaggery", grams: 540, qty: 1, unitPaise: 23400, totalPaise: 23400 }],
    customer: { name: "Asha", email: "a@example.com", address: "1-2 Main Road", city: "Guntur", state: "Andhra Pradesh", pin: "522002" },
  };
  const mail = buildConfirmationEmail(order);
  assert.doesNotMatch(mail.text, BANNED);
  assert.doesNotMatch(plain(mail.html), BANNED);
});

test("fallbacks never invite paid WhatsApp orders: Amazon.in for orders, WhatsApp for help only", () => {
  assert.doesNotMatch(STRINGS_BLOCK, /order (?:on|via|by|through) whatsapp/i);
  assert.doesNotMatch(STRINGS_BLOCK, /i'?d like to order/i);
  assert.doesNotMatch(PAGE_HTML, /order (?:on|via|by|through) whatsapp/i);
  for (const key of ["failedBody", "errorBody", "disabledBody"]) {
    assert.ok(STRINGS[key], key);
    assert.match(STRINGS[key], /Amazon\.in/, `${key} points to Amazon.in`);
  }
});

test("no dark patterns in the copy: no countdowns, scarcity or pre-ticked boxes", () => {
  assert.doesNotMatch(STRINGS_BLOCK, /hurry|only \d+ left|limited time|ends in|last chance|discount|% off|save ₹/i);
  assert.doesNotMatch(PAGE_HTML, /type="checkbox"/i);
});

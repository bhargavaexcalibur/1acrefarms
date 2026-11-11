// ONE source of truth for packs and prices: src/catalogue.json drives the Worker (pricing.js), the site build
// (tools/build_pages.py) and the checkout page (/checkout/lib/, written by the build). Also: where PhonePe and Cashfree
// send the buyer back (the hidden test page in test mode, the real /checkout/ page in live mode).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CATALOGUE, PACK_GRAMS, catalogueProblems, quoteCart, skuOf } from "../src/pricing.js";
import { loadConfig } from "../src/config.js";
import { createMemoryStore } from "../src/storage/memory.js";
import { createPhonePeOrder } from "../src/gateways/phonepe.js";
import { createCashfreeOrder } from "../src/gateways/cashfree.js";
import { createMockGateways } from "./helpers/mock-gateways.js";
import { TEST_ENV, T0 } from "./helpers/harness.js";

const RAW = readFileSync(new URL("../src/catalogue.json", import.meta.url), "utf8");
const DOC = JSON.parse(RAW);

test("catalogue.json is well formed and is exactly what the Worker prices from", () => {
  assert.deepEqual(catalogueProblems(DOC), []);
  assert.deepEqual(Object.keys(CATALOGUE), DOC.packs.map((p) => p.code));
  for (const p of DOC.packs) {
    const c = CATALOGUE[p.code];
    assert.deepEqual([c.name, c.mrp, c.hsn, c.slug, c.image, c.sku, c.grams, c.sellable],
      [p.name, p.mrp, p.hsn, p.slug, p.image, p.sku, p.grams, p.sellable], p.code);
    assert.equal(c.sku, skuOf(p.code));
    assert.equal(c.grams, PACK_GRAMS);
  }
});

test("switching a pack on or off is one line of catalogue.json", () => {
  const lines = RAW.split("\n");
  for (const p of DOC.packs) {
    const hits = lines.filter((l) => l.includes(`"code": "${p.code}"`));
    assert.equal(hits.length, 1, `${p.code} on one line`);
    assert.match(hits[0], /"sellable": (true|false)/, `${p.code}: its sellable flag is on that same line`);
  }
});

test("a malformed row is named and is never sellable (fail closed)", () => {
  const good = DOC.packs[0];
  const cases = [
    [{ ...good, mrp: "396" }, /mrp/], [{ ...good, mrp: 0 }, /mrp/], [{ ...good, sku: "1AF-TURM-0500" }, /sku/],
    [{ ...good, grams: 500 }, /grams/], [{ ...good, sellable: "yes" }, /sellable/], [{ ...good, hsn: "0910" }, /hsn/],
    [{ ...good, slug: "Turmeric Powder" }, /slug/], [{ ...good, code: "turm" }, /code/], [{ ...good, image: "x.png" }, /image/],
  ];
  for (const [row, why] of cases) assert.match(catalogueProblems({ packs: [row] }).join(" "), why, JSON.stringify(row));
  assert.match(catalogueProblems({ packs: [good, good] }).join(" "), /repeated/);
  assert.deepEqual(catalogueProblems({}), ["packs: missing or empty"]);
});

test("a pack that is not sellable is refused by the Worker whatever the page sends", () => {
  for (const [code, c] of Object.entries(CATALOGUE)) {
    const q = quoteCart([{ code, qty: 1 }]);
    assert.equal(q.ok, c.sellable, code);
    if (!c.sellable) assert.deepEqual(q.errors.map((e) => e.code), ["not_sellable"], code);
  }
});

test("return page: /checkout-test/ in test mode (or /checkout/ when asked), always /checkout/ in live mode", () => {
  assert.equal(loadConfig({}).checkoutPath, "/checkout-test/");
  assert.equal(loadConfig({ CHECKOUT_PATH: "/checkout/" }).checkoutPath, "/checkout/");
  assert.equal(loadConfig({ CHECKOUT_PATH: "https://evil.example/" }).checkoutPath, "/checkout-test/", "nothing else is accepted");
  assert.equal(loadConfig({ MODE: "live" }).checkoutPath, "/checkout/");
  assert.equal(loadConfig({ MODE: "live", CHECKOUT_PATH: "/checkout-test/" }).checkoutPath, "/checkout/", "live mode never returns to the test page");
});

test("PhonePe and Cashfree send the buyer back to that page", async () => {
  for (const [over, path] of [[{}, "/checkout-test/"], [{ CHECKOUT_PATH: "/checkout/" }, "/checkout/"]]) {
    const env = { ...TEST_ENV, ...over };
    const mocks = createMockGateways();
    mocks.state.phonepe.nowMs = () => T0;
    const cfg = loadConfig(env);
    const order = { id: "1AF-T-261112-RETURN", totalPaise: 23400, packs: 1, customer: { name: "Asha", phone: "9876543210", email: "a@example.com" } };
    await createPhonePeOrder({ cfg, env, fetchImpl: mocks.fetch, store: createMemoryStore(), now: T0, order });
    const pp = mocks.calls.find((c) => c.path.endsWith("/checkout/v2/pay")).body;
    assert.equal(pp.paymentFlow.merchantUrls.redirectUrl, `https://1acrefarms.co.in${path}?order_id=${order.id}&gw=phonepe`);
    await createCashfreeOrder({ cfg, env, fetchImpl: mocks.fetch, order });
    const cf = mocks.calls.find((c) => c.path.endsWith("/orders") && c.method === "POST").body;
    assert.equal(cf.order_meta.return_url, `https://1acrefarms.co.in${path}?order_id={order_id}`);
  }
});

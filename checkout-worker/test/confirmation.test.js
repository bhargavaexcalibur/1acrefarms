// Customer order confirmation (Resend mocked): content, once per order, failure handling, no PII in logs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { CUSTOMER, FAKE_TEST_LICENCE, LIVE_ENV, TEST_ENV, harness, razorpayOrderPaidEvent, razorpaySignature, postRazorpayWebhook, cashfreeEvent, postCashfreeWebhook } from "./helpers/harness.js";
import { buildConfirmationEmail, formatDay, formatInr, sendOrderConfirmation } from "../src/confirmation.js";
import { SELLER, TERMS } from "../src/seller.js";

const customerMails = (h, to = CUSTOMER.email) => h.mocks.state.resend.sent.filter((m) => m.to?.[0] === to);
const ownerMails = (h, re) => h.mocks.state.resend.sent.filter((m) => m.to?.[0] === "1acrefarmsindia@gmail.com" && re.test(m.subject));

async function paid(h, items, customer = CUSTOMER) {
  const r = await h.createOrder(items, customer);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const gw = r.body.razorpay.orderId;
  const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
  await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise), { eventId: `evt_${r.body.orderId}` });
  await h.drain();
  return { r, gw, pay };
}

const ORDER = Object.freeze({
  id: "1AF-W-261112-K7Q2XD", mode: "live", status: "paid",
  createdAt: Date.parse("2026-11-12T09:55:00+05:30"), paidAt: Date.parse("2026-11-12T10:00:00+05:30"),
  items: [
    { code: "TURM", sku: "1AF-TURM-0540", name: "Turmeric Powder", grams: 540, qty: 2, unitPaise: 39600, totalPaise: 79200 },
    { code: "CBEL", sku: "1AF-CBEL-0540", name: "Cane Jaggery", grams: 540, qty: 4, unitPaise: 23400, totalPaise: 93600 },
  ],
  packs: 6, subtotalPaise: 172800, deliveryPaise: 0, totalPaise: 172800,
  customer: { name: "Lakshmi Devi", phone: "9876543210", email: "lakshmi.devi@example.com", address: "12-3-45, Gandhi Nagar & Co. Lane", city: "Guntur", state: "Andhra Pradesh", pin: "522002" },
});

describe("the e-mail itself (pure)", () => {
  test("formatting helpers", () => {
    assert.equal(formatInr(102600), "₹1,026");
    assert.equal(formatInr(1886, 2), "₹18.86");
    assert.equal(formatInr(500, 2), "₹5.00");
    assert.equal(formatInr(123456789), "₹12,34,567.89");
    assert.equal(formatInr(0), "₹0");
    assert.equal(formatDay("2026-11-14"), "Sat, 14 Nov 2026");
  });

  test("everything the buyer needs, in text and HTML", () => {
    const m = buildConfirmationEmail(ORDER);
    assert.equal(m.subject, "Your 1acrefarms order 1AF-W-261112-K7Q2XD: payment received");
    const must = [
      "1AF-W-261112-K7Q2XD",
      "Thu, 12 Nov 2026",
      "2 x Turmeric Powder 540 g · MRP ₹396 each (incl. of all taxes) · ₹792",
      "4 x Cane Jaggery 540 g · MRP ₹234 each (incl. of all taxes) · ₹936",
      // per unit x qty: 2 x 9.43 + 4 x 5.57 = 41.14 CGST (invoice method)
      "GST included in the MRP: ₹82.28 (CGST 2.5% ₹41.14 + SGST 2.5% ₹41.14)",
      "Delivery: ₹0 (free across India)",
      "Total paid: ₹1,728",
      "You paid the MRP only. Nothing was added at checkout.",
      "Expected delivery between Sat, 14 Nov 2026 and Fri, 20 Nov 2026.",
      TERMS.delivery, TERMS.returns, TERMS.cancelHow, TERMS.grievance,
      `Customer care and grievance officer: ${SELLER.care.name}, ${SELLER.care.designation} · ${SELLER.care.phone} (call or WhatsApp) · ${SELLER.care.email}`,
      SELLER.legalName,
      `Shop (walk in): ${SELLER.addresses[0].text}`,
      `Packing unit (as printed on the pack): ${SELLER.addresses[1].text}`,
      `GSTIN ${SELLER.gstin} · FSSAI Reg. No. ${SELLER.fssaiRegNo}`,
      "https://1acrefarms.co.in/policies.html",
      "Delivering to: Lakshmi Devi, 12-3-45, Gandhi Nagar & Co. Lane, Guntur, Andhra Pradesh 522002",
    ];
    const htmlText = m.html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/\s+/g, " ");
    for (const s of must) {
      assert.ok(m.text.includes(s), `text has: ${s}`);
      assert.ok(htmlText.includes(s.replace(/\s+/g, " ")), `html has: ${s}`);
    }
    assert.ok(!m.text.includes("TEST"), "a live order has no TEST banner");
    assert.ok(!m.text.includes("FSSAI Lic."), "no licence line without a licence");
    assert.ok(m.html.includes("Gandhi Nagar &amp; Co. Lane"), "HTML is escaped");
  });

  test("no tracking pixels, images, scripts or marketing", () => {
    const m = buildConfirmationEmail(ORDER);
    assert.doesNotMatch(m.html, /<img|<script|<iframe|<link|<style|url\(|utm_|pixel|beacon|unsubscribe|newsletter|offer|discount|% off/i);
    const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
    assert.deepEqual(links, ["https://1acrefarms.co.in/policies.html"], "the only link is our policies page");
  });

  test("other states get IGST; test orders say TEST; the licence line appears only with a real licence", () => {
    const delhi = buildConfirmationEmail({ ...ORDER, mode: "test", customer: { ...ORDER.customer, city: "New Delhi", state: "Delhi", pin: "110001" } },
      { fssaiLic: FAKE_TEST_LICENCE });
    assert.ok(delhi.subject.startsWith("[TEST] "));
    assert.ok(delhi.text.startsWith("TEST ORDER: test-mode payment, no real money was taken."));
    assert.ok(delhi.text.includes("GST included in the MRP: ₹82.28 (IGST 5%)"), "2 x 18.86 + 4 x 11.14");
    assert.ok(delhi.text.includes("Expected delivery between Wed, 18 Nov 2026 and Thu, 26 Nov 2026."));
    assert.ok(delhi.text.includes(`FSSAI Lic. No. ${FAKE_TEST_LICENCE}`));
  });
});

describe("sending (Resend mocked)", () => {
  test("paid once -> exactly one e-mail to the buyer, however many webhooks, verifies and reconciles follow", async () => {
    const h = harness();
    const { r, gw, pay } = await paid(h, [{ code: "TURM", qty: 2 }, { code: "CBEL", qty: 1 }]);
    await postRazorpayWebhook(h, razorpayOrderPaidEvent(gw, pay, r.body.totalPaise), { eventId: "evt_again" });
    await h.call("POST", "/verify", { body: { orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay, razorpay_signature: razorpaySignature(TEST_ENV.RAZORPAY_KEY_SECRET, gw, pay) } });
    h.advance(11 * 60 * 1000);
    await h.scheduled();
    await h.drain();
    const mails = customerMails(h);
    assert.equal(mails.length, 1);
    const m = mails[0];
    assert.equal(m.from, TEST_ENV.CUSTOMER_MAIL_FROM);
    assert.equal(m.reply_to, "1acrefarmsindia@gmail.com");
    assert.equal(m.idempotencyKey, `confirm-${r.body.orderId}`);
    assert.match(m.subject, new RegExp(`^\\[TEST\\] Your 1acrefarms order ${r.body.orderId}: payment received$`));
    assert.ok(m.text.includes("Total paid: ₹1,026") && m.html.includes("Total paid: ₹1,026"));
    assert.ok(m.text.includes("GST included in the MRP: ₹48.86 (CGST 2.5% ₹24.43 + SGST 2.5% ₹24.43)"));
    const owner = ownerMails(h, /New paid order/);
    assert.equal(owner.length, 1);
    assert.match(owner[0].text, /Customer e-mail: order confirmation sent to the customer/);
    assert.ok(!owner[0].text.includes(CUSTOMER.email), "the owner alert does not carry the buyer's e-mail");
  });

  test("Cashfree and the D1-style claim: a second hand-off never mails twice", async () => {
    const h = harness();
    h.mocks.state.razorpay.create = 503;
    const r = await h.createOrder([{ code: "KPAS", qty: 1 }], { ...CUSTOMER, city: "Hyderabad", state: "Telangana", pin: "500081" });
    await postCashfreeWebhook(h, cashfreeEvent("PAYMENT_SUCCESS_WEBHOOK", r.body.orderId, r.body.totalPaise / 100));
    await h.drain();
    assert.equal(customerMails(h).length, 1);
    assert.ok(customerMails(h)[0].text.includes("GST included in the MRP: ₹23.57 (IGST 5%)"));
    const o = await h.store.getOrder(r.body.orderId);
    const d = { cfg: { customerMailFrom: "x <x@mail.example.test>", customerMailReplyTo: "r@example.test", fssaiEcomLic: null }, env: h.env, fetchImpl: h.mocks.fetch, store: h.store, now: h.now(), log: () => {}, sleep: async () => {} };
    assert.deepEqual(await sendOrderConfirmation(d, o), { sent: false, reason: "already_sent" });
    assert.equal(customerMails(h).length, 1);
    assert.deepEqual(await sendOrderConfirmation(d, { ...o, status: "created" }), { sent: false, reason: "not_paid" });
  });

  test("no sender configured -> nothing sent, the owner alert says so", async () => {
    const h = harness({ env: { CUSTOMER_MAIL_FROM: undefined } });
    await paid(h, [{ code: "CBEL", qty: 1 }]);
    assert.equal(customerMails(h).length, 0);
    assert.match(ownerMails(h, /New paid order/)[0].text, /Customer e-mail: NOT sent: CUSTOMER_MAIL_FROM is not set/);
    assert.ok(h.logs.some((l) => l.includes('"evt":"confirm_mail_skipped"') && l.includes('"reason":"no_sender"')));
  });

  test("Resend busy once -> retried and sent; Resend down -> owner told to send it by hand; the order is unaffected", async () => {
    const h = harness();
    let n = 0;
    h.mocks.state.resend.fail = (body) => (body.to[0] === CUSTOMER.email && n++ === 0 ? 503 : null);
    await paid(h, [{ code: "CBEL", qty: 1 }]);
    assert.equal(customerMails(h).length, 1);
    assert.equal(h.mocks.state.resend.failed.length, 1);

    const down = harness();
    down.mocks.state.resend.fail = (body) => (body.to[0] === CUSTOMER.email ? 500 : null);
    const { r } = await paid(down, [{ code: "CBEL", qty: 1 }]);
    assert.equal(customerMails(down).length, 0);
    assert.equal(down.mocks.state.resend.failed.length, 2, "two attempts");
    assert.match(ownerMails(down, /New paid order/)[0].text, /Customer e-mail: NOT sent \(http\): send the customer the order details by hand/);
    const o = await down.store.getOrder(r.body.orderId);
    assert.deepEqual([o.status, o.shipStatus], ["paid", "pushed"]);

    const rejected = harness();
    rejected.mocks.state.resend.fail = (body) => (body.to[0] === CUSTOMER.email ? 422 : null);
    await paid(rejected, [{ code: "CBEL", qty: 1 }]);
    assert.equal(rejected.mocks.state.resend.failed.length, 1, "a 4xx is not retried");
  });

  test("Shiprocket failed AND the e-mail failed -> a separate owner alert for the e-mail", async () => {
    const h = harness();
    h.mocks.state.shiprocket.queue = [422];
    h.mocks.state.resend.fail = (body) => (body.to[0] === CUSTOMER.email ? "network" : null);
    await paid(h, [{ code: "CBEL", qty: 1 }]);
    assert.equal(ownerMails(h, /book .* in Shiprocket by hand/).length, 1);
    assert.equal(ownerMails(h, /send the order confirmation for .* by hand/).length, 1);
  });

  test("live mode with a licence: the e-mail carries the licence line", async () => {
    const h = harness({ env: LIVE_ENV });
    await paid(h, [{ code: "TURM", qty: 1 }]);
    const m = customerMails(h)[0];
    assert.ok(!m.subject.startsWith("[TEST]"));
    assert.ok(m.text.includes(`FSSAI Lic. No. ${FAKE_TEST_LICENCE}`));
  });

  test("logs: order id only, never the buyer's name, e-mail, phone or address", async () => {
    const h = harness();
    h.mocks.state.resend.fail = (body) => (body.to[0] === CUSTOMER.email ? 500 : null);
    await paid(h, [{ code: "CBEL", qty: 1 }]);
    const ok = harness();
    await paid(ok, [{ code: "CBEL", qty: 1 }]);
    const all = [...h.logs, ...ok.logs].join("\n");
    assert.ok(all.includes('"evt":"confirm_mail_failed"') && all.includes('"evt":"confirm_mail_sent"'));
    for (const needle of [CUSTOMER.email, "lakshmi", "Lakshmi", "9876543210", "Gandhi Nagar", "12-3-45", "522002", TEST_ENV.CUSTOMER_MAIL_FROM, "orders@mail.example.test"]) {
      assert.ok(!all.includes(needle), `log leaked ${needle}`);
    }
  });
});

describe("/verify gives the success page its delivery window", () => {
  test("paid -> { from, to } dates only", async () => {
    const h = harness();
    const { r } = await paid(h, [{ code: "TURM", qty: 1 }], { ...CUSTOMER, city: "New Delhi", state: "Delhi", pin: "110001" });
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId } });
    assert.equal(v.body.status, "paid");
    assert.deepEqual(v.body.delivery, { from: "2026-11-18", to: "2026-11-26" }, "paid Thu 12 Nov 2026 (harness clock), Delhi 4–10 days");
    assert.deepEqual(Object.keys(v.body).sort(), ["delivery", "ok", "orderId", "status"], "no address or customer data");
  });

  test("Razorpay signature verified (not yet captured) -> window from now; unknown/pending -> none", async () => {
    const h = harness();
    const r = await h.createOrder([{ code: "CBEL", qty: 1 }]);
    const gw = r.body.razorpay.orderId;
    const pay = h.mocks.razorpayCapture(gw, r.body.totalPaise);
    const v = await h.call("POST", "/verify", { body: { orderId: r.body.orderId, razorpay_order_id: gw, razorpay_payment_id: pay, razorpay_signature: razorpaySignature(TEST_ENV.RAZORPAY_KEY_SECRET, gw, pay) } });
    assert.equal(v.body.status, "verified");
    assert.deepEqual(v.body.delivery, { from: "2026-11-14", to: "2026-11-20" }, "Guntur 522002: 1–5 days");
    h.mocks.state.razorpay.create = 503;
    const cf = await h.createOrder([{ code: "CBEL", qty: 1 }]);
    const pending = await h.call("POST", "/verify", { body: { orderId: cf.body.orderId } });
    assert.equal(pending.body.status, "pending");
    assert.equal(pending.body.delivery, undefined);
    await h.drain();
  });
});

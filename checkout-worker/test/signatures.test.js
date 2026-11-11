// Signature verification against known vectors (computed independently with Python's hmac module,
// plus RFC 4231 test case 2 for the raw HMAC helper).
import { test } from "node:test";
import assert from "node:assert/strict";
import { hmacSha256, timingSafeEqual, toHex, fromHex, fromBase64 } from "../src/crypto.js";
import { verifyRazorpayPayment, verifyRazorpayWebhook } from "../src/gateways/razorpay.js";
import { verifyCashfreeWebhook } from "../src/gateways/cashfree.js";

test("HMAC-SHA256 matches RFC 4231 test case 2", async () => {
  const mac = await hmacSha256("Jefe", "what do ya want for nothing?");
  assert.equal(toHex(mac), "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
});

const RZP = {
  secret: "EnLs21M47BllR3X8PSFtjtbd",
  orderId: "order_IEIaMR65cu6nz3",
  paymentId: "pay_IH4NVgf4Dreq1l",
  signature: "0d4e745a1838664ad6c9c9902212a32d627d68e917290b0ad5f08ff4561bc50f",
};

test("Razorpay payment signature: known vector passes", async () => {
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, RZP.paymentId, RZP.signature), true);
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, RZP.paymentId, RZP.signature.toUpperCase()), true, "hex case does not matter");
});

test("Razorpay payment signature: every tampering fails", async () => {
  const flip = RZP.signature.slice(0, -1) + (RZP.signature.endsWith("f") ? "e" : "f");
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, RZP.paymentId, flip), false, "one hex digit changed");
  assert.equal(await verifyRazorpayPayment(RZP.secret, "order_OTHER000000001", RZP.paymentId, RZP.signature), false, "other order id");
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, "pay_OTHER000000001", RZP.signature), false, "other payment id");
  assert.equal(await verifyRazorpayPayment("wrong_secret", RZP.orderId, RZP.paymentId, RZP.signature), false, "other secret");
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, RZP.paymentId, RZP.signature.slice(0, 62)), false, "short");
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, RZP.paymentId, "zz" + RZP.signature.slice(2)), false, "not hex");
  assert.equal(await verifyRazorpayPayment(RZP.secret, RZP.orderId, RZP.paymentId, ""), false, "empty");
  assert.equal(await verifyRazorpayPayment("", RZP.orderId, RZP.paymentId, RZP.signature), false, "no secret configured");
});

const RZP_HOOK = {
  secret: "1acre_webhook_secret_test",
  body: '{"entity":"event","event":"order.paid","payload":{"order":{"entity":{"id":"order_IEIaMR65cu6nz3","amount":102600}}}}',
  signature: "f3e045a0d8a12cf4336424f1633d089af5800969c30e50239a3f681c9af33bb9",
};

test("Razorpay webhook signature over the RAW body: known vector", async () => {
  assert.equal(await verifyRazorpayWebhook(RZP_HOOK.secret, RZP_HOOK.body, RZP_HOOK.signature), true);
  // re-serialising the JSON (even just whitespace) must break it: never parse before verifying
  const reserialised = JSON.stringify(JSON.parse(RZP_HOOK.body), null, 1);
  assert.equal(await verifyRazorpayWebhook(RZP_HOOK.secret, reserialised, RZP_HOOK.signature), false);
  assert.equal(await verifyRazorpayWebhook(RZP_HOOK.secret, RZP_HOOK.body.replace("102600", "100"), RZP_HOOK.signature), false);
  assert.equal(await verifyRazorpayWebhook(RZP_HOOK.secret, RZP_HOOK.body, null), false);
});

const CF_HOOK = {
  secret: "cfsk_ma_test_1acre",
  ts: "1731303000",
  body: '{"data":{"order":{"order_id":"1AF-T-261111-K7Q2XD","order_amount":1026},"payment":{"cf_payment_id":5114910,"payment_status":"SUCCESS","payment_amount":1026}},"type":"PAYMENT_SUCCESS_WEBHOOK"}',
  signature: "wD/g4aSS9f96f9SZXN87Yk/2PJ/ySo4jHp070HTZOBw=",
};

test("Cashfree webhook signature = base64 HMAC(timestamp + raw body): known vector", async () => {
  assert.equal(await verifyCashfreeWebhook(CF_HOOK.secret, CF_HOOK.ts, CF_HOOK.body, CF_HOOK.signature), true);
  assert.equal(await verifyCashfreeWebhook(CF_HOOK.secret, "1731303001", CF_HOOK.body, CF_HOOK.signature), false, "other timestamp");
  assert.equal(await verifyCashfreeWebhook(CF_HOOK.secret, CF_HOOK.ts, CF_HOOK.body.replace("1026}}", "1}}"), CF_HOOK.signature), false, "body changed");
  assert.equal(await verifyCashfreeWebhook("other", CF_HOOK.ts, CF_HOOK.body, CF_HOOK.signature), false, "other secret");
  assert.equal(await verifyCashfreeWebhook(CF_HOOK.secret, CF_HOOK.ts, CF_HOOK.body, "not base64!"), false, "garbage signature");
  assert.equal(await verifyCashfreeWebhook(CF_HOOK.secret, null, CF_HOOK.body, CF_HOOK.signature), false, "no timestamp");
});

test("timingSafeEqual and decoders", () => {
  const a = fromHex("00ff10");
  assert.deepEqual([...a], [0, 255, 16]);
  assert.equal(fromHex("abc"), null);
  assert.equal(fromHex("gg"), null);
  assert.equal(fromBase64("@@@@"), null);
  assert.equal(timingSafeEqual(a, fromHex("00ff10")), true);
  assert.equal(timingSafeEqual(a, fromHex("00ff11")), false);
  assert.equal(timingSafeEqual(a, fromHex("00ff")), false);
  assert.equal(timingSafeEqual(a, "00ff10"), false);
});

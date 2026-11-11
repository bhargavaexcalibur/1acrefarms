// Customer order confirmation e-mail (Resend), sent ONCE per order when it becomes paid.
// Who sends it: only the caller that won storage.markPaid() (the same single hand-off that pushes the order to
// Shiprocket, see settlePaid/afterPaid in index.js), plus a durable claim "mail:confirm:<order id>" in the
// webhook_events table (INSERT OR IGNORE), so even a repeated hand-off can never mail twice.
// Content: order id, packs with MRP, GST break-up, total, free delivery, expected delivery window, how to cancel or
// return, the grievance officer and the complaint-number process, and the seller details. Plain HTML + text:
// no images, no tracking pixels, no marketing. Logs carry the order id only (never the address or e-mail).
import { postResend } from "./alerts.js";
import { expectedDelivery } from "./delivery.js";
import { gstBreakup } from "./gst.js";
import { SELLER, TERMS } from "./seller.js";

// ---------- formatting (no Intl, so the text is the same everywhere) ----------
// Rs amounts with Indian digit grouping: 102600 -> "₹1,026"; 1886 -> "₹18.86". decimals: "auto" | 2
export function formatInr(paise, decimals = "auto") {
  const p = Math.round(paise);
  const sign = p < 0 ? "-" : "";
  const abs = Math.abs(p);
  const whole = String(Math.floor(abs / 100));
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${last3}` : last3;
  const frac = abs % 100;
  const showFrac = decimals === 2 || frac !== 0;
  return `${sign}₹${grouped}${showFrac ? `.${String(frac).padStart(2, "0")}` : ""}`;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-14" -> "Sat, 14 Nov 2026"
export function formatDay(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
// epoch ms -> the IST calendar day, formatted as above
const istDayText = (ms) => formatDay(new Date(ms + 5.5 * 3600 * 1000).toISOString().slice(0, 10));

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// The GST line, shared wording with the checkout summary.
export function gstLine(g) {
  if (g.kind === "intra") return `GST included in the MRP: ${formatInr(g.taxPaise, 2)} (CGST ${g.halfRatePct}% ${formatInr(g.cgstPaise, 2)} + SGST ${g.halfRatePct}% ${formatInr(g.sgstPaise, 2)})`;
  if (g.kind === "inter") return `GST included in the MRP: ${formatInr(g.taxPaise, 2)} (IGST ${g.ratePct}%)`;
  return `GST included in the MRP (${g.ratePct}%)`;
}

// Pure: the e-mail for a paid order. fssaiLic: the licence number when the Worker has a valid one, else null.
export function buildConfirmationEmail(order, { fssaiLic = null, siteUrl = SELLER.website } = {}) {
  const c = order.customer || {};
  const test = order.mode !== "live";
  const paidAt = order.paidAt ?? order.createdAt;
  const g = gstBreakup(order.items, c.state);
  const win = expectedDelivery({ paidAt, pin: c.pin, state: c.state });
  const policies = `${String(siteUrl || SELLER.website).replace(/\/$/, "")}${SELLER.policiesPath}`;
  const care = SELLER.care;

  const subject = `${test ? "[TEST] " : ""}Your 1acrefarms order ${order.id}: payment received`;
  const packLine = (l) => `${l.qty} x ${l.name} ${l.grams} g · MRP ${formatInr(l.unitPaise)} each (incl. of all taxes) · ${formatInr(l.totalPaise)}`;
  const winText = win ? `Expected delivery between ${formatDay(win.from)} and ${formatDay(win.to)}.` : null;
  const shipTo = [c.name, c.address, c.city, `${c.state || ""} ${c.pin || ""}`.trim()].filter(Boolean).join(", ");
  const sellerLines = [
    SELLER.legalName,
    ...SELLER.addresses.map((a) => `${a.label}: ${a.text}`),
    `GSTIN ${SELLER.gstin} · FSSAI Reg. No. ${SELLER.fssaiRegNo}${fssaiLic ? ` · FSSAI Lic. No. ${fssaiLic}` : ""}`,
  ];
  const careLine = `Customer care and grievance officer: ${care.name}, ${care.designation} · ${care.phone} (call or WhatsApp) · ${care.email}`;

  // ----- plain text -----
  const text = [
    ...(test ? ["TEST ORDER: test-mode payment, no real money was taken.", ""] : []),
    `Hello ${c.name || ""},`.replace(" ,", ","),
    "",
    `Thank you. We have received your payment for order ${order.id} on ${istDayText(paidAt)}.`,
    "",
    "YOUR ORDER",
    ...order.items.map(packLine),
    gstLine(g),
    "Delivery: ₹0 (free across India)",
    `Total paid: ${formatInr(order.totalPaise)}`,
    "You paid the MRP only. Nothing was added at checkout.",
    "",
    "DELIVERY",
    ...(winText ? [winText] : []),
    TERMS.delivery,
    "When your order is dispatched we send you the courier name and a tracking link on WhatsApp or by e-mail. Your GST tax invoice comes with your order.",
    `Delivering to: ${shipTo}`,
    "If anything in this address is wrong, reply to this e-mail before dispatch.",
    "",
    "CANCEL, RETURN OR REFUND",
    TERMS.returns,
    TERMS.cancelHow,
    "",
    "QUESTIONS AND COMPLAINTS",
    careLine,
    TERMS.grievance,
    "",
    "SELLER",
    ...sellerLines,
    `Terms of sale, shipping, returns and privacy: ${policies}`,
    "",
    "This e-mail is about your order only.",
  ].join("\n");

  // ----- HTML (same content; inline styles only, no images, no external resources) -----
  const h2 = (t) => `<h2 style="font-size:16px;margin:22px 0 6px">${esc(t)}</h2>`;
  const p = (t) => `<p style="margin:6px 0">${esc(t)}</p>`;
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${esc(subject)}</title></head>`,
    '<body style="margin:0;padding:16px;font:15px/1.5 Arial,Helvetica,sans-serif;color:#1f2a1c;background:#ffffff">',
    '<div style="max-width:600px;margin:0 auto">',
    ...(test ? ['<p style="background:#fdf3da;padding:8px 10px;border-radius:6px;font-weight:bold">TEST ORDER: test-mode payment, no real money was taken.</p>'] : []),
    p(`Hello ${c.name || ""},`.replace(" ,", ",")),
    p(`Thank you. We have received your payment for order ${order.id} on ${istDayText(paidAt)}.`),
    h2("Your order"),
    `<ul style="margin:6px 0;padding-left:20px">${order.items.map((l) => `<li>${esc(packLine(l))}</li>`).join("")}</ul>`,
    p(gstLine(g)),
    p("Delivery: ₹0 (free across India)"),
    `<p style="margin:6px 0;font-weight:bold">Total paid: ${esc(formatInr(order.totalPaise))}</p>`,
    p("You paid the MRP only. Nothing was added at checkout."),
    h2("Delivery"),
    ...(winText ? [`<p style="margin:6px 0;font-weight:bold">${esc(winText)}</p>`] : []),
    p(TERMS.delivery),
    p("When your order is dispatched we send you the courier name and a tracking link on WhatsApp or by e-mail. Your GST tax invoice comes with your order."),
    p(`Delivering to: ${shipTo}`),
    p("If anything in this address is wrong, reply to this e-mail before dispatch."),
    h2("Cancel, return or refund"),
    p(TERMS.returns),
    p(TERMS.cancelHow),
    h2("Questions and complaints"),
    p(careLine),
    p(TERMS.grievance),
    h2("Seller"),
    `<p style="margin:6px 0;font-size:13px;color:#4a5546">${sellerLines.map(esc).join("<br>")}<br>Terms of sale, shipping, returns and privacy: <a href="${esc(policies)}">${esc(policies)}</a></p>`,
    '<p style="margin:18px 0 0;font-size:12px;color:#6b7566">This e-mail is about your order only.</p>',
    "</div></body></html>",
  ].join("\n");

  return { subject, text, html, delivery: win, gst: g };
}

// Sends the confirmation for a paid order. Never throws. -> { sent: true } | { sent: false, reason }
// reason: no_sender | no_key | no_email | not_paid | already_sent | http | network | timeout
export async function sendOrderConfirmation(d, order) {
  try {
    if (!order || order.status !== "paid") return { sent: false, reason: "not_paid" };
    if (!d.cfg.customerMailFrom) {
      d.log("confirm_mail_skipped", { orderId: order.id, reason: "no_sender" });
      return { sent: false, reason: "no_sender" };
    }
    if (!d.env.RESEND_API_KEY) {
      d.log("confirm_mail_skipped", { orderId: order.id, reason: "no_resend_key" });
      return { sent: false, reason: "no_key" };
    }
    const to = order.customer?.email;
    if (!to) return { sent: false, reason: "no_email" };
    if (!(await d.store.recordEvent(`mail:confirm:${order.id}`, d.now))) {
      d.log("confirm_mail_skipped", { orderId: order.id, reason: "already_sent" });
      return { sent: false, reason: "already_sent" };
    }
    const mail = buildConfirmationEmail(order, { fssaiLic: d.cfg.fssaiEcomLic, siteUrl: d.env.SITE_URL });
    const payload = { from: d.cfg.customerMailFrom, to: [to], reply_to: d.cfg.customerMailReplyTo, subject: mail.subject, html: mail.html, text: mail.text };
    let r;
    for (let attempt = 1; attempt <= 2; attempt++) {
      r = await postResend(d, payload, { idempotencyKey: `confirm-${order.id}` });
      if (r.ok || !r.retryable) break;
      if (attempt < 2) await d.sleep(1000);
    }
    if (r.ok) {
      d.log("confirm_mail_sent", { orderId: order.id });
      return { sent: true };
    }
    d.log("confirm_mail_failed", { orderId: order.id, http: r.http || undefined, reason: r.reason });
    return { sent: false, reason: r.reason };
  } catch (e) {
    d.log("confirm_mail_failed", { orderId: order?.id, reason: e?.name || "error" });
    return { sent: false, reason: "error" };
  }
}

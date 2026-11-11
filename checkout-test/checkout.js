// 1acrefarms checkout (hidden TEST page). Clean rewrite; ideas from the old WhatsApp cart (app.js at e2d48352^):
// localStorage cart, live delivery line, itemised WhatsApp message as the fallback.
//
// Prices and form rules are imported from the Worker's own modules, so what the page shows is what the Worker
// charges: the sum of the MRPs, nothing added (delivery is free across India). The Worker re-prices every order
// anyway and is the only authority.
import { CATALOGUE, LIMITS, PACK_GRAMS, quoteCart } from "../checkout-worker/src/pricing.js";
import { INDIAN_STATES, validateCustomer } from "../checkout-worker/src/validate.js";

// ---------------------------------------------------------------------------------------------
// Every visible string lives here. Translating = adding STRINGS.hi, STRINGS.te, ... with the same keys
// (placeholders in {braces} stay as they are). Nothing else in this file or index.html holds text.
// ---------------------------------------------------------------------------------------------
const STRINGS = {
  en: {
    pageTitle: "Checkout (test) · 1acrefarms",
    back: "← Back to the shop",
    title: "Checkout",
    bannerTest: "TEST MODE: no real money is taken. This page is hidden and only for testing.",
    bannerLive: "Live payments are on.",
    bannerOff: "Online payment is switched off right now.",
    bannerUnreachable: "The payment server cannot be reached right now.",
    packsTitle: "Your packs",
    packMeta: "{grams} g · MRP {price} · incl. of all taxes",
    less: "One less: {name}",
    more: "One more: {name}",
    addressTitle: "Delivery address",
    fName: "Full name",
    fPhone: "Mobile number",
    fEmail: "Email (for your order confirmation)",
    fAddress: "Address (house no., street, area, landmark)",
    fCity: "City / town",
    fState: "State",
    fStatePick: "Choose your state",
    fPin: "PIN code",
    errors: {
      "name:required": "Please enter your name.",
      "name:invalid": "Please enter your name in letters (up to 60).",
      "phone:required": "Please enter your 10-digit mobile number.",
      "phone:invalid": "Please enter a valid 10-digit Indian mobile number.",
      "email:required": "Please enter your email address.",
      "email:invalid": "Please check your email address.",
      "address:required": "Please enter your address.",
      "address:too_short": "Please add your house number, street and area.",
      "address:invalid": "Please keep the address under 200 characters, without < or >.",
      "city:required": "Please enter your city or town.",
      "city:invalid": "Please enter the city name in letters (up to 30).",
      "state:required": "Please choose your state.",
      "state:invalid": "Please choose your state from the list.",
      "pin:required": "Please enter your 6-digit PIN code.",
      "pin:invalid": "Please enter a valid 6-digit PIN code.",
      "pin:state_mismatch": "This PIN code is not in the state you chose. Please check both.",
      "items:empty_cart": "Please add at least one pack.",
      "items:qty_over_limit": "Up to {max} of the same pack per order.",
      "items:too_many_packs": "Up to {max} packs per order. For more, message us on WhatsApp.",
      "items:not_sellable": "A pack in your cart is not available now. Please remove it.",
      "items:unknown_item": "A pack in your cart is not available now. Please remove it.",
      "items:bad_qty": "Please check the quantities.",
    },
    summaryTitle: "Order summary",
    sumPacks: "Packs ({n})",
    sumTotal: "Total to pay",
    sumEmpty: "Your cart is empty. Add a pack above.",
    sumFreeDelivery: "Free delivery across India",
    sumMrpOnly: "You pay the MRP only, incl. of all taxes. Nothing is added at checkout.",
    prepaidNote: "Prepaid only: UPI, debit or credit card, net banking or wallet. No cash on delivery. Payments are handled by Razorpay (Cashfree and PhonePe as backups); we never see your card details or UPI PIN.",
    terms: "By paying you agree to our {link}.",
    termsLink: "terms of sale, shipping and refund policies",
    pay: "Pay {amount}",
    payEmpty: "Add a pack to pay",
    payBusy: "Please wait…",
    creating: "Starting secure payment…",
    redirecting: "Taking you to PhonePe to pay…",
    verifying: "Confirming your payment…",
    priceChangedTitle: "Total updated",
    priceChangedBody: "The total for this order is {amount}. Please check it and press Pay again.",
    successTitle: "Thank you! Your payment is received.",
    successBody: "Order number: {id}. We pack and dispatch within 1–2 working days (not on Sundays or public holidays) and send the courier name and tracking link on WhatsApp or email.",
    successKeep: "Please keep the order number for any question.",
    pendingTitle: "Your payment is being confirmed",
    pendingBody: "Order number: {id}. If money has left your account, there is no need to pay again: we confirm it within a few minutes, and a payment that does not complete is refunded automatically.",
    failedTitle: "Payment did not go through",
    failedBody: "No money was taken for this attempt. You can try again, or order on WhatsApp.",
    failedReason: "Reason given by the bank or app: {reason}",
    cancelledTitle: "Payment window closed",
    cancelledBody: "Nothing was charged. Your cart is saved: press Pay to try again.",
    errorTitle: "We could not start the payment",
    errorBody: "Please try again in a minute, or order on WhatsApp.",
    disabledTitle: "Online payment is off right now",
    disabledBody: "Please order on WhatsApp, or from our Amazon.in store.",
    outOfStock: "{name} has just sold out. Please lower the quantity or remove it.",
    fixForm: "Please check the highlighted fields.",
    tryAgain: "Try again",
    whatsapp: "Order on WhatsApp",
    rzpDescription: "{n} pack(s) · order {id}",
    waIntro: "Hi 1acrefarms! I'd like to order:",
    waLine: "{qty} × {name} {grams} g @ {price} [{sku}]",
    waTotal: "Total: {amount} (free delivery)",
    waPin: "PIN code: {pin}",
  },
};

const LANG = STRINGS[document.documentElement.lang] ? document.documentElement.lang : "en";
const T = STRINGS[LANG];
const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const money = new Intl.NumberFormat(LANG === "en" ? "en-IN" : `${LANG}-IN`, { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr = (paise) => money.format(paise / 100);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const API = (LOCAL ? "http://127.0.0.1:8787" : document.querySelector('meta[name="checkout-api"]')?.content || "").replace(/\/$/, "");
const WHATSAPP_NUMBER = "917899929779";
const POLICIES_URL = "/policies.html";
const CART_KEY = "oneacre_checkout_test_v1";
const IMAGES = {
  TURM: "turmeric-540g.jpg", KPAS: "hill-turmeric-540g.jpg", SANN: "sannam-540g.jpg", TEJA: "teja-540g.jpg",
  CBEL: "cane-jaggery-540g.jpg", TBEL: "palm-jaggery-540g.jpg", CASH: "cashew-540g.jpg",
};
const SELLABLE = Object.entries(CATALOGUE).filter(([, p]) => p.sellable).map(([code]) => code);
const FIELDS = ["name", "phone", "email", "address", "city", "state", "pin"];

// ---------------------------------------------------------------------------------------------
// State: cart + PIN are remembered on this device; name, phone and address are not.
// ---------------------------------------------------------------------------------------------
let cart = {};
let savedPin = "";
try {
  const s = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
  for (const [code, qty] of Object.entries(s.cart || {})) {
    if (SELLABLE.includes(code) && Number.isInteger(qty) && qty > 0) cart[code] = Math.min(qty, LIMITS.maxQtyPerLine);
  }
  savedPin = typeof s.pin === "string" ? s.pin : "";
} catch { /* private mode or bad JSON: start empty */ }
const save = () => {
  try { localStorage.setItem(CART_KEY, JSON.stringify({ cart, pin: $("f-pin").value.trim() })); } catch { /* ignore */ }
};

let busy = false;
let touched = new Set();
let pending = null; // { key, data } of the last created order, reused while cart + address are unchanged

const $ = (id) => document.getElementById(id);
const items = () => Object.entries(cart).map(([code, qty]) => ({ code, qty }));
const formValues = () => Object.fromEntries(FIELDS.map((f) => [f, $(`f-${f}`).value]));
const quote = () => quoteCart(items());
const packCount = () => Object.values(cart).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
function renderStatic() {
  document.title = T.pageTitle;
  document.querySelectorAll("[data-t]").forEach((el) => { el.textContent = T[el.dataset.t]; });
  $("termsNote").innerHTML = fmt(esc(T.terms), { link: `<a href="${POLICIES_URL}" target="_blank" rel="noopener">${esc(T.termsLink)}</a>` });
  const sel = $("f-state");
  sel.innerHTML = `<option value="">${esc(T.fStatePick)}</option>` + INDIAN_STATES.map((s) => `<option>${esc(s)}</option>`).join("");
  $("f-pin").value = savedPin;
}

function renderPacks() {
  const total = packCount();
  $("packList").innerHTML = SELLABLE.map((code) => {
    const p = CATALOGUE[code];
    const q = cart[code] || 0;
    const atLine = q >= LIMITS.maxQtyPerLine;
    const atOrder = total >= LIMITS.maxPacksPerOrder;
    return `<li class="co-pack">
      <img src="../assets/packs/${IMAGES[code]}" alt="" width="56" height="56" loading="lazy" />
      <div class="co-pack-info">
        <div class="co-pack-name">${esc(p.name)}</div>
        <div class="co-pack-meta">${esc(fmt(T.packMeta, { grams: PACK_GRAMS, price: inr(p.mrp * 100) }))}</div>
      </div>
      <div class="co-qty">
        <button type="button" data-code="${code}" data-d="-1" aria-label="${esc(fmt(T.less, { name: p.name }))}" ${q ? "" : "disabled"}>−</button>
        <output aria-live="polite">${q}</output>
        <button type="button" data-code="${code}" data-d="1" aria-label="${esc(fmt(T.more, { name: p.name }))}" ${atLine || atOrder ? "disabled" : ""}>+</button>
      </div>
    </li>`;
  }).join("");
}

function renderSummary() {
  const q = quote();
  const box = $("summary");
  const btn = $("payBtn");
  if (!q.lines.length) {
    box.innerHTML = `<p class="muted">${esc(T.sumEmpty)}</p>`;
    btn.textContent = T.payEmpty;
    btn.disabled = true;
    return;
  }
  box.innerHTML = `
    <div class="r"><span>${esc(fmt(T.sumPacks, { n: q.packs }))}</span><span>${esc(inr(q.subtotalPaise))}</span></div>
    <p class="free">${esc(T.sumFreeDelivery)}</p>
    <div class="r total"><span>${esc(T.sumTotal)}</span><span>${esc(inr(q.totalPaise))}</span></div>
    <p class="co-note">${esc(T.sumMrpOnly)}</p>
    ${q.errors.length ? `<p class="co-err">${esc(itemError(q.errors[0]))}</p>` : ""}`;
  btn.disabled = busy || !q.ok;
  btn.textContent = busy ? T.payBusy : fmt(T.pay, { amount: inr(q.totalPaise) });
}

const itemError = (e) => fmt(T.errors[`items:${e.code}`] || T.errors["items:bad_qty"], {
  max: e.code === "qty_over_limit" ? LIMITS.maxQtyPerLine : LIMITS.maxPacksPerOrder,
});

function showFieldErrors(errors, { all = false } = {}) {
  const byField = Object.fromEntries(errors.filter((e) => e.field !== "items").map((e) => [e.field, e.code]));
  for (const f of FIELDS) {
    const show = all || touched.has(f);
    const code = show ? byField[f] : undefined;
    $(`e-${f}`).textContent = code ? T.errors[`${f}:${code}`] || T.errors[`${f}:invalid`] : "";
    $(`f-${f}`).setAttribute("aria-invalid", code ? "true" : "false");
    if (code) $(`f-${f}`).setAttribute("aria-describedby", `e-${f}`);
  }
}

// One status box for every state of the payment.
function status(kind, { title = "", body = "", extra = "", actions = [] } = {}) {
  const box = $("status");
  if (!kind) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.className = `co-status ${kind}`;
  const btns = actions.map((a) => a === "retry"
    ? `<button type="button" class="btn btn-green" data-act="retry">${esc(T.tryAgain)}</button>`
    : `<a class="btn btn-wa" href="${esc(whatsappLink())}" target="_blank" rel="noopener">${esc(T.whatsapp)}</a>`).join("");
  box.innerHTML = `${title ? `<h3>${esc(title)}</h3>` : ""}${body ? `<p>${body}</p>` : ""}${extra ? `<p>${extra}</p>` : ""}${btns ? `<div class="actions">${btns}</div>` : ""}`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function whatsappLink() {
  const q = quote();
  const lines = [T.waIntro, ""];
  for (const l of q.lines) lines.push(fmt(T.waLine, { qty: l.qty, name: l.name, grams: l.grams, price: inr(l.unitPaise), sku: l.sku }));
  if (q.lines.length) lines.push("", fmt(T.waTotal, { amount: inr(q.totalPaise) }));
  const pin = $("f-pin").value.trim();
  if (pin) lines.push(fmt(T.waPin, { pin }));
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function rerender() {
  renderPacks();
  renderSummary();
}

// ---------------------------------------------------------------------------------------------
// Talking to the Worker
// ---------------------------------------------------------------------------------------------
async function api(path, body) {
  const res = await fetch(API + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, data };
}

async function checkHealth() {
  const b = $("modeBanner");
  try {
    const { data } = await api("/health");
    if (data?.checkout !== "enabled") b.textContent = T.bannerOff;
    else b.textContent = data.mode === "live" ? T.bannerLive : T.bannerTest;
    b.classList.toggle("live", data?.mode === "live" && data?.checkout === "enabled");
  } catch {
    b.textContent = T.bannerUnreachable;
  }
  b.hidden = false;
}

const loadedScripts = new Map();
function loadScript(src) {
  if (!loadedScripts.has(src)) {
    loadedScripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => { loadedScripts.delete(src); reject(new Error("script failed")); };
      document.head.appendChild(s);
    }));
  }
  return loadedScripts.get(src);
}

function setBusy(on) {
  busy = on;
  renderSummary();
}

async function pay() {
  if (busy) return;
  FIELDS.forEach((f) => touched.add(f));
  const v = validateCustomer(formValues());
  const q = quote();
  showFieldErrors(v.errors, { all: true });
  if (!v.ok || !q.ok) {
    status("bad", { body: esc(v.ok ? itemError(q.errors[0]) : T.fixForm) });
    const first = v.errors[0];
    if (first) $(`f-${first.field}`).focus();
    return;
  }
  const key = JSON.stringify([items(), v.value]);
  setBusy(true);
  try {
    let data = pending && pending.key === key ? pending.data : null;
    if (!data) {
      status("info", { body: esc(T.creating) });
      // Turnstile hook: when the Worker has TURNSTILE_REQUIRED=true, render the widget and pass its token here.
      const turnstileToken = window.turnstile?.getResponse?.() || null;
      const r = await api("/create-order", { items: items(), customer: v.value, turnstileToken });
      if (r.status === 503 && r.data?.error === "checkout_disabled") return status("bad", { title: T.disabledTitle, body: esc(T.disabledBody), actions: ["wa"] });
      if (r.status === 400 && Array.isArray(r.data?.errors)) {
        showFieldErrors(r.data.errors, { all: true });
        const itemErr = r.data.errors.find((e) => e.field === "items");
        return status("bad", { body: esc(itemErr ? itemError(itemErr) : T.fixForm) });
      }
      if (r.status === 409 && r.data?.error === "out_of_stock") {
        return status("bad", { body: esc(fmt(T.outOfStock, { name: CATALOGUE[r.data.item]?.name || r.data.item })) });
      }
      if (r.status !== 200 || !r.data?.ok) return status("bad", { title: T.errorTitle, body: esc(T.errorBody), actions: ["retry", "wa"] });
      data = r.data;
      pending = { key, data };
      if (data.totalPaise !== q.totalPaise) {
        return status("info", { title: T.priceChangedTitle, body: esc(fmt(T.priceChangedBody, { amount: inr(data.totalPaise) })) });
      }
    }
    status(null);
    if (data.gateway === "razorpay") await openRazorpay(data, v.value);
    else if (data.gateway === "cashfree") await openCashfree(data);
    else if (data.gateway === "phonepe") await openPhonePe(data);
    else status("bad", { title: T.errorTitle, body: esc(T.errorBody), actions: ["retry", "wa"] });
  } catch {
    status("bad", { title: T.errorTitle, body: esc(T.errorBody), actions: ["retry", "wa"] });
  } finally {
    setBusy(false);
  }
}

function openRazorpay(data, customer) {
  return loadScript("https://checkout.razorpay.com/v1/checkout.js").then(() => new Promise((resolve) => {
    let done = false;
    let failure = null;
    const rzp = new window.Razorpay({
      key: data.razorpay.keyId,
      order_id: data.razorpay.orderId,
      amount: data.totalPaise,
      currency: "INR",
      name: "1acrefarms",
      description: fmt(T.rzpDescription, { n: data.packs, id: data.orderId }),
      prefill: { name: customer.name, email: customer.email, contact: customer.phone },
      notes: { order: data.orderId },
      theme: { color: "#2b3d25" },
      handler: async (resp) => {
        done = true;
        await verify({ orderId: data.orderId, ...resp });
        resolve();
      },
      modal: {
        ondismiss: () => {
          if (done) return;
          if (failure) status("bad", { title: T.failedTitle, body: esc(T.failedBody), extra: failure ? esc(fmt(T.failedReason, { reason: failure })) : "", actions: ["retry", "wa"] });
          else status("info", { title: T.cancelledTitle, body: esc(T.cancelledBody) });
          resolve();
        },
      },
    });
    // Razorpay keeps its window open after a failed attempt so the customer can retry there.
    rzp.on("payment.failed", (resp) => { failure = String(resp?.error?.description || "").slice(0, 160) || null; });
    rzp.open();
  }));
}

async function openCashfree(data) {
  await loadScript("https://sdk.cashfree.com/js/v3/cashfree.js");
  const cashfree = window.Cashfree({ mode: data.cashfree.mode });
  const result = await cashfree.checkout({ paymentSessionId: data.cashfree.paymentSessionId, redirectTarget: "_modal" });
  if (result?.redirect) return; // the page will come back with ?order_id=...
  // Whatever the popup says, the Worker asks Cashfree (Get Order) for the truth.
  await verify({ orderId: data.orderId }, { closedWithError: Boolean(result?.error) });
}

// PhonePe Standard Checkout, redirect mode: the customer pays on PhonePe's page and comes back to
// /checkout-test/?order_id=...&gw=phonepe (the Worker's redirectUrl). The start-up code below then calls /verify,
// and the Worker asks PhonePe's Order Status API: the return trip alone never counts as paid.
// Docs: developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/invoke-iframe-paypage
const PHONEPE_JS = "https://mercury.phonepe.com/web/bundle/checkout.js";
async function openPhonePe(data) {
  const url = String(data.phonepe?.redirectUrl || "");
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a URL */ }
  const onPhonePe = url.startsWith("https://") && (host === "phonepe.com" || host.endsWith(".phonepe.com"));
  const localMock = LOCAL && (host === "127.0.0.1" || host === "localhost"); // scripts/dev-server.mjs only
  if (!onPhonePe && !localMock) throw new Error("unexpected payment page");
  status("info", { body: esc(T.redirecting) });
  if (onPhonePe) {
    try {
      await loadScript(PHONEPE_JS);
      if (window.PhonePeCheckout?.transact) {
        window.PhonePeCheckout.transact({ tokenUrl: url }); // no "type": redirect mode
        await new Promise((res) => setTimeout(res, 5000)); // normally the page has left by now
      }
    } catch { /* script blocked: a plain redirect does the same */ }
  }
  location.assign(url);
  await new Promise(() => {});
}

async function verify(body, { closedWithError = false } = {}) {
  status("info", { body: esc(T.verifying) });
  for (let i = 0; i < 4; i++) {
    let r;
    try { r = await api("/verify", body); } catch { r = { status: 0, data: null }; }
    const st = r.data?.status;
    if (st === "paid" || st === "verified") return success(r.data.orderId);
    if (r.status === 400 || st === "failed") return status("bad", { title: T.failedTitle, body: esc(T.failedBody), actions: ["retry", "wa"] });
    if (st === "pending" && closedWithError) return status("bad", { title: T.failedTitle, body: esc(T.failedBody), actions: ["retry", "wa"] });
    await new Promise((res) => setTimeout(res, 2000));
  }
  status("info", { title: T.pendingTitle, body: esc(fmt(T.pendingBody, { id: body.orderId })) });
}

function success(orderId) {
  cart = {};
  pending = null;
  save();
  rerender();
  status("ok", { title: T.successTitle, body: fmt(esc(T.successBody), { id: `<code>${esc(orderId)}</code>` }), extra: esc(T.successKeep) });
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------
$("packList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-code]");
  if (!b) return;
  const code = b.dataset.code;
  const have = cart[code] || 0;
  if (Number(b.dataset.d) < 0) {
    if (have <= 1) delete cart[code];
    else cart[code] = have - 1;
  } else if (have < LIMITS.maxQtyPerLine && packCount() < LIMITS.maxPacksPerOrder) {
    cart[code] = have + 1;
  }
  pending = null;
  save();
  rerender();
});

const form = $("addrForm");
form.addEventListener("input", (e) => {
  pending = null;
  if (e.target.name === "pin") {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    save();
  }
  if (touched.has(e.target.name)) showFieldErrors(validateCustomer(formValues()).errors);
  renderSummary();
});
form.addEventListener("focusout", (e) => {
  if (!e.target.name) return;
  touched.add(e.target.name);
  showFieldErrors(validateCustomer(formValues()).errors);
});
form.addEventListener("submit", (e) => { e.preventDefault(); pay(); });
$("payBtn").addEventListener("click", pay);
$("status").addEventListener("click", (e) => { if (e.target.closest("[data-act=retry]")) pay(); });

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------
renderStatic();
rerender();
checkHealth();
// Back from PhonePe (always a redirect) or a Cashfree redirect (some banks leave the popup): ?order_id=1AF-...
const back = new URLSearchParams(location.search).get("order_id");
if (back && /^1AF-[TW]-\d{6}-[0-9A-Z]{6}$/.test(back)) {
  history.replaceState(null, "", location.pathname);
  verify({ orderId: back });
}

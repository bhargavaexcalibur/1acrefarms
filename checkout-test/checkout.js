// 1acrefarms checkout page. ONE source for both pages: the hidden test page /checkout-test/ runs this file as it is,
// and tools/build_pages.py copies it to /checkout/ (the real page) with the imports below pointed at /checkout/lib/.
// The two differ only by <meta name="checkout-page"> ("test" or "prod"). Ideas from the old WhatsApp cart (app.js at
// e2d48352^): localStorage cart and a live summary. When the checkout cannot take an order, buyers are pointed to our
// Amazon.in store; WhatsApp is offered for help only (direct WhatsApp orders are not open, policies.html #order).
//
// Prices, GST break-up, seller details, short terms, delivery dates and form rules are imported from the Worker's own
// modules, so what the page shows is what the Worker charges and what the order e-mail says: the sum of the MRPs,
// nothing added (delivery is free across India). The Worker re-prices every order anyway and is the only authority.
import { CATALOGUE, LIMITS, PACK_GRAMS, quoteCart, unitPaisePerGram } from "../checkout-worker/src/pricing.js";
import { INDIAN_STATES, validateCustomer } from "../checkout-worker/src/validate.js";
import { gstBreakup } from "../checkout-worker/src/gst.js";
import { SELLER, TERMS, isFssaiLicence } from "../checkout-worker/src/seller.js";
import { CART_KEY, cartAdd, cartObject, clampCart, parseProductsParam } from "../checkout-worker/src/cart-link.js";
import { expectedDelivery } from "../checkout-worker/src/delivery.js";

// ---------------------------------------------------------------------------------------------
// Strings. Every visible string comes from /checkout/i18n/<lang>.json, written by tools/build_pages.py from
// checkout-test/strings.en.json (English) and the site's translation store (tools/i18n/<lang>.json, keys co.<key>).
// A string not translated yet arrives in English and is listed in "en": it is shown marked lang="en".
// The language: ?lang=xx, else the language page the buyer came from (/xx/...), else the one used last time here,
// else English. Nothing else in this file or index.html holds text, except the <noscript> and #loadError lines.
// ---------------------------------------------------------------------------------------------
const meta = (name) => document.querySelector(`meta[name="${name}"]`)?.content || "";
const PAGE = meta("checkout-page") === "prod" ? "prod" : "test";
const STRINGS_BASE = meta("checkout-strings") || "/checkout/i18n/";
const LANG_RE = /^[a-z]{2,3}$/;

let T = {};
let FALLBACK = new Set();
let PACK_NAMES = {};
let PACK_PAGES = new Set(); // packs with a product page in this language (/xx/<slug>/)
let LANG = "en";
let HOME = "/";
let LOCALE = "en-IN";

const fmt = (s, vars = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const isEn = (key) => LANG !== "en" && FALLBACK.has(key);
const enSpan = (html) => `<span lang="en" dir="ltr">${html}</span>`;
// plain text (textContent, attributes, the payment window)
const t = (key, vars) => fmt(T[key] ?? "", vars);
// HTML: the string escaped, {placeholders} filled with HTML the caller has already escaped, English marked as English
const h = (key, htmlVars = {}) => {
  const out = fmt(esc(T[key] ?? ""), htmlVars);
  return isEn(key) ? enSpan(out) : out;
};
const setText = (el, key, vars) => {
  el.textContent = t(key, vars);
  if (isEn(key)) { el.lang = "en"; el.dir = "ltr"; } else { el.removeAttribute("lang"); el.removeAttribute("dir"); }
};
const packName = (code) => PACK_NAMES[code] || CATALOGUE[code]?.name || code;
const packNameHtml = (code) => ((PACK_NAMES[code] || LANG === "en") ? esc(packName(code)) : enSpan(esc(packName(code))));

let money; let money2; let dayFmt;
const inr = (paise) => money.format(paise / 100);
const inr2 = (paise) => money2.format(paise / 100); // tax lines and unit prices: always to the paisa
const day = (iso) => dayFmt.format(new Date(`${iso}T12:00:00Z`)); // "2026-11-14" -> "Sat, 14 Nov 2026"
function setupLocale() {
  // Western digits everywhere, as on the rest of the site and on the pack
  const make = (loc) => [
    new Intl.NumberFormat(loc, { style: "currency", currency: "INR", maximumFractionDigits: 0 }),
    new Intl.NumberFormat(loc, { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    new Intl.DateTimeFormat(loc, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }),
  ];
  try { [money, money2, dayFmt] = make(LOCALE); } catch { [money, money2, dayFmt] = make("en-IN"); }
}

// ---------------------------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------------------------
// ?remote on a localhost page = test against the deployed (TEST-mode) worker instead of `wrangler dev` on :8787.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname) && !new URLSearchParams(location.search).has("remote");
const API = (LOCAL ? "http://127.0.0.1:8787" : meta("checkout-api")).replace(/\/$/, "");
const POLICIES_URL = SELLER.policiesPath;
const SELLABLE = Object.entries(CATALOGUE).filter(([, p]) => p.sellable).map(([code]) => code);
const FIELDS = ["name", "phone", "email", "address", "city", "state", "pin"];

// ---------------------------------------------------------------------------------------------
// State: the cart (shared with the product pages and the home page), the PIN and the language are remembered on this
// device (localStorage, CART_KEY); name, phone and address are not.
// ---------------------------------------------------------------------------------------------
let cart = {};
let savedPin = "";
let savedLang = "";
const readStore = () => {
  try {
    const s = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
    return s && typeof s === "object" && !Array.isArray(s) ? s : {};
  } catch { return {}; } // private mode or bad JSON: start empty
};
function loadCart() {
  const s = readStore();
  cart = cartObject(clampCart(s.cart).items); // only sellable packs, within the Worker's limits
  savedPin = typeof s.pin === "string" && /^\d{0,6}$/.test(s.pin) ? s.pin : "";
  savedLang = typeof s.lang === "string" && LANG_RE.test(s.lang) ? s.lang : "";
}
const save = () => {
  try {
    const s = readStore();
    localStorage.setItem(CART_KEY, JSON.stringify({ ...s, cart, pin: $("f-pin").value.trim(), lang: LANG }));
  } catch { /* ignore */ }
};

let ready = false;
let busy = false;
let touched = new Set();
let pending = null; // { key, data } of the last created order, reused while cart + address are unchanged
let lastOrderId = null; // quoted in the WhatsApp help message
let fssaiLic = null; // the FSSAI licence number, only when the Worker reports a real 14-digit one (/health)

const $ = (id) => document.getElementById(id);
const items = () => Object.entries(cart).map(([code, qty]) => ({ code, qty }));
const formValues = () => Object.fromEntries(FIELDS.map((f) => [f, $(`f-${f}`).value]));
const quote = () => quoteCart(items());
const packCount = () => Object.values(cart).reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------------------------
// Language
// ---------------------------------------------------------------------------------------------
function wantedLang() {
  const q = new URLSearchParams(location.search).get("lang");
  if (q && LANG_RE.test(q)) return q;
  try {
    const r = new URL(document.referrer);
    const m = r.origin === location.origin && r.pathname.match(/^\/([a-z]{2,3})\//);
    if (m) return m[1];
  } catch { /* no referrer */ }
  return savedLang || "en";
}

async function loadStrings(lang) {
  for (const code of lang === "en" ? ["en"] : [lang, "en"]) {
    try {
      const res = await fetch(`${STRINGS_BASE}${code}.json`);
      if (!res.ok) continue;
      const d = await res.json();
      if (!d || typeof d.t !== "object") continue;
      T = d.t;
      FALLBACK = new Set(Array.isArray(d.en) ? d.en : []);
      PACK_NAMES = d.packs && typeof d.packs === "object" ? d.packs : {};
      PACK_PAGES = new Set(Array.isArray(d.pages) ? d.pages : []);
      LANG = code;
      HOME = typeof d.home === "string" && d.home.startsWith("/") ? d.home : "/";
      document.documentElement.lang = code;
      document.documentElement.dir = d.dir === "rtl" ? "rtl" : "ltr";
      LOCALE = code === "en" ? "en-IN" : `${code}-IN-u-nu-latn`;
      // The four short terms are shared with the order e-mail (seller.js); a file without them falls back to that English.
      for (const [key, term] of [["privacyNote", "privacy"], ["deliveryNote", "delivery"], ["returnsNote", "returns"], ["grievanceNote", "grievance"]]) {
        if (!T[key]) { T[key] = TERMS[term]; FALLBACK.add(key); }
      }
      return true;
    } catch { /* offline or blocked: try English */ }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------------------------
const newTab = (href, html) => `<a href="${esc(href)}" target="_blank" rel="noopener">${html}</a>`;

function renderStatic() {
  document.title = (PAGE === "test" ? "TEST · " : "") + t("pageTitle");
  document.querySelectorAll("[data-t]").forEach((el) => setText(el, el.dataset.t));
  $("backLink").href = HOME;
  $("termsNote").innerHTML = h("terms", { link: newTab(POLICIES_URL, h("termsLink")) });
  $("privacyNote").innerHTML = h("privacyNote", { link: newTab(`${POLICIES_URL}#privacy`, h("privacyLink")) });
  const sel = $("f-state");
  sel.innerHTML = `<option value="">${esc(t("fStatePick"))}</option>` + INDIAN_STATES.map((s) => `<option>${esc(s)}</option>`).join("");
  if (isEn("fStatePick")) sel.options[0].lang = "en";
  $("f-pin").value = savedPin;
  renderSeller();
}

// Seller identity, both addresses, GSTIN, FSSAI, customer care and grievance officer: from src/seller.js only.
function sellerHtml() {
  const c = SELLER.care;
  const ids = [h("gstin", { gstin: esc(SELLER.gstin) }), h("fssaiReg", { no: esc(SELLER.fssaiRegNo) }), ...(fssaiLic ? [h("fssaiLic", { no: esc(fssaiLic) })] : [])];
  const care = h("careLine", {
    name: esc(c.name), designation: esc(c.designation),
    phone: `<a href="tel:+${esc(c.whatsapp)}">${esc(c.phone)}</a>`,
    email: `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`,
  });
  // The legal name and the addresses are legal identity: they stay in English (lang="en"), like the pack itself.
  return `<p class="co-seller-name" lang="en" dir="ltr">${esc(SELLER.legalName)}</p>
    <ul class="co-addr" lang="en" dir="ltr">${SELLER.addresses.map((a) => `<li><span class="co-addr-label">${esc(a.label)}:</span> ${esc(a.text)}</li>`).join("")}</ul>
    <p>${ids.join(" · ")}</p>
    <p>${care}</p>
    <p>${h("grievanceNote")}</p>
    <p>${newTab(`${POLICIES_URL}#seller`, h("policiesLink"))}</p>`;
}

// Before the Pay button: delivery, returns and the seller; the same seller block again in the page footer.
function renderSeller() {
  $("sellerTerms").innerHTML = `<h3>${h("deliveryTitle")}</h3><p>${h("deliveryNote")}</p>
    <h3>${h("returnsTitle")}</h3><p>${h("returnsNote")}</p>
    <h3>${h("sellerTitle")}</h3>${sellerHtml()}`;
  $("sellerFoot").innerHTML = `<h2>${h("footTitle")}</h2>${sellerHtml()}`;
}

function renderPacks() {
  const total = packCount();
  $("packList").innerHTML = SELLABLE.map((code) => {
    const p = CATALOGUE[code];
    const q = cart[code] || 0;
    const atLine = q >= LIMITS.maxQtyPerLine;
    const atOrder = total >= LIMITS.maxPacksPerOrder;
    const meta = h("packMeta", {
      grams: PACK_GRAMS, price: esc(inr(p.mrp * 100)), unit: esc(inr2(unitPaisePerGram(p.mrp, PACK_GRAMS))),
      details: newTab(`${PACK_PAGES.has(code) ? `/${LANG}` : ""}/${p.slug}/`, h("packDetails")),
    });
    return `<li class="co-pack">
      <img src="../assets/packs/${esc(p.image)}" alt="" width="56" height="56" loading="lazy" />
      <div class="co-pack-info">
        <div class="co-pack-name">${packNameHtml(code)}</div>
        <div class="co-pack-meta">${meta}</div>
      </div>
      <div class="co-qty">
        <button type="button" data-code="${code}" data-d="-1" aria-label="${esc(t("less", { name: packName(code) }))}" ${q ? "" : "disabled"}>−</button>
        <output aria-live="polite">${q}</output>
        <button type="button" data-code="${code}" data-d="1" aria-label="${esc(t("more", { name: packName(code) }))}" ${atLine || atOrder ? "disabled" : ""}>+</button>
      </div>
    </li>`;
  }).join("");
}

function renderSummary() {
  const q = quote();
  const box = $("summary");
  const btn = $("payBtn");
  if (!q.lines.length) {
    box.innerHTML = `<p class="muted">${h("sumEmpty")}</p>`;
    setText(btn, "payEmpty");
    btn.disabled = true;
    return;
  }
  // GST shown inside the MRP (display only): CGST + SGST for Andhra Pradesh, IGST elsewhere, the rate until a state is chosen
  const g = gstBreakup(q.lines, $("f-state").value);
  const gst = g.kind === "intra" ? h("sumGstIntra", { tax: esc(inr2(g.taxPaise)), half: g.halfRatePct, cgst: esc(inr2(g.cgstPaise)), sgst: esc(inr2(g.sgstPaise)) })
    : g.kind === "inter" ? h("sumGstInter", { tax: esc(inr2(g.taxPaise)), rate: g.ratePct })
      : h("sumGstNoState", { rate: g.ratePct });
  box.innerHTML = `
    <div class="r"><span>${h("sumPacks", { n: q.packs })}</span><span>${esc(inr(q.subtotalPaise))}</span></div>
    <p class="gst">${gst}</p>
    <div class="r"><span>${h("sumDelivery")}</span><span class="free">${h("sumDeliveryFree", { amount: esc(inr(q.deliveryPaise)) })}</span></div>
    <div class="r total"><span>${h("sumTotal")}</span><span>${esc(inr(q.totalPaise))}</span></div>
    <p class="co-note">${h("sumMrpOnly")}</p>
    ${q.errors.length ? `<p class="co-err">${itemError(q.errors[0])}</p>` : ""}`;
  btn.disabled = busy || !q.ok;
  if (busy) setText(btn, "payBusy");
  else setText(btn, "pay", { amount: inr(q.totalPaise) });
}

const itemError = (e) => {
  const key = T[`err.items.${e.code}`] ? `err.items.${e.code}` : "err.items.bad_qty";
  return h(key, { max: e.code === "qty_over_limit" ? LIMITS.maxQtyPerLine : LIMITS.maxPacksPerOrder });
};

function showFieldErrors(errors, { all = false } = {}) {
  const byField = Object.fromEntries(errors.filter((e) => e.field !== "items").map((e) => [e.field, e.code]));
  for (const f of FIELDS) {
    const show = all || touched.has(f);
    const code = show ? byField[f] : undefined;
    const el = $(`e-${f}`);
    if (code) setText(el, T[`err.${f}.${code}`] ? `err.${f}.${code}` : `err.${f}.invalid`);
    else el.textContent = "";
    $(`f-${f}`).setAttribute("aria-invalid", code ? "true" : "false");
    if (code) $(`f-${f}`).setAttribute("aria-describedby", `e-${f}`);
  }
}

// One status box for every state of the payment. title / body / extra are HTML (already escaped); extra may be a list.
function status(kind, { title = "", body = "", extra = "", actions = [] } = {}) {
  const box = $("status");
  if (!kind) { box.hidden = true; box.innerHTML = ""; return; }
  box.hidden = false;
  box.className = `co-status ${kind}`;
  const btns = actions.map((a) => (a === "retry"
    ? `<button type="button" class="btn btn-green" data-act="retry">${h("tryAgain")}</button>`
    : a === "amazon"
      ? `<a class="btn btn-wa" href="${esc(SELLER.amazonStoreUrl)}" target="_blank" rel="noopener">${h("amazon")}</a>`
      : `<a class="btn btn-wa" href="${esc(helpLink())}" target="_blank" rel="noopener">${h("help")}</a>`)).join("");
  const extras = (Array.isArray(extra) ? extra : [extra]).filter(Boolean).map((x) => `<p>${x}</p>`).join("");
  box.innerHTML = `${title ? `<h3>${title}</h3>` : ""}${body ? `<p>${body}</p>` : ""}${extras}${btns ? `<div class="actions">${btns}</div>` : ""}`;
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// WhatsApp is for help only (not for placing paid orders): a short message with the order number, if there is one.
function helpLink() {
  const lines = [t("waHelp"), ...(lastOrderId ? [t("waHelpOrder", { id: lastOrderId })] : [])];
  return `https://wa.me/${SELLER.care.whatsapp}?text=${encodeURIComponent(lines.join("\n"))}`;
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

// The banner says what the payment server says. On the real page (/checkout/) live payments need no banner; the
// hidden test page always says which mode it is in.
async function checkHealth() {
  const b = $("modeBanner");
  let key = "bannerUnreachable";
  let liveOn = false;
  try {
    const { data } = await api("/health");
    liveOn = data?.mode === "live" && data?.checkout === "enabled";
    key = data?.checkout !== "enabled" ? "bannerOff" : data.mode === "live" ? "bannerLive" : "bannerTest";
    // The licence line appears only when the Worker holds a real licence number (never a placeholder).
    const lic = typeof data?.fssaiLic === "string" && isFssaiLicence(data.fssaiLic) ? data.fssaiLic : null;
    if (lic !== fssaiLic) { fssaiLic = lic; renderSeller(); }
  } catch { /* unreachable */ }
  setText(b, key);
  b.classList.toggle("live", liveOn);
  b.hidden = PAGE === "prod" && liveOn;
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

const failed = (extra = "") => status("bad", { title: h("failedTitle"), body: h("failedBody"), extra, actions: ["retry", "amazon", "help"] });
const startError = () => status("bad", { title: h("errorTitle"), body: h("errorBody"), actions: ["retry", "amazon", "help"] });

async function pay() {
  if (busy || !ready) return;
  FIELDS.forEach((f) => touched.add(f));
  const v = validateCustomer(formValues());
  const q = quote();
  showFieldErrors(v.errors, { all: true });
  if (!v.ok || !q.ok) {
    status("bad", { body: v.ok ? itemError(q.errors[0]) : h("fixForm") });
    const first = v.errors[0];
    if (first) $(`f-${first.field}`).focus();
    return;
  }
  const key = JSON.stringify([items(), v.value]);
  setBusy(true);
  try {
    let data = pending && pending.key === key ? pending.data : null;
    if (!data) {
      status("info", { body: h("creating") });
      // Turnstile hook: when the Worker has TURNSTILE_REQUIRED=true, render the widget and pass its token here.
      const turnstileToken = window.turnstile?.getResponse?.() || null;
      const r = await api("/create-order", { items: items(), customer: v.value, turnstileToken });
      if (r.status === 503 && r.data?.error === "checkout_disabled") return status("bad", { title: h("disabledTitle"), body: h("disabledBody"), actions: ["amazon", "help"] });
      if (r.status === 400 && Array.isArray(r.data?.errors)) {
        showFieldErrors(r.data.errors, { all: true });
        const itemErr = r.data.errors.find((e) => e.field === "items");
        return status("bad", { body: itemErr ? itemError(itemErr) : h("fixForm") });
      }
      if (r.status === 409 && r.data?.error === "out_of_stock") {
        const code = CATALOGUE[r.data.item] ? r.data.item : null;
        return status("bad", { body: h("outOfStock", { name: code ? packNameHtml(code) : esc(String(r.data.item || "")) }) });
      }
      if (r.status !== 200 || !r.data?.ok) return startError();
      data = r.data;
      pending = { key, data };
      lastOrderId = data.orderId;
      if (data.totalPaise !== q.totalPaise) {
        return status("info", { title: h("priceChangedTitle"), body: h("priceChangedBody", { amount: esc(inr(data.totalPaise)) }) });
      }
    }
    status(null);
    if (data.gateway === "razorpay") await openRazorpay(data, v.value);
    else if (data.gateway === "cashfree") await openCashfree(data);
    else if (data.gateway === "phonepe") await openPhonePe(data);
    else startError();
  } catch {
    startError();
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
      description: t("rzpDescription", { n: data.packs, id: data.orderId }),
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
          if (failure) failed(h("failedReason", { reason: esc(failure) }));
          else status("info", { title: h("cancelledTitle"), body: h("cancelledBody") });
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

// PhonePe Standard Checkout, redirect mode: the customer pays on PhonePe's page and comes back to this page
// (?order_id=...&gw=phonepe, the Worker's redirectUrl: /checkout-test/ in test mode, /checkout/ in live mode). The
// start-up code below then calls /verify, and the Worker asks PhonePe's Order Status API: the return trip alone never
// counts as paid. Docs: developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/invoke-iframe-paypage
const PHONEPE_JS = "https://mercury.phonepe.com/web/bundle/checkout.js";
async function openPhonePe(data) {
  const url = String(data.phonepe?.redirectUrl || "");
  let host = "";
  try { host = new URL(url).hostname; } catch { /* not a URL */ }
  const onPhonePe = url.startsWith("https://") && (host === "phonepe.com" || host.endsWith(".phonepe.com"));
  const localMock = LOCAL && (host === "127.0.0.1" || host === "localhost"); // scripts/dev-server.mjs only
  if (!onPhonePe && !localMock) throw new Error("unexpected payment page");
  status("info", { body: h("redirecting") });
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
  lastOrderId = body.orderId;
  status("info", { body: h("verifying") });
  for (let i = 0; i < 4; i++) {
    let r;
    try { r = await api("/verify", body); } catch { r = { status: 0, data: null }; }
    const st = r.data?.status;
    if (st === "paid" || st === "verified") return success(r.data.orderId, r.data.delivery);
    if (r.status === 400 || st === "failed") return failed();
    if (st === "pending" && closedWithError) return failed();
    await new Promise((res) => setTimeout(res, 2000));
  }
  status("info", { title: h("pendingTitle"), body: h("pendingBody", { id: esc(body.orderId) }), actions: ["help"] });
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// The Worker sends the window (from the stored PIN, state and payment time). Fallback: the same function on the
// form's own PIN and state, if they are still on the page (a PhonePe redirect clears them).
function deliveryLine(delivery) {
  let w = delivery && ISO_DAY.test(delivery.from) && ISO_DAY.test(delivery.to) ? delivery : null;
  if (!w) {
    const v = validateCustomer(formValues()).value;
    w = expectedDelivery({ paidAt: Date.now(), pin: v.pin, state: v.state });
  }
  return w ? h("successDelivery", { from: esc(day(w.from)), to: esc(day(w.to)) }) : "";
}

function success(orderId, delivery) {
  const when = deliveryLine(delivery);
  cart = {};
  pending = null;
  save();
  rerender();
  status("ok", {
    title: h("successTitle"),
    body: h("successBody", { id: `<code>${esc(orderId)}</code>` }),
    extra: [when && `<b>${when}</b>`, h("successKeep")],
  });
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------
$("packList").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-code]");
  if (!b || !ready) return;
  const code = b.dataset.code;
  const have = cart[code] || 0;
  if (Number(b.dataset.d) < 0) {
    if (have <= 1) delete cart[code];
    else cart[code] = have - 1;
  } else {
    const r = cartAdd(cart, code); // stays inside LIMITS
    if (r.ok) cart = r.cart;
  }
  pending = null;
  save();
  rerender();
});

const form = $("addrForm");
form.addEventListener("input", (e) => {
  if (!ready) return;
  pending = null;
  if (e.target.name === "pin") {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
    save();
  }
  if (touched.has(e.target.name)) showFieldErrors(validateCustomer(formValues()).errors);
  renderSummary();
});
form.addEventListener("focusout", (e) => {
  if (!e.target.name || !ready) return;
  touched.add(e.target.name);
  showFieldErrors(validateCustomer(formValues()).errors);
});
form.addEventListener("change", (e) => { if (ready && e.target.name === "state") renderSummary(); }); // GST line follows the state
form.addEventListener("submit", (e) => { e.preventDefault(); pay(); });
$("payBtn").addEventListener("click", pay);
$("status").addEventListener("click", (e) => { if (e.target.closest("[data-act=retry]")) pay(); });

// Links that bring packs: the product pages' "Add to cart" (?add=CODE: one more; used only when the browser could not
// save the cart itself) and "Buy now" (?buy=CODE: at least one), and the Meta catalogue link
// (?products=1AF-TURM-0540%3A2,1AF-CBEL-0540%3A1). The Meta link's packs REPLACE the saved cart (nothing is added that
// the buyer did not pick); unknown or unavailable packs are left out with a visible note, and quantities are clamped to
// the usual limits. If nothing in the link can be ordered, the saved cart stays. Any coupon or price in a link is
// ignored. The parameters are then removed, so a reload never adds anything again.
function applyLinkParams() {
  const params = new URLSearchParams(location.search);
  const notes = [];
  for (const [name, atLeastOne] of [["add", false], ["buy", true]]) {
    if (!params.has(name)) continue;
    const r = cartAdd(cart, params.get(name), { atLeastOne });
    if (r.ok) cart = r.cart;
    else notes.push(h("linkIgnored", { items: esc(String(params.get(name)).slice(0, 12)) }));
    params.delete(name);
  }
  if (params.has("products")) {
    const r = parseProductsParam(params.get("products"));
    if (r.items.length) cart = Object.fromEntries(r.items.map((i) => [i.code, i.qty]));
    if (r.ignored.length) notes.push(h("linkIgnored", { items: esc([...new Set(r.ignored.map((i) => i.sku))].join(", ")) }));
    if (r.clampedLine) notes.push(h("linkClampedLine", { max: LIMITS.maxQtyPerLine }));
    if (r.clampedTotal) notes.push(h("linkClampedTotal", { max: LIMITS.maxPacksPerOrder }));
    params.delete("products");
  }
  const box = $("linkNote");
  box.innerHTML = notes.join(" ");
  box.hidden = !notes.length;
  if (LANG !== "en") params.set("lang", LANG);
  else params.delete("lang");
  const rest = params.toString();
  history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------
async function start() {
  loadCart();
  if (!(await loadStrings(wantedLang()))) {
    $("loadError").hidden = false;
    return;
  }
  setupLocale();
  const back = new URLSearchParams(location.search).get("order_id");
  applyLinkParams();
  ready = true;
  renderStatic(); // also puts the saved PIN back in the form
  save();
  rerender();
  checkHealth();
  // Back from PhonePe (always a redirect) or a Cashfree redirect (some banks leave the popup): ?order_id=1AF-...
  if (back && /^1AF-[TW]-\d{6}-[0-9A-Z]{6}$/.test(back)) {
    const q = new URLSearchParams(location.search);
    q.delete("order_id");
    q.delete("gw");
    const rest = q.toString();
    history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}`);
    verify({ orderId: back });
  }
}
start();

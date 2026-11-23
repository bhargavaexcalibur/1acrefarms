// Admin Shiprocket API: the daily Shiprocket work (quote, create, book, pickup, label, track, cancel before an AWB,
// wallet, pickup addresses) through the Worker's Shiprocket API user and its cached ~9-day token, so the 24 h web
// login stops mattering. Server to server only: the Python CLI tools/sr.py is the one client.
//
//   GET  /admin/sr/pickups   pickup addresses (no address/phone/email); is "home" there with PIN 522601?
//   GET  /admin/sr/wallet    wallet balance (Rs), low below Rs 300
//   POST /admin/sr/quote     {pin, packs?|weightKg?, lengthCm?, breadthCm?, heightCm?, declaredRupees?}
//                            | {orderId: <our 1AF-W order>} | {shipmentId}: allowed couriers only, cheapest first
//   POST /admin/sr/create    adhoc order, NO AWB (free): an Amazon/Flipkart self-ship order, or a re-push of one of
//                            our paid website orders whose automatic push gave up
//   POST /admin/sr/book      ASSIGN THE AWB = SPENDS WALLET MONEY. Needs confirm "ship <shipmentId>" and said = the
//                            "ship <ID>" Bhargava typed; then pickup (or none), label, manifest
//   POST /admin/sr/pickup    {shipmentId, date?, retry?}       POST /admin/sr/label {shipmentId}
//   POST /admin/sr/cancel    {srOrderId|ref, confirm: "cancel <same>"}: custom-channel orders with NO AWB only
//   POST /admin/sr/unlock    {shipmentId, confirm: "unlock <id>"}: frees a booking lock left by a timed-out booking
//   GET  /admin/sr/track     ?awb= | ?shipment= | ?ref=      GET /admin/sr/find ?ref=<our/Amazon id or AWB>
//
// Rules enforced HERE (not only in the CLI):
//   - auth: header "authorization: Bearer <ADMIN_TOKEN>", compared in constant time on SHA-256 digests; 503
//     admin_not_configured while the secret is unset or short (fail closed); 401 otherwise. No CORS on any reply
//     (index.js never runs these replies through its CORS helper; OPTIONS is answered 403 there).
//   - couriers: DTDC, Blue Dart, India Post only. Any name containing "delhivery" is never booked and never shown in
//     a quote (only counted). Shiprocket's recommended courier is ignored; a booking always names its courier_id, and
//     what Shiprocket actually booked is checked again. Pickup and label refuse an AWB on any other courier. An AWB
//     auto-assigned at order create is refused (409 awb_auto_assigned) and alerted.
//   - prepaid only: every quote sends cod=0; every order is payment_method "Prepaid" with shipping_charges 0; a
//     booking refuses an order that is not prepaid, not on our custom channel ("CS") or not at the pickup "home".
//   - price: a booking re-quotes live and refuses above the caller's maxRupees or SR_BOOK_MAX_RUPEES (Rs 500), and
//     when the wallet is short. One shipment per call, under a once-only lock (srbook:<id>).
//   - never logged or returned: the admin token, the Shiprocket token or password, buyer phones/addresses/e-mails
//     (one log line per call: route, status, http, reason, count, ms).
// Shiprocket has no sandbox: every admin call is real, whatever MODE says.
import { HttpError, json, readJson } from "./http.js";
import { sha256Bytes, timingSafeEqual } from "./crypto.js";
import { ShiprocketError, buildShiprocketOrder, istDate, srCall } from "./shiprocket.js";
import { CATALOGUE, LIMITS, PIN_RE, parcelFor } from "./pricing.js";
import { INDIAN_STATES, validateCustomer } from "./validate.js";
import { sendOwnerAlert } from "./alerts.js";
import { redact } from "./log.js";

export const MIN_ADMIN_TOKEN_CHARS = 43; // 32 random bytes as base64url
export const LOW_WALLET_RUPEES = 300;
const BEARER_RE = /^Bearer ([\x21-\x7e]{1,512})$/;

// ---------- couriers ----------
export const BANNED_COURIER = /delhivery/i;
export const ALLOWED_COURIERS = Object.freeze([/\bdtdc\b/i, /blue\s*-?\s*dart/i, /india\s*-?\s*post/i]);

export function classifyCourier(name) {
  const n = String(name ?? "");
  if (BANNED_COURIER.test(n)) return { allowed: false, reason: "delhivery_never" };
  if (ALLOWED_COURIERS.some((re) => re.test(n))) return { allowed: true };
  return { allowed: false, reason: "not_on_allow_list" };
}

// ---------- ids and small parsers ----------
const SR_ID_RE = /^\d{1,12}$/;
const AWB_RE = /^[A-Za-z0-9]{6,25}$/;
const REF_RE = /^[A-Za-z0-9-]{4,40}$/;
const AMAZON_ID_RE = /^\d{3}-\d{7}-\d{7}$/;
const FLIPKART_ID_RE = /^OD\d{15,21}$/;
const WEBSITE_ID_RE = /^1AF-W-\d{6}-[0-9A-Z]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORDER_DATE_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

const bad = (field, code = "invalid") => new HttpError(400, "invalid", { field, code });
const str = (v, n = 120) => (typeof v === "string" ? v.slice(0, n) : typeof v === "number" && Number.isFinite(v) ? String(v) : null);
const money = (v) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
};
const intOrNull = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const isNum = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
const istDay = (ms) => istDate(ms).slice(0, 10);
// courier agents' phone numbers can appear in tracking text: drop them (AWBs and dates stay readable)
const noPhones = (v, n = 160) => (typeof v === "string" ? v.replace(/(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, "[phone]").slice(0, n) : null);

function srIdOf(v, field) {
  const s = typeof v === "number" && Number.isInteger(v) ? String(v) : typeof v === "string" ? v.trim() : "";
  if (!SR_ID_RE.test(s)) throw bad(field);
  return s;
}

const awbOf = (s) => {
  const a = s?.awb ?? s?.awb_code;
  return a === null || a === undefined || String(a).trim() === "" ? null : String(a).trim().slice(0, 30);
};

// Shiprocket's message, shortened and scrubbed of digit runs and e-mails (it can echo buyer data).
const srMessage = (data) => {
  const m = [data?.message, data?.response, data?.error, data?.response?.data?.awb_assign_error].find((x) => typeof x === "string" && x);
  return typeof m === "string" && m ? redact(m).slice(0, 160) : undefined;
};

// A Shiprocket HTTP answer we cannot use -> our error (502 = upstream trouble, 422 = Shiprocket refused the input).
function srFail(r, ctx, code) {
  ctx.http = r.status;
  if (r.status === 403) return new HttpError(502, "shiprocket_forbidden", { http: 403, hint: "the API user may lack this module (Shiprocket Settings > API); that change needs Bhargava's OK" });
  if (r.status === 429 || r.status >= 500) return new HttpError(502, code || "shiprocket_error", { http: r.status, srMessage: srMessage(r.data) });
  return new HttpError(422, code || "shiprocket_rejected", { http: r.status, srMessage: srMessage(r.data) });
}

// ---------- auth ----------
async function requireAdmin(request, env) {
  const secret = typeof env.ADMIN_TOKEN === "string" ? env.ADMIN_TOKEN.trim() : "";
  if (secret.length < MIN_ADMIN_TOKEN_CHARS) throw new HttpError(503, "admin_not_configured");
  const m = BEARER_RE.exec(request.headers.get("authorization") || "");
  // always hash both sides (equal 32-byte digests), so neither timing nor length says anything about the token
  const same = timingSafeEqual(await sha256Bytes(m ? m[1] : ""), await sha256Bytes(secret));
  if (!m || !same) throw new HttpError(401, "unauthorised");
}

// ---------- Shiprocket reads shared by several routes ----------
async function readWallet(d, ctx) {
  const r = await srCall(d, "GET", "/account/details/wallet-balance");
  if (r.status !== 200) throw srFail(r, ctx);
  const n = money(r.data?.data?.balance_amount); // a string, can be negative
  if (n === null) throw new HttpError(502, "wallet_unreadable");
  return n;
}

async function readShipment(d, ctx, shipmentId) {
  const r = await srCall(d, "GET", `/shipments/${shipmentId}`);
  if (r.status === 404) throw new HttpError(404, "unknown_shipment");
  if (r.status !== 200) throw srFail(r, ctx);
  const s = r.data?.data;
  // an unknown id comes back as HTTP 200 with {}
  if (!s || typeof s !== "object" || Array.isArray(s) || String(s.id ?? s.shipment_id ?? "") !== shipmentId) throw new HttpError(404, "unknown_shipment");
  return s;
}

async function readOrder(d, ctx, srOrderId) {
  if (!SR_ID_RE.test(String(srOrderId ?? ""))) throw bad("srOrderId"); // never an empty or odd id in a Shiprocket path
  const r = await srCall(d, "GET", `/orders/show/${srOrderId}`);
  if (r.status === 400 || r.status === 404) throw new HttpError(404, "unknown_sr_order");
  if (r.status !== 200) throw srFail(r, ctx);
  const o = r.data?.data;
  if (!o || typeof o !== "object" || String(o.id ?? "") !== srOrderId) throw new HttpError(404, "unknown_sr_order");
  return o;
}

// shipment + its order + our reference (the channel order id: the Amazon id or 1AF-W-...)
async function loadShipment(d, ctx, shipmentId) {
  const shipment = await readShipment(d, ctx, shipmentId);
  const srOrderId = String(shipment.order_id ?? "");
  if (!SR_ID_RE.test(srOrderId)) throw new HttpError(502, "shipment_without_order");
  const order = await readOrder(d, ctx, srOrderId);
  return { shipment, order, srOrderId, awb: awbOf(shipment), ref: String(order.channel_order_id ?? "").slice(0, 40) };
}

// Why this Shiprocket order may not be booked by us (null = fine). `pickup` = the order's pickup nickname.
function orderRefusal(o, cfg, pickup) {
  if (String(o.payment_method ?? "").trim().toLowerCase() !== "prepaid" || Number(o.cod ?? 0) !== 0) return "not_prepaid";
  if (String(o.base_channel_code ?? "") !== "CS") return "not_custom_channel";
  if (pickup !== cfg.shiprocketPickup) return "wrong_pickup";
  return null;
}

// The public docs' GET /orders/show example has "pickup_location": "" (only the GET /orders list rows carry the
// nickname). So when orders/show leaves it empty, read it from this order's list row. Unreadable = "" = refused.
async function refusalOf(d, ctx, s) {
  let pickup = String(s.order.pickup_location ?? "").trim();
  if (!pickup && s.ref) {
    try {
      const row = (await searchOrders(d, ctx, s.ref)).find((m) => m.srOrderId === s.srOrderId && m.channelOrderId === s.ref);
      pickup = String(row?.pickupLocation ?? "").trim();
    } catch { pickup = ""; }
  }
  return orderRefusal(s.order, d.cfg, pickup);
}

// Pickup and label are free, but a pickup on a Delhivery (or any off-list) AWB breaks the courier rule just the same:
// an AWB can come from the web panel, an auto-assign or Shiprocket's fallback partner, not only from our booking.
async function requireAllowedCourier(d, s, shipmentId) {
  let courier = String(s.courier ?? s.courier_name ?? "").trim();
  if (!courier) {
    try { courier = String(JSON.parse(await d.store.kvGet(`srbooked:${shipmentId}`, d.now) || "{}").courier ?? "").trim(); } catch { courier = ""; }
  }
  if (!courier) throw new HttpError(403, "courier_not_allowed", { reason: "courier_unknown", hint: "use the Shiprocket panel for this one" });
  const k = classifyCourier(courier);
  if (!k.allowed) throw new HttpError(403, "courier_not_allowed", { reason: k.reason });
  return courier;
}

const deliveryPinOf = (o) => {
  const p = String(o.customer_pincode ?? o.pincode ?? "").trim();
  return PIN_RE.test(p) ? p : undefined;
};

const shipmentsOf = (o) => (Array.isArray(o?.shipments) ? o.shipments : o?.shipments && typeof o.shipments === "object" ? [o.shipments] : []);

// Serviceability (free). cod=0 always. With srOrderId Shiprocket uses that order's own weight and size.
async function serviceability(d, ctx, { deliveryPin, parcel, srOrderId, declaredRupees }) {
  const query = { pickup_postcode: d.cfg.shiprocketPickupPin, delivery_postcode: deliveryPin, cod: 0 };
  if (srOrderId) query.order_id = srOrderId;
  else Object.assign(query, { weight: String(parcel.weightKg), length: parcel.lengthCm, breadth: parcel.breadthCm, height: parcel.heightCm });
  if (declaredRupees) query.declared_value = declaredRupees;
  const r = await srCall(d, "GET", "/courier/serviceability/", { query });
  if (r.status !== 200) throw srFail(r, ctx);
  const data = r.data?.data;
  const list = Array.isArray(data?.available_courier_companies) ? data.available_courier_companies : null;
  // not serviceable / unknown order: HTTP 200 with {status: 404, message}
  if (!list) return { serviceable: false, srMessage: srMessage(r.data), all: [], ...splitCouriers([], []) };
  return { serviceable: true, all: list, ...splitCouriers(list, Array.isArray(data.blocked_courier_companies) ? data.blocked_courier_companies : []) };
}

// allowed couriers (cheapest first, then fastest), the rest flagged; Delhivery only counted, never named or priced.
// recommended_courier_company_id / shiprocket_recommended_courier_id are ignored on purpose.
function splitCouriers(list, blockedList) {
  const options = [];
  const notAllowed = [];
  let hidden = 0;
  for (const c of list) {
    const courier = String(c?.courier_name ?? "").slice(0, 80);
    const k = classifyCourier(courier);
    if (k.reason === "delhivery_never") { hidden++; continue; }
    const row = {
      courierId: intOrNull(c.courier_company_id), courier, rate: money(c.rate), freight: money(c.freight_charge),
      days: intOrNull(c.estimated_delivery_days), etd: str(c.etd, 40), cutoff: str(c.cutoff_time, 10),
      chargeWeightKg: money(c.charge_weight), surface: c.is_surface === true || c.is_surface === 1,
    };
    const blocked = c.blocked === 1 || c.blocked === true || c.blocked === "1";
    if (!k.allowed) notAllowed.push({ courierId: row.courierId, courier, rate: row.rate, reason: k.reason });
    else if (blocked) notAllowed.push({ courierId: row.courierId, courier, rate: row.rate, reason: "blocked_by_shiprocket" });
    else if (!(row.rate > 0) || row.courierId === null) notAllowed.push({ courierId: row.courierId, courier, rate: row.rate, reason: "no_rate" });
    else options.push(row);
  }
  options.sort((a, b) => a.rate - b.rate || (a.days ?? 99) - (b.days ?? 99) || a.courierId - b.courierId);
  const blocked = [];
  for (const b of blockedList) {
    const courier = String(b?.courier_name ?? "").slice(0, 80);
    if (BANNED_COURIER.test(courier)) { hidden++; continue; }
    blocked.push({ courier, reason: str(b?.block_reason, 80) });
  }
  return { options, notAllowed, delhivery: { hidden }, blocked };
}

function parcelOf(packs, p = {}) {
  if (!Number.isInteger(packs) || packs < 1 || packs > LIMITS.maxPacksPerOrder) throw bad("packs");
  const out = { ...parcelFor(packs) };
  const src = p && typeof p === "object" ? p : {};
  if (src.weightKg !== undefined) {
    if (!isNum(src.weightKg, 0.05, 30)) throw bad("weightKg");
    out.weightKg = Math.round(src.weightKg * 1000) / 1000;
    out.estimated = false;
  }
  for (const k of ["lengthCm", "breadthCm", "heightCm"]) {
    if (src[k] === undefined) continue;
    if (!isNum(src[k], 1, 200)) throw bad(k);
    out[k] = Math.round(src[k] * 10) / 10;
  }
  return out;
}

// ---------- GET /admin/sr/pickups ----------
async function pickups(d, { ctx }) {
  const r = await srCall(d, "GET", "/settings/company/pickup");
  if (r.status !== 200) throw srFail(r, ctx);
  const rows = Array.isArray(r.data?.data?.shipping_address) ? r.data.data.shipping_address : [];
  const flag = (v) => v === 1 || v === true || v === "1";
  // never the address, phone, e-mail or contact name
  const locations = rows.slice(0, 50).map((x) => ({
    id: intOrNull(x.id), nickname: String(x.pickup_location ?? "").slice(0, 60), city: str(x.city, 40), state: str(x.state, 40),
    pin: String(x.pin_code ?? "").slice(0, 6), status: typeof x.status === "number" || typeof x.status === "string" ? x.status : null,
    primary: flag(x.is_primary_location), phoneVerified: flag(x.phone_verified),
  }));
  const home = locations.find((l) => l.nickname === d.cfg.shiprocketPickup);
  ctx.count = locations.length;
  return {
    locations,
    home: { nickname: d.cfg.shiprocketPickup, expectedPin: d.cfg.shiprocketPickupPin, found: Boolean(home), pin: home?.pin ?? null, ok: Boolean(home) && home.pin === d.cfg.shiprocketPickupPin },
  };
}

// ---------- GET /admin/sr/wallet ----------
async function wallet(d, { ctx }) {
  const balanceRupees = await readWallet(d, ctx);
  return { balanceRupees, low: balanceRupees < LOW_WALLET_RUPEES };
}

// ---------- POST /admin/sr/quote ----------
async function quote(d, { body, ctx }) {
  const declared = body.declaredRupees;
  if (declared !== undefined && !isNum(declared, 1, 100000)) throw bad("declaredRupees");
  let q;
  let head;
  if (body.shipmentId !== undefined) {
    const shipmentId = srIdOf(body.shipmentId, "shipmentId");
    const s = await loadShipment(d, ctx, shipmentId);
    const to = deliveryPinOf(s.order);
    q = await serviceability(d, ctx, { srOrderId: s.srOrderId, deliveryPin: to, declaredRupees: declared });
    head = { shipmentId, srOrderId: s.srOrderId, ref: s.ref, awb: s.awb, refusal: await refusalOf(d, ctx, s), to: to ?? null, weightKg: money(s.shipment.weight), dims: null, parcelEstimated: false };
  } else if (body.orderId !== undefined) {
    const id = String(body.orderId).trim().slice(0, 40);
    if (!WEBSITE_ID_RE.test(id)) throw bad("orderId");
    const o = await d.store.getOrder(id);
    if (!o) throw new HttpError(404, "unknown_order");
    const parcel = parcelOf(o.packs);
    q = await serviceability(d, ctx, { deliveryPin: o.customer.pin, parcel, declaredRupees: declared ?? o.totalPaise / 100 });
    head = { orderId: id, to: o.customer.pin, weightKg: parcel.weightKg, dims: `${parcel.lengthCm}x${parcel.breadthCm}x${parcel.heightCm}`, parcelEstimated: parcel.estimated };
  } else {
    const pin = String(body.pin ?? "").trim();
    if (!PIN_RE.test(pin)) throw bad("pin");
    const parcel = parcelOf(body.packs === undefined ? 1 : body.packs, body.parcel ?? body);
    q = await serviceability(d, ctx, { deliveryPin: pin, parcel, declaredRupees: declared });
    head = { to: pin, weightKg: parcel.weightKg, dims: `${parcel.lengthCm}x${parcel.breadthCm}x${parcel.heightCm}`, parcelEstimated: parcel.estimated };
  }
  ctx.count = q.options.length;
  return {
    from: d.cfg.shiprocketPickupPin, pickup: d.cfg.shiprocketPickup, ...head, cod: 0, serviceable: q.serviceable, srMessage: q.srMessage,
    options: q.options, notAllowed: q.notAllowed, delhivery: q.delhivery, blocked: q.blocked,
    cheapest: q.options[0] || null, quotedAt: new Date(d.now).toISOString(),
  };
}

// ---------- POST /admin/sr/create (no AWB, free) ----------
const STATE_BY_LOWER = new Map(INDIAN_STATES.map((s) => [s.toLowerCase(), s]));
const canonicalState = (v) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return STATE_BY_LOWER.get(s.toLowerCase().replace(/&/g, "and")) ?? s;
};
const SKU_TO_CODE = new Map(Object.entries(CATALOGUE).map(([code, p]) => [p.sku, code]));

function marketplacePayload(d, body, orderId) {
  const raw = body.customer && typeof body.customer === "object" ? body.customer : {};
  // Amazon self-ship buyers show no e-mail; Shiprocket requires one, so the brand inbox stands in.
  const v = validateCustomer({ ...raw, state: canonicalState(raw.state), email: raw.email ? raw.email : d.cfg.alertTo });
  const errors = [...v.errors];
  // prepaid only: the marketplace order itself must have been paid (Seller Central's payment method). A
  // Pay-on-Delivery order is refused, never quietly shipped as Prepaid (the courier would collect nothing).
  const payment = typeof body.payment === "string" ? body.payment.trim().toLowerCase() : "";
  if (payment !== "prepaid") errors.push({ field: "payment", code: payment ? "cod_not_supported" : "required" });
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length || items.length > 10) errors.push({ field: "items", code: items.length ? "too_many_lines" : "required" });
  const lines = [];
  let packs = 0;
  let subPaise = 0;
  for (const it of items) {
    const code = String(it?.code ?? "").toUpperCase() || SKU_TO_CODE.get(String(it?.sku ?? "").trim().toUpperCase()) || "";
    const p = CATALOGUE[code];
    if (!p) { errors.push({ field: "items", code: "unknown_item", item: String(it?.sku ?? it?.code ?? "").slice(0, 20) }); continue; }
    const qty = it.qty;
    if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxQtyPerLine) { errors.push({ field: "items", code: "bad_qty", item: code }); continue; }
    const price = it.price ?? it.unitRupees ?? p.mrp; // the marketplace sale price per unit (incl. GST), never above the MRP
    if (!isNum(price, 1, p.mrp)) { errors.push({ field: "items", code: "bad_price", item: code, mrp: p.mrp }); continue; }
    const pricePaise = Math.round(price * 100);
    lines.push({ name: `${p.name} ${p.grams} g`, sku: p.sku, units: qty, selling_price: pricePaise / 100, ...(p.hsn ? { hsn: p.hsn } : {}) });
    packs += qty;
    subPaise += pricePaise * qty;
  }
  if (packs > LIMITS.maxPacksPerOrder) errors.push({ field: "items", code: "too_many_packs" });
  if (body.orderDate !== undefined && !(typeof body.orderDate === "string" && ORDER_DATE_RE.test(body.orderDate))) errors.push({ field: "orderDate", code: "invalid" });
  if (errors.length) throw new HttpError(400, "invalid", { errors });
  const parcel = parcelOf(packs, body.parcel);
  const c = v.value;
  const [first, ...rest] = c.name.split(" ");
  return {
    parcel,
    payload: {
      order_id: orderId,
      order_date: body.orderDate ?? istDate(d.now),
      pickup_location: d.cfg.shiprocketPickup,
      billing_customer_name: first,
      billing_last_name: rest.join(" "),
      billing_address: c.address,
      billing_city: c.city,
      billing_pincode: c.pin,
      billing_state: c.state,
      billing_country: "India",
      billing_email: c.email,
      billing_phone: c.phone,
      shipping_is_billing: true,
      order_items: lines,
      payment_method: "Prepaid",
      shipping_charges: 0,
      sub_total: subPaise / 100,
      length: parcel.lengthCm,
      breadth: parcel.breadthCm,
      height: parcel.heightCm,
      weight: parcel.weightKg,
    },
  };
}

async function create(d, { body, ctx }) {
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  let payload;
  let parcel = null;
  let website = null;
  if (WEBSITE_ID_RE.test(orderId)) {
    // re-push one of OUR paid website orders whose automatic push gave up (or was off): everything comes from D1
    if (body.customer !== undefined || body.items !== undefined) throw bad("customer", "website_order_comes_from_d1");
    website = await d.store.getOrder(orderId);
    if (!website) throw new HttpError(404, "unknown_order");
    if (website.status !== "paid") throw new HttpError(409, "not_paid");
    // pending/retry/pushing belong to the automatic push (cron); pushed is done
    if (!["failed", "skipped"].includes(website.shipStatus)) throw new HttpError(409, "push_not_failed", { shipStatus: website.shipStatus });
    payload = buildShiprocketOrder(website, d.cfg);
  } else if (AMAZON_ID_RE.test(orderId) || FLIPKART_ID_RE.test(orderId)) {
    ({ payload, parcel } = marketplacePayload(d, body, orderId));
  } else {
    throw bad("orderId");
  }
  const r = await srCall(d, "POST", "/orders/create/adhoc", { body: payload });
  if (r.status === 422 && /already\s+exist/i.test(JSON.stringify(r.data ?? ""))) {
    ctx.http = 422;
    let matches = [];
    try { matches = (await searchOrders(d, ctx, orderId)).filter((m) => m.channelOrderId === orderId); } catch { /* best effort */ }
    throw new HttpError(409, "already_exists", { matches });
  }
  if (r.status !== 200) throw srFail(r, ctx);
  const srOrderId = r.data?.order_id;
  if (srOrderId === undefined || srOrderId === null) throw new HttpError(502, "no_order_id");
  const srShipmentId = r.data?.shipment_id === undefined || r.data?.shipment_id === null ? null : String(r.data.shipment_id);
  if (website) {
    await d.store.updateShipment(orderId, { shipStatus: "pushed", shipNextAt: null, shipError: null, srOrderId: String(srOrderId), srShipmentId }, d.now);
  }
  // The create reply carries awb_code / courier_name (public docs example). With courier auto-assign on in the
  // account, creating an order can assign an AWB (and charge the wallet) with no "ship <ID>", on any courier.
  const autoAwb = awbOf({ awb: r.data?.awb_code });
  if (autoAwb) {
    const courier = String(r.data?.courier_name ?? "").slice(0, 80);
    const k = classifyCourier(courier);
    if (srShipmentId && SR_ID_RE.test(srShipmentId)) {
      // book must refuse this shipment even if a later read misses the AWB
      await d.store.recordEvent(`srbook:${srShipmentId}`, d.now);
      await d.store.kvSet(`srbooked:${srShipmentId}`, JSON.stringify({ awb: autoAwb, courierId: intOrNull(r.data?.courier_company_id), courier, rate: null, at: d.now, auto: true }), null);
    }
    ctx.reason = "awb_auto_assigned";
    d.defer(sendOwnerAlert(d, {
      subject: `${k.allowed ? "CHECK" : "URGENT"}: Shiprocket auto-assigned AWB ${autoAwb} at order create for ${orderId}`,
      lines: [`Creating ${orderId} in Shiprocket (order ${srOrderId}, shipment ${srShipmentId ?? "-"}) came back with AWB ${autoAwb} on ${courier || "(courier not named)"}, without a "ship <ID>".`,
        k.allowed ? "The courier is on the allow-list, but wallet money may have been spent without Bhargava's OK." : "That courier is NOT DTDC / Blue Dart / India Post: do not hand the parcel over; cancelling the AWB needs Bhargava's OK.",
        "Turn off courier auto-assign in Shiprocket (Settings > Courier) so creating an order never books one (needs Bhargava's OK)."],
    }));
    throw new HttpError(409, "awb_auto_assigned", { srOrderId: String(srOrderId), srShipmentId, awb: autoAwb, courierAllowed: k.allowed, courierReason: k.allowed ? undefined : k.reason });
  }
  return {
    orderId, srOrderId: String(srOrderId), srShipmentId, status: str(r.data?.status, 30), pickup: payload.pickup_location,
    weightKg: payload.weight, dims: `${payload.length}x${payload.breadth}x${payload.height}`, parcelEstimated: parcel ? parcel.estimated : website.packs > 3,
  };
}

// ---------- POST /admin/sr/book (SPENDS WALLET MONEY) ----------
function parsePickup(v, now) {
  if (v === "none") return { mode: "none" };
  if (v === "today") return { mode: "today", date: null };
  if (typeof v === "string" && DATE_RE.test(v)) {
    const real = new Date(`${v}T00:00:00Z`);
    if (Number.isNaN(real.getTime()) || real.toISOString().slice(0, 10) !== v) throw bad("pickup");
    const today = istDay(now);
    if (v < today || v > istDay(now + 7 * 24 * 3600 * 1000)) throw bad("pickup", "date_out_of_range");
    return { mode: "date", date: v === today ? null : v };
  }
  throw new HttpError(400, "pickup_required", { allowed: ["today", "YYYY-MM-DD", "none"] });
}

async function requestPickup(d, ctx, shipmentId, date, retry = false) {
  try {
    const r = await srCall(d, "POST", "/courier/generate/pickup", { body: { shipment_id: [Number(shipmentId)], ...(date ? { pickup_date: [date] } : {}), ...(retry ? { status: "retry" } : {}) } });
    if (r.status !== 200 || !(r.data?.pickup_status === 1 || r.data?.pickup_status === true)) return { ok: false, reason: "pickup_not_scheduled", http: r.status, srMessage: srMessage(r.data) };
    return { ok: true, scheduledDate: str(r.data?.response?.pickup_scheduled_date, 40), token: str(r.data?.response?.pickup_token_number, 60) };
  } catch (e) {
    if (e instanceof ShiprocketError) return { ok: false, reason: e.reason };
    throw e;
  }
}

async function makeLabel(d, shipmentId) {
  try {
    const r = await srCall(d, "POST", "/courier/generate/label", { body: { shipment_id: [Number(shipmentId)] } });
    const url = r.data?.label_url;
    if (r.status !== 200 || !(r.data?.label_created === 1 || r.data?.label_created === true) || typeof url !== "string" || !/^https:\/\//.test(url)) {
      return { ok: false, reason: "label_not_created", http: r.status, srMessage: srMessage(r.data) };
    }
    return { ok: true, labelUrl: url.slice(0, 1000) };
  } catch (e) {
    if (e instanceof ShiprocketError) return { ok: false, reason: e.reason };
    throw e;
  }
}

async function makeManifest(d, shipmentId) {
  try {
    const r = await srCall(d, "POST", "/manifests/generate", { body: { shipment_id: [Number(shipmentId)] } });
    const url = r.data?.manifest_url;
    if (r.status !== 200 || typeof url !== "string" || !/^https:\/\//.test(url)) return { ok: false, reason: "manifest_not_created", http: r.status, srMessage: srMessage(r.data) };
    return { ok: true, manifestUrl: url.slice(0, 1000) };
  } catch (e) {
    if (e instanceof ShiprocketError) return { ok: false, reason: e.reason };
    throw e;
  }
}

async function book(d, { body, ctx }) {
  const shipmentId = srIdOf(body.shipmentId, "shipmentId");
  const courierId = body.courierId;
  if (!Number.isInteger(courierId) || courierId < 1 || courierId > 99999) throw bad("courierId");
  if (!isNum(body.maxRupees, 1, 2000)) throw bad("maxRupees");
  const maxRupees = body.maxRupees;
  const pickupReq = parsePickup(body.pickup, d.now);
  // a. the typed confirmation for THIS shipment
  if (body.confirm !== `ship ${shipmentId}`) throw new HttpError(400, "confirm_required", { expected: `ship ${shipmentId}` });
  // b. what Bhargava typed: "ship <ID>", one shipment per call (checked against the order below)
  const said = /^ship (\S{1,40})$/.exec(typeof body.said === "string" ? body.said.trim() : "");
  if (!said) throw new HttpError(400, "said_required", { expected: "ship <the ID exactly as Bhargava typed it>" });
  if (said[1].toLowerCase() === "all") throw new HttpError(400, "one_shipment_per_call");

  // c. once-only lock (atomic INSERT OR IGNORE): a second call while this one runs, or after it booked, is refused
  const lock = `srbook:${shipmentId}`;
  if (!(await d.store.recordEvent(lock, d.now))) {
    const done = await d.store.kvGet(`srbooked:${shipmentId}`, d.now);
    let booked;
    try { booked = done ? JSON.parse(done) : undefined; } catch { booked = undefined; }
    throw new HttpError(409, "already_booking_or_booked", booked ? { booked } : { hint: "if a booking timed out: tools/sr.py track --shipment <id>, then tools/sr.py unlock <id> when it has no AWB" });
  }
  let keepLock = false;
  try {
    // d. the shipment and its order, as Shiprocket has them now
    const s = await loadShipment(d, ctx, shipmentId);
    if (said[1] !== s.ref && said[1] !== shipmentId) throw new HttpError(400, "said_mismatch", { ref: s.ref });
    if (s.awb) {
      keepLock = true;
      throw new HttpError(409, "already_booked", { awb: s.awb });
    }
    const refusal = await refusalOf(d, ctx, s);
    if (refusal) throw new HttpError(409, refusal);

    // e. live re-quote for this very order (its own weight and size), cod=0
    const q = await serviceability(d, ctx, { srOrderId: s.srOrderId, deliveryPin: deliveryPinOf(s.order) });
    const offered = q.all.find((c) => intOrNull(c?.courier_company_id) === courierId);
    if (!offered) throw new HttpError(409, "courier_not_offered", { courierId });
    const k = classifyCourier(offered.courier_name);
    if (!k.allowed) throw new HttpError(403, "courier_not_allowed", { reason: k.reason });
    if (offered.blocked === 1 || offered.blocked === true || offered.blocked === "1") throw new HttpError(409, "courier_blocked");
    const rate = money(offered.rate);
    if (!(rate > 0)) throw new HttpError(502, "bad_quote");
    if (rate > maxRupees) throw new HttpError(409, "price_changed", { rate, maxRupees });
    if (rate > d.cfg.srBookMaxRupees) throw new HttpError(409, "over_cap", { rate, cap: d.cfg.srBookMaxRupees });

    // f. wallet
    const balance = await readWallet(d, ctx);
    if (balance < rate) throw new HttpError(402, "wallet_short", { balanceRupees: balance, rate });

    // g onwards SPENDS MONEY. It runs as one promise that is ALSO handed to ctx.waitUntil: Cloudflare cancels a
    // request's own work when the client disconnects (this Mac's Wi-Fi drops for 20-30 s), and waitUntil keeps the
    // AWB record, pickup, label and owner alert going for up to 30 s more. The reply still waits for it.
    const spend = (async () => {
      // g. THE ONE CALL THAT SPENDS MONEY: always with our courier_id; never status "reassign"; never auto-retried
      let a;
      try {
        a = await srCall(d, "POST", "/courier/assign/awb", { body: { shipment_id: Number(shipmentId), courier_id: courierId } });
      } catch (e) {
        if (e instanceof ShiprocketError && (e.reason === "timeout" || e.reason === "network")) {
          keepLock = true; // the request may have reached Shiprocket: never let a retry book twice
          ctx.reason = e.reason;
          throw new HttpError(504, "awb_unknown", { hint: `check with tools/sr.py track --shipment ${shipmentId} (or find ${s.ref}); only if it has no AWB after a few minutes: tools/sr.py unlock ${shipmentId}` });
        }
        throw e; // login trouble: the assign request was never sent
      }
      const got = a.data?.response?.data;
      const awb = awbOf(got);
      if (a.status !== 200 || !(a.data?.awb_assign_status === 1) || !awb) {
        ctx.http = a.status;
        // a definite answer without an AWB; re-read the shipment before freeing the lock
        let awbNow;
        try { awbNow = awbOf(await readShipment(d, ctx, shipmentId)); } catch { keepLock = true; throw new HttpError(504, "awb_unknown", { http: a.status, srMessage: srMessage(a.data) }); }
        if (awbNow) { keepLock = true; throw new HttpError(409, "already_booked", { awb: awbNow }); }
        throw new HttpError(502, "awb_not_assigned", { http: a.status, srMessage: srMessage(a.data) });
      }
      keepLock = true;
      const courier = String(got.courier_name || offered.courier_name || "").slice(0, 80);
      const child = String(got.child_courier_name ?? "").slice(0, 80);
      const bookedId = intOrNull(got.courier_company_id) ?? courierId;
      const ref = s.ref || shipmentId;
      // the record of what was bought must never hide the AWB from the reply
      let recorded = true;
      try {
        await d.store.kvSet(`srbooked:${shipmentId}`, JSON.stringify({ awb, courierId: bookedId, courier, rate, at: d.now }), null);
      } catch {
        recorded = false;
        ctx.reason = "srbooked_write_failed";
      }
      // the allow-list again, on what Shiprocket actually booked (its courier, a child courier, the courier id)
      const kc = classifyCourier(courier);
      const bannedChild = BANNED_COURIER.test(child);
      if (!kc.allowed || bannedChild || bookedId !== courierId) {
        // impossible after step e, unless Shiprocket overrode the courier: stop here, no pickup, shout
        const banned = kc.reason === "delhivery_never" || bannedChild;
        d.log("admin_sr_wrong_courier", { route: "/admin/sr/book", reason: banned ? "delhivery" : !kc.allowed ? "not_on_allow_list" : "courier_changed" });
        d.defer(sendOwnerAlert(d, {
          subject: `URGENT: ${ref} booked on ${courier}${child ? ` / ${child}` : ""} (asked for courier id ${courierId})`,
          lines: [`Shiprocket assigned AWB ${awb} on ${courier}${child ? ` (child courier ${child})` : ""}, courier id ${bookedId}, for shipment ${shipmentId} although courier id ${courierId} was asked.`,
            "No pickup was requested. Cancel this AWB in Shiprocket (needs Bhargava's OK) and book again on DTDC / Blue Dart / India Post."],
        }));
        throw new HttpError(502, banned ? "booked_banned_courier" : "booked_other_courier", { awb, courier, courierId: bookedId });
      }

      // h-i. pickup, label, manifest: free; a failure here never undoes the booking
      const pickup = pickupReq.mode === "none" ? { requested: false } : { requested: true, ...(await requestPickup(d, ctx, shipmentId, pickupReq.date)) };
      const label = await makeLabel(d, shipmentId);
      const manifest = body.manifest === true && pickup.ok ? await makeManifest(d, shipmentId) : null;
      let walletAfterRupees = null;
      try { walletAfterRupees = await readWallet(d, ctx); } catch { /* shown as unknown */ }
      const walletLow = walletAfterRupees !== null && walletAfterRupees < LOW_WALLET_RUPEES;
      // j. what the wallet actually lost vs the quoted rate (unverified whether the rate includes GST): flag, never undo.
      // Approximate: a recharge or another booking in between moves the wallet too.
      const chargedRupees = walletAfterRupees === null ? null : Math.round((balance - walletAfterRupees) * 100) / 100;
      const chargedOver = chargedRupees !== null && (chargedRupees > maxRupees || chargedRupees > d.cfg.srBookMaxRupees);
      if (chargedOver) ctx.reason = ctx.reason || "charged_over_max";

      // k. owner alert: no address, phone, buyer name or label link
      d.defer(sendOwnerAlert(d, {
        subject: `${chargedOver ? "CHECK " : ""}Booked ${ref}: ${courier} AWB ${awb} Rs ${rate}`,
        lines: [
          `Shipment ${shipmentId} (Shiprocket order ${s.srOrderId}), our ref ${ref}: ${courier}, AWB ${awb}, Rs ${rate}.`,
          ...(chargedOver ? [`CHARGED Rs ${chargedRupees} > max Rs ${Math.min(maxRupees, d.cfg.srBookMaxRupees)} (wallet before Rs ${balance}, after Rs ${walletAfterRupees}): the quoted rate may exclude GST; adjust the cap.`] : []),
          `Pickup: ${pickup.requested ? (pickup.ok ? `scheduled ${pickup.scheduledDate || "(date not given)"}` : `NOT scheduled (${pickup.reason})`) : "none requested (counter drop)"}.`,
          `Label: ${label.ok ? "made (tools/sr.py label)" : `NOT made (${label.reason})`}.`,
          `Wallet after: ${walletAfterRupees === null ? "unknown" : `Rs ${walletAfterRupees}`}${walletLow ? " (LOW: top up)" : ""}.`,
          ...(recorded ? [] : ["The booking record (srbooked) could not be written to D1; the booking lock still holds."]),
          `Said: "${said[0]}".`,
        ],
      }));
      ctx.count = 1;
      return {
        shipmentId, srOrderId: s.srOrderId, ref, awb, courier, courierId: bookedId, rate,
        pickup, labelUrl: label.ok ? label.labelUrl : null, labelError: label.ok ? undefined : label.reason,
        manifestUrl: manifest?.ok ? manifest.manifestUrl : undefined, manifestError: manifest && !manifest.ok ? manifest.reason : undefined,
        walletAfterRupees, walletLow, chargedRupees, chargedOverMax: chargedOver || undefined, recorded: recorded ? undefined : false,
      };
    })();
    d.defer(spend.then(() => {}, () => {})); // errors are answered below, not logged twice
    return await spend;
  } finally {
    if (!keepLock) await d.store.forgetEvent(lock);
  }
}

// ---------- POST /admin/sr/pickup, /label, /unlock ----------
async function pickupRoute(d, { body, ctx }) {
  const shipmentId = srIdOf(body.shipmentId, "shipmentId");
  let date = null;
  if (body.date !== undefined) date = parsePickup(body.date, d.now).date;
  const s = await readShipment(d, ctx, shipmentId);
  if (!awbOf(s)) throw new HttpError(409, "no_awb");
  await requireAllowedCourier(d, s, shipmentId);
  const r = await requestPickup(d, ctx, shipmentId, date, body.retry === true);
  if (!r.ok) throw new HttpError(502, "pickup_not_scheduled", { reason: r.reason, http: r.http, srMessage: r.srMessage });
  return { shipmentId, scheduledDate: r.scheduledDate, token: r.token };
}

async function labelRoute(d, { body, ctx }) {
  const shipmentId = srIdOf(body.shipmentId, "shipmentId");
  const s = await readShipment(d, ctx, shipmentId);
  const awb = awbOf(s);
  if (!awb) throw new HttpError(409, "no_awb");
  await requireAllowedCourier(d, s, shipmentId);
  const r = await makeLabel(d, shipmentId);
  if (!r.ok) throw new HttpError(502, "label_not_created", { reason: r.reason, http: r.http, srMessage: r.srMessage });
  return { shipmentId, awb, labelUrl: r.labelUrl };
}

async function unlock(d, { body, ctx }) {
  const shipmentId = srIdOf(body.shipmentId, "shipmentId");
  if (body.confirm !== `unlock ${shipmentId}`) throw new HttpError(400, "confirm_required", { expected: `unlock ${shipmentId}` });
  if (await d.store.kvGet(`srbooked:${shipmentId}`, d.now)) throw new HttpError(409, "already_booked");
  const awb = awbOf(await readShipment(d, ctx, shipmentId));
  if (awb) throw new HttpError(409, "already_booked", { awb });
  await d.store.forgetEvent(`srbook:${shipmentId}`);
  return { unlocked: shipmentId };
}

// ---------- POST /admin/sr/cancel (before an AWB only; irreversible) ----------
async function cancel(d, { body, ctx }) {
  let srOrderId;
  let given;
  if (body.srOrderId !== undefined) {
    srOrderId = srIdOf(body.srOrderId, "srOrderId");
    given = srOrderId;
  } else {
    given = typeof body.ref === "string" ? body.ref.trim() : "";
    if (!REF_RE.test(given)) throw bad("ref");
  }
  if (body.confirm !== `cancel ${given}`) throw new HttpError(400, "confirm_required", { expected: `cancel ${given}` });
  if (!srOrderId) {
    const m = (await searchOrders(d, ctx, given)).filter((x) => x.channelOrderId === given);
    if (m.length !== 1) throw new HttpError(m.length ? 409 : 404, m.length ? "ambiguous_ref" : "unknown_ref", { count: m.length });
    if (!SR_ID_RE.test(m[0].srOrderId)) throw new HttpError(502, "search_without_order_id");
    srOrderId = m[0].srOrderId;
  }
  const o = await readOrder(d, ctx, srOrderId);
  // a channel-imported order (Amazon/Flipkart channel) could push "Cancelled" back to the marketplace
  if (String(o.base_channel_code ?? "") !== "CS") throw new HttpError(409, "not_custom_channel");
  if (/cancel/i.test(String(o.status ?? ""))) throw new HttpError(409, "already_cancelled");
  // A second guard that does not depend on the AWB field names: only a NEW order (status_code 1) is cancelled here.
  // Shiprocket moves an order past NEW once an AWB is assigned.
  const st = String(o.status ?? "").trim().toUpperCase();
  if (!(st ? st === "NEW" : Number(o.status_code) === 1)) throw new HttpError(409, "not_new", { status: str(o.status, 40) });
  const ships = shipmentsOf(o);
  if (!ships.length) throw new HttpError(409, "cannot_check_awb");
  for (const sh of ships) {
    let awb = awbOf(sh);
    const sid = String(sh?.id ?? "");
    if (!awb && SR_ID_RE.test(sid)) awb = awbOf(await readShipment(d, ctx, sid));
    else if (!awb) throw new HttpError(409, "cannot_check_awb");
    if (awb) throw new HttpError(409, "awb_assigned", { awb, hint: "cancelling after an AWB needs Bhargava's OK each time (Shiprocket panel); not done here" });
  }
  const r = await srCall(d, "POST", "/orders/cancel", { body: { ids: [Number(srOrderId)] } });
  if (r.status !== 200 && r.status !== 204) throw srFail(r, ctx);
  ctx.count = 1;
  return { cancelled: srOrderId, ref: String(o.channel_order_id ?? "").slice(0, 40) };
}

// ---------- GET /admin/sr/find, /track ----------
async function searchOrders(d, ctx, ref) {
  const r = await srCall(d, "GET", "/orders", { query: { search: ref, per_page: 20 } });
  if (r.status !== 200) throw srFail(r, ctx);
  const rows = Array.isArray(r.data?.data) ? r.data.data : [];
  return rows.slice(0, 20).map((o) => {
    const sh = shipmentsOf(o)[0] || null;
    return {
      srOrderId: String(o?.id ?? ""), channelOrderId: String(o?.channel_order_id ?? "").slice(0, 40), channel: str(o?.channel_name, 40),
      status: str(o?.status, 40), shipmentId: sh?.id !== undefined && sh?.id !== null ? String(sh.id) : null, awb: awbOf(sh), courier: str(sh?.courier, 60),
      pickupLocation: str(o?.pickup_location, 60),
    };
  });
}

async function find(d, { query, ctx }) {
  const ref = String(query.get("ref") ?? "").trim();
  if (!REF_RE.test(ref)) throw bad("ref");
  const matches = await searchOrders(d, ctx, ref);
  ctx.count = matches.length;
  return { ref, matches };
}

// picked up = the courier has the parcel (not "pickup scheduled" / "out for pickup"). Only structured fields count:
// the pickup date, Shiprocket's numeric status, the status labels. Never the courier's free-text activity ("Shipment
// not picked up - seller not available", "Pickup executive reached seller location" are NOT pickups).
const PICKED_RE = /(?<!\bnot\s)(?<!\bnot\s+yet\s)(?<!\bwill\s+be\s)\b(picked\s*up|in\s*transit|shipped|out\s*for\s*delivery|delivered|reached\s+at\s+destination|rto)\b/i;
// Shiprocket shipment status codes that only exist once the courier has the parcel: 6 shipped, 7 delivered,
// 9 RTO initiated, 10 RTO delivered, 17 out for delivery, 18 in transit, 38 reached destination hub, 40 RTO NDR,
// 41 RTO OFD, 42 picked up, 46 RTO in transit
const PICKED_CODES = new Set([6, 7, 9, 10, 17, 18, 38, 40, 41, 42, 46]);

async function track(d, { query, ctx }) {
  const awb = query.get("awb");
  const shipment = query.get("shipment");
  const ref = query.get("ref");
  if ([awb, shipment, ref].filter((v) => v !== null).length !== 1) throw bad("awb|shipment|ref", "exactly_one");
  let r;
  if (awb !== null) {
    if (!AWB_RE.test(awb)) throw bad("awb");
    r = await srCall(d, "GET", `/courier/track/awb/${awb}`);
  } else if (shipment !== null) {
    r = await srCall(d, "GET", `/courier/track/shipment/${srIdOf(shipment, "shipment")}`);
  } else {
    if (!REF_RE.test(ref)) throw bad("ref");
    r = await srCall(d, "GET", "/courier/track", { query: { order_id: ref } });
  }
  if (r.status === 404) throw new HttpError(404, "not_found");
  if (r.status !== 200) throw srFail(r, ctx);
  let td = r.data?.tracking_data;
  if (!td && Array.isArray(r.data)) {
    for (const el of r.data) {
      td = el?.tracking_data ?? Object.values(el || {}).find((v) => v && typeof v === "object" && v.tracking_data)?.tracking_data;
      if (td) break;
    }
  }
  if (!td || typeof td !== "object") return { noActivity: true };
  if (Number(td.track_status) !== 1) return { noActivity: true, message: noPhones(td.error) || undefined };
  const st = (Array.isArray(td.shipment_track) ? td.shipment_track[0] : null) || {};
  const rawActs = (Array.isArray(td.shipment_track_activities) ? td.shipment_track_activities : []).slice(0, 15);
  const activities = rawActs.map((a) => ({
    date: str(a?.date, 30), activity: noPhones(a?.activity), location: noPhones(a?.location, 80), label: str(a?.["sr-status-label"], 40),
  }));
  const pickupDate = str(st.pickup_date, 30) || null;
  const shipmentStatus = typeof td.shipment_status === "number" ? td.shipment_status : intOrNull(td.shipment_status);
  const pickedUp = Boolean(pickupDate) || PICKED_CODES.has(shipmentStatus) || PICKED_RE.test(String(st.current_status ?? ""))
    || rawActs.some((a) => PICKED_CODES.has(intOrNull(a?.["sr-status"])) || PICKED_RE.test(String(a?.["sr-status-label"] ?? "")));
  const courierName = str(st.courier_name, 60);
  ctx.count = activities.length;
  return {
    awb: str(st.awb_code, 30) || awb || null, courier: courierName, courierAllowed: courierName ? classifyCourier(courierName).allowed : null,
    currentStatus: str(st.current_status, 60), shipmentStatus,
    pickedUp, pickupDate, deliveredDate: str(st.delivered_date, 30) || null, edd: str(st.edd, 30) || null, etd: str(td.etd, 30) || null,
    trackUrl: str(td.track_url, 200), activities,
  };
}

// ---------- dispatch ----------
const ROUTES = Object.freeze({
  "/admin/sr/pickups": ["GET", pickups],
  "/admin/sr/wallet": ["GET", wallet],
  "/admin/sr/track": ["GET", track],
  "/admin/sr/find": ["GET", find],
  "/admin/sr/quote": ["POST", quote],
  "/admin/sr/create": ["POST", create],
  "/admin/sr/book": ["POST", book],
  "/admin/sr/pickup": ["POST", pickupRoute],
  "/admin/sr/label": ["POST", labelRoute],
  "/admin/sr/cancel": ["POST", cancel],
  "/admin/sr/unlock": ["POST", unlock],
});

// Every /admin/* request. Returns the Response itself: index.js must NOT pass it through its CORS reply().
export async function handleAdmin(request, route, url, d) {
  const t0 = Date.now();
  const ctx = { http: undefined, reason: undefined, count: undefined };
  let res;
  try {
    await requireAdmin(request, d.env);
    const r = ROUTES[route];
    if (!r) throw new HttpError(404, "not_found");
    if (request.method !== r[0]) throw new HttpError(405, "method_not_allowed", { allow: r[0] });
    const body = r[0] === "POST" ? await readJson(request, 8192) : null;
    res = json({ ok: true, ...(await r[1](d, { body, query: url.searchParams, ctx })) });
  } catch (e) {
    if (e instanceof HttpError) {
      const headers = e.status === 401 ? { "www-authenticate": "Bearer" } : e.status === 405 ? { allow: e.extra.allow } : {};
      res = json({ ok: false, error: e.code, ...e.extra }, e.status, headers);
      ctx.reason = ctx.reason || e.code;
    } else if (e instanceof ShiprocketError) {
      const notConfigured = e.reason === "not_configured";
      const status = notConfigured ? 503 : /timeout/.test(e.reason) ? 504 : 502;
      res = json({ ok: false, error: notConfigured ? "shiprocket_not_configured" : "shiprocket_unavailable", reason: e.reason, http: e.http || undefined, detail: e.detail || undefined }, status);
      ctx.reason = e.reason;
      ctx.http = e.http || ctx.http;
    } else {
      d.log("unhandled_error", { route: route.slice(0, 40), reason: e?.name || "error" });
      res = json({ ok: false, error: "server_error" }, 500);
    }
  }
  d.log("admin_sr", { route: route.slice(0, 40), status: res.status, http: ctx.http, reason: ctx.reason, count: ctx.count, ms: Date.now() - t0 });
  return res;
}

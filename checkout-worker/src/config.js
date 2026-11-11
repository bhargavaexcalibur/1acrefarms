// Runtime configuration. Plain vars come from wrangler.toml [vars]; secrets from `wrangler secret put`.
//
// LIVE MODE IS HARD-DISABLED BY DEFAULT.
//   MODE unset or "test"  -> test mode: Razorpay test keys only (rzp_test_...), Cashfree sandbox, PhonePe UAT.
//   MODE = "live"         -> refuses every new order unless the secret LIVE_ENABLED is exactly
//                            "yes-owner-approved" (set by Bhargava after the licence/legal check), and
//                            the Razorpay key is a live key.
//   Any other MODE value  -> refuses every new order (fail closed).
// Webhooks, /verify and the scheduled job keep working in every mode: they only record payments that
// already happened, so a payment is never lost.

export const LIVE_APPROVAL = "yes-owner-approved";

export const ALLOWED_ORIGINS = Object.freeze(["https://1acrefarms.co.in", "https://www.1acrefarms.co.in"]);

const int = (v, d) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

// Payment gateways, tried in this order for every new order (failover on a 4xx/5xx from the create API,
// a network error or a timeout). Config only, no code change:
//   GATEWAY_ORDER = "razorpay,cashfree,phonepe"   default: Razorpay, then Cashfree, then PhonePe
//   GATEWAY_ORDER = "cashfree,razorpay"           Cashfree first, PhonePe switched off
//   GATEWAY_ORDER = "none"                        no gateway: new orders are refused (503)
// Unknown names are ignored and a repeated name counts once. Unset or blank = the default.
export const GATEWAYS = Object.freeze(["razorpay", "cashfree", "phonepe"]);
export const DEFAULT_GATEWAY_ORDER = GATEWAYS.join(",");

export function parseGatewayOrder(value) {
  const raw = value === undefined || value === null || String(value).trim() === "" ? DEFAULT_GATEWAY_ORDER : String(value);
  const out = [];
  for (const part of raw.split(",")) {
    const g = part.trim().toLowerCase();
    if (GATEWAYS.includes(g) && !out.includes(g)) out.push(g);
  }
  return Object.freeze(out);
}

export function loadConfig(env = {}) {
  const rawMode = env.MODE === undefined || env.MODE === null || String(env.MODE).trim() === "" ? "test" : String(env.MODE).trim();
  const mode = rawMode === "test" || rawMode === "live" ? rawMode : "invalid";
  const live = mode === "live";
  // Local development only: extra CORS origins (e.g. http://localhost:4321), honoured in test mode only.
  const devOrigins = mode === "test"
    ? String(env.DEV_ORIGINS || "").split(",").map((s) => s.trim()).filter((s) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(s))
    : [];
  return Object.freeze({
    mode,
    rawMode,
    liveApproved: env.LIVE_ENABLED === LIVE_APPROVAL,
    allowedOrigins: Object.freeze([...ALLOWED_ORIGINS, ...devOrigins]),

    gatewayOrder: parseGatewayOrder(env.GATEWAY_ORDER),
    gatewayTimeoutMs: int(env.GATEWAY_TIMEOUT_MS, 6000), // per gateway, per create (PhonePe: token + create together)

    razorpayApi: "https://api.razorpay.com/v1",
    cashfreeApi: live ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
    cashfreeApiVersion: env.CASHFREE_API_VERSION || "2025-01-01",
    cashfreeJsMode: live ? "production" : "sandbox",

    // PhonePe PG Standard Checkout (v2). UAT ("pg-sandbox") in test mode; production hosts ONLY with MODE=live.
    // Hosts: developer.phonepe.com/payment-gateway/website-integration/standard-checkout/api-integration/api-reference/authorization
    // and .../create-payment (same as PhonePe's own Node SDK, pg-sdk-node 2.0.2 BaseUrl.js).
    phonepeApi: live ? "https://api.phonepe.com/apis/pg" : "https://api-preprod.phonepe.com/apis/pg-sandbox",
    phonepeAuthApi: live ? "https://api.phonepe.com/apis/identity-manager" : "https://api-preprod.phonepe.com/apis/pg-sandbox",
    phonepeMode: live ? "production" : "sandbox",
    // How long the PhonePe payment page stays open: 300-3600 s per PhonePe; default 20 min.
    phonepeExpireAfterSec: Math.min(3600, Math.max(300, int(env.PHONEPE_EXPIRE_AFTER_SEC, 1200))),

    shiprocketApi: "https://apiv2.shiprocket.in/v1/external",
    // Shiprocket has no sandbox: pushing is OFF in test mode unless SHIPROCKET_PUSH = "on"
    // (for the one real test order, cancelled afterwards). In live mode it is on unless "off".
    shiprocketPush: live ? env.SHIPROCKET_PUSH !== "off" : env.SHIPROCKET_PUSH === "on",
    shiprocketPickup: env.SHIPROCKET_PICKUP_LOCATION || "Home",
    shiprocketTimeoutMs: int(env.SHIPROCKET_TIMEOUT_MS, 8000),
    shiprocketInlineAttempts: Math.max(1, int(env.SHIPROCKET_INLINE_ATTEMPTS, 3)),
    shiprocketMaxAttempts: Math.max(1, int(env.SHIPROCKET_MAX_ATTEMPTS, 8)),
    shiprocketTokenTtlMs: 9 * 24 * 3600 * 1000, // token is valid 10 days; refresh after 9

    turnstileRequired: env.TURNSTILE_REQUIRED === "true",

    alertTo: env.ALERT_TO || "1acrefarmsindia@gmail.com",
    alertFrom: env.ALERT_FROM || "1acrefarms checkout <onboarding@resend.dev>",

    orderPrefix: live ? "1AF-W-" : "1AF-T-",
    reconcileAfterMs: int(env.RECONCILE_AFTER_MS, 10 * 60 * 1000),
    expireAfterMs: int(env.EXPIRE_AFTER_MS, 24 * 3600 * 1000),
  });
}

// Can this Worker take a NEW order right now? Fail closed on anything odd.
export function checkoutGuard(cfg, env = {}) {
  const key = String(env.RAZORPAY_KEY_ID || "");
  if (cfg.mode === "invalid") return { ok: false, code: "bad_mode" };
  if (!cfg.gatewayOrder.length) return { ok: false, code: "no_gateway" };
  if (cfg.mode === "live") {
    if (!cfg.liveApproved) return { ok: false, code: "live_not_approved" };
    if (key && !key.startsWith("rzp_live_")) return { ok: false, code: "test_key_in_live_mode" };
    return { ok: true };
  }
  // test mode: a live key here could take real money, so refuse outright
  if (key.startsWith("rzp_live_")) return { ok: false, code: "live_key_in_test_mode" };
  return { ok: true };
}

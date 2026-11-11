// Runtime configuration. Plain vars come from wrangler.toml [vars]; secrets from `wrangler secret put`.
//
// LIVE MODE IS HARD-DISABLED BY DEFAULT.
//   MODE unset or "test"  -> test mode: Razorpay test keys only (rzp_test_...), Cashfree sandbox.
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

    primaryGateway: env.PRIMARY_GATEWAY === "cashfree" ? "cashfree" : "razorpay",
    backupEnabled: env.BACKUP_GATEWAY !== "off",
    gatewayTimeoutMs: int(env.GATEWAY_TIMEOUT_MS, 6000),

    razorpayApi: "https://api.razorpay.com/v1",
    cashfreeApi: live ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg",
    cashfreeApiVersion: env.CASHFREE_API_VERSION || "2025-01-01",
    cashfreeJsMode: live ? "production" : "sandbox",

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
  if (cfg.mode === "live") {
    if (!cfg.liveApproved) return { ok: false, code: "live_not_approved" };
    if (key && !key.startsWith("rzp_live_")) return { ok: false, code: "test_key_in_live_mode" };
    return { ok: true };
  }
  // test mode: a live key here could take real money, so refuse outright
  if (key.startsWith("rzp_live_")) return { ok: false, code: "live_key_in_test_mode" };
  return { ok: true };
}

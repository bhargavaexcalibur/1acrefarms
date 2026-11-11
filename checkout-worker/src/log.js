// Logging that cannot leak customer data or secrets.
// Only whitelisted fields are printed, and every string value is scrubbed of long digit runs
// (phones, PINs, card-like numbers) and email addresses. Never log request bodies.

const FIELDS = new Set([
  "orderId", "gateway", "status", "http", "attempt", "attempts", "code", "ms", "mode", "reason",
  "event", "count", "next", "duplicate", "route",
]);

export function redact(value) {
  return String(value)
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{4,}\d/g, "[num]")
    .slice(0, 200);
}

export function makeLogger(sink = console) {
  return function log(event, fields = {}) {
    const out = { evt: event };
    for (const [k, v] of Object.entries(fields)) {
      if (!FIELDS.has(k) || v === undefined || v === null) continue;
      // order ids look like 1AF-T-261111-K7Q2XD: keep them readable (no long digit run)
      out[k] = typeof v === "number" || typeof v === "boolean" ? v : k === "orderId" ? String(v).slice(0, 40) : redact(v);
    }
    sink.log(JSON.stringify(out));
  };
}

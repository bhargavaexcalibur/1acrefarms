// Small HTTP helpers: JSON replies, CORS for the two site origins, body limits, fetch with a timeout.

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

export function corsHeaders(origin, cfg) {
  if (!origin || !cfg.allowedOrigins.includes(origin)) return null;
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

// Reads the body as text with a hard size cap (webhooks need the RAW text for their HMAC).
export async function readText(request, maxBytes) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > maxBytes) throw new HttpError(413, "body_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new HttpError(413, "body_too_large");
  return text;
}

export async function readJson(request, maxBytes = 8192) {
  const text = await readText(request, maxBytes);
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

export class TimeoutError extends Error {
  constructor(ms) {
    super(`timed out after ${ms} ms`);
    this.name = "TimeoutError";
  }
}

// fetch() that gives up after `ms`. Network errors and timeouts both throw.
export async function fetchWithTimeout(fetchImpl, url, init, ms) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([fetchImpl(url, { ...init, signal: ctrl.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

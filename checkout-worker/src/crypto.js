// HMAC-SHA256 helpers on Web Crypto only (Cloudflare Workers and Node >= 20 both have globalThis.crypto).
const enc = new TextEncoder();

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function hmacSha256(secret, message) {
  const key = await hmacKey(secret);
  const data = typeof message === "string" ? enc.encode(message) : message;
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex) {
  if (typeof hex !== "string" || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function toBase64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(b64) {
  if (typeof b64 !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64) || b64.length % 4 !== 0) return null;
  try {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

// Constant-time comparison. Uses Cloudflare's crypto.subtle.timingSafeEqual when present,
// otherwise an XOR-accumulate loop. Lengths are public (both are fixed-size HMAC digests).
export function timingSafeEqual(a, b) {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array) || a.length !== b.length) return false;
  if (typeof crypto.subtle.timingSafeEqual === "function") return crypto.subtle.timingSafeEqual(a, b);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function sha256Bytes(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}

export async function sha256Hex(text) {
  return toHex(await sha256Bytes(text));
}

import crypto from "crypto";

// Lightweight signed-cookie auth for a single admin account.
// Good enough for a small internal dashboard; swap for NextAuth if you
// need multiple admins or stronger guarantees.
//
// Hardening over the first version:
//  - fails CLOSED when no secret / admin credentials are configured (it used
//    to fall back to a public string, and `undefined === undefined` would
//    have accepted an empty login when ADMIN_USERNAME was missing)
//  - constant-time comparisons
//  - the 24h session lifetime is enforced on the SERVER, not only by the
//    cookie's Max-Age
//  - `Secure` cookie flag in production

const SESSION_MAX_AGE_S = 24 * 60 * 60;

function secret() {
  return process.env.ADMIN_SESSION_SECRET || process.env.WEBHOOK_SECRET || "";
}

function hmac(value) {
  const s = secret();
  if (!s) return null;
  return crypto.createHmac("sha256", s).update(value).digest("hex");
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function sign(value) {
  const h = hmac(value);
  return h ? `${value}.${h}` : null;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const expected = sign(value);
  if (!expected || !safeEqual(expected, signed)) return null;
  // value is "admin:<issuedAtMs>"
  const issuedAt = Number(value.split(":")[1]);
  if (!Number.isFinite(issuedAt)) return null;
  const age = Date.now() - issuedAt;
  if (age < -60_000 || age > SESSION_MAX_AGE_S * 1000) return null;
  return value;
}

function digest(v) {
  return crypto.createHash("sha256").update(String(v)).digest();
}

export function checkCredentials(username, password) {
  const u = process.env.ADMIN_USERNAME;
  const p = process.env.ADMIN_PASSWORD;
  if (!u || !p) return false;
  if (typeof username !== "string" || typeof password !== "string") return false;
  // Hash first so the comparison is constant-time regardless of length.
  const userOk = crypto.timingSafeEqual(digest(username), digest(u));
  const passOk = crypto.timingSafeEqual(digest(password), digest(p));
  return userOk && passOk;
}

const secureFlag = () => (process.env.NODE_ENV === "production" ? "; Secure" : "");

export function createSessionCookie() {
  const token = sign(`admin:${Date.now()}`);
  if (!token) throw new Error("WEBHOOK_SECRET (or ADMIN_SESSION_SECRET) is not set");
  return `admin_session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_MAX_AGE_S}; SameSite=Lax${secureFlag()}`;
}

export function clearSessionCookie() {
  return `admin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${secureFlag()}`;
}

export function isAuthed(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
  if (!match) return false;
  return Boolean(verify(match[1]));
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "";
}

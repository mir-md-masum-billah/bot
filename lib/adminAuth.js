import crypto from "crypto";

// Extremely lightweight signed-cookie auth for a single admin account.
// Good enough for a small internal dashboard; swap for NextAuth if you
// need multiple admins or stronger guarantees.

function sign(value) {
  const h = crypto
    .createHmac("sha256", process.env.WEBHOOK_SECRET || "fallback-secret")
    .update(value)
    .digest("hex");
  return `${value}.${h}`;
}

function verify(signed) {
  if (!signed) return null;
  const idx = signed.lastIndexOf(".");
  if (idx === -1) return null;
  const value = signed.slice(0, idx);
  const expected = sign(value);
  return expected === signed ? value : null;
}

export function checkCredentials(username, password) {
  return (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  );
}

export function createSessionCookie() {
  const token = sign(`admin:${Date.now()}`);
  return `admin_session=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `admin_session=; HttpOnly; Path=/; Max-Age=0`;
}

export function isAuthed(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/admin_session=([^;]+)/);
  if (!match) return false;
  return Boolean(verify(match[1]));
}

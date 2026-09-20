import { checkCredentials, createSessionCookie, clientIp } from "../../../lib/adminAuth.js";

// Best-effort brute-force guard: 8 failed attempts per IP per 15 minutes.
// (In-memory, so it's per serverless instance — it slows attackers down,
// it isn't a hard global limit. Use a strong ADMIN_PASSWORD regardless.)
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
const fails = new Map();

function tooMany(ip) {
  const rec = fails.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW_MS) {
    fails.delete(ip);
    return false;
  }
  return rec.count >= MAX_FAILS;
}

function recordFail(ip) {
  const rec = fails.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW_MS) fails.set(ip, { count: 1, first: Date.now() });
  else rec.count += 1;
}

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }
  const ip = clientIp(req);
  if (tooMany(ip)) {
    res.status(429).json({ error: "Too many attempts. Try again in a few minutes." });
    return;
  }
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) {
    recordFail(ip);
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  fails.delete(ip);
  try {
    res.setHeader("Set-Cookie", createSessionCookie());
  } catch (e) {
    res.status(500).json({ error: "Server is missing WEBHOOK_SECRET" });
    return;
  }
  res.status(200).json({ ok: true });
}

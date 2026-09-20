import { dbConnect } from "./db.js";
import { isAuthed } from "./adminAuth.js";

// Wraps every admin API route: checks the session, connects to Mongo and
// turns any thrown error into a JSON response (so the dashboard never has
// to parse an HTML error page, which is what used to crash it).
export function withAdmin(handler) {
  return async function adminRoute(req, res) {
    if (!isAuthed(req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      await dbConnect();
      await handler(req, res);
    } catch (e) {
      console.error(`Admin API error on ${req.method} ${req.url}:`, e);
      if (!res.writableEnded) {
        const status = e?.statusCode && Number.isInteger(e.statusCode) ? e.statusCode : 500;
        res.status(status).json({ error: e?.message || "Server error" });
      }
    }
  };
}

export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function pageParams(req, { limit = 25, max = 100 } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const lim = Math.min(max, Math.max(1, parseInt(req.query.limit, 10) || limit));
  return { page, limit: lim, skip: (page - 1) * lim };
}

export function pagesOf(total, limit) {
  return Math.max(1, Math.ceil(total / limit));
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isNumericId(q) {
  return /^-?\d{1,15}$/.test(String(q));
}

export function isObjectId(v) {
  return typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
}

export function cleanStr(v, max = 2000) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

export function requireObjectId(v, what = "id") {
  if (!isObjectId(v)) throw new HttpError(400, `Invalid ${what}`);
  return v;
}

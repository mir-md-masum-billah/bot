import AdminLog from "../models/AdminLog.js";
import { clientIp } from "./adminAuth.js";

// Records one dashboard action in the audit trail. Never throws — a
// logging hiccup must not undo or block the action itself.
export async function logAdmin(req, action, { targetType = "", targetId = "", summary = "", details = {} } = {}) {
  try {
    await AdminLog.create({
      admin: process.env.ADMIN_USERNAME || "admin",
      action,
      targetType,
      targetId: String(targetId ?? ""),
      summary: String(summary).slice(0, 500),
      details,
      ip: req ? clientIp(req) : "",
    });
  } catch (e) {
    console.error("logAdmin failed:", e);
  }
}

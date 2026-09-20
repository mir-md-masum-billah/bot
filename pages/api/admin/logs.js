import { withAdmin, pageParams, pagesOf, escapeRegex, cleanStr } from "../../../lib/adminApi.js";
import AdminLog from "../../../models/AdminLog.js";

// GET ?q=&action=&page=  -> audit trail of everything done from the dashboard
export default withAdmin(async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const { page, limit, skip } = pageParams(req, { limit: 30 });
  const filter = {};
  if (req.query.action && req.query.action !== "all") {
    // "user" matches user.update, user.message …
    filter.action = new RegExp(`^${escapeRegex(String(req.query.action))}`);
  }
  const q = cleanStr(req.query.q, 100);
  if (q) {
    const rx = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ summary: rx }, { targetId: rx }];
  }
  const [items, total] = await Promise.all([
    AdminLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AdminLog.countDocuments(filter),
  ]);
  res.status(200).json({ items, total, page, pages: pagesOf(total, limit) });
});

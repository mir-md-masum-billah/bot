import { withAdmin, pageParams, pagesOf, isNumericId, cleanStr } from "../../../lib/adminApi.js";
import Transaction from "../../../models/Transaction.js";
import User from "../../../models/User.js";

// GET ?telegramId=&type=&page=  -> every coin movement, newest first
export default withAdmin(async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }
  const { page, limit, skip } = pageParams(req, { limit: 30 });
  const filter = {};
  const who = cleanStr(req.query.telegramId, 30);
  if (who && isNumericId(who)) filter.telegramId = Number(who);
  if (req.query.type && req.query.type !== "all") filter.type = String(req.query.type);

  const [items, total] = await Promise.all([
    Transaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Transaction.countDocuments(filter),
  ]);
  const ids = [...new Set(items.map((t) => t.telegramId))];
  const users = await User.find({ telegramId: { $in: ids } }).select("telegramId username firstName").lean();
  const names = Object.fromEntries(users.map((u) => [u.telegramId, u.username ? `@${u.username}` : u.firstName || ""]));

  res.status(200).json({
    items: items.map((t) => ({ ...t, userName: names[t.telegramId] || "" })),
    total,
    page,
    pages: pagesOf(total, limit),
  });
});

import { withAdmin, HttpError, pageParams, pagesOf, escapeRegex, isNumericId, cleanStr } from "../../../lib/adminApi.js";
import { logAdmin } from "../../../lib/adminLog.js";
import { dmUser } from "../../../lib/adminNotify.js";
import User from "../../../models/User.js";
import Task from "../../../models/Task.js";
import Submission from "../../../models/Submission.js";
import Report from "../../../models/Report.js";
import Transaction from "../../../models/Transaction.js";

// GET  ?q=&banned=1&sort=new|balance|xp&page=   -> searchable, paged list
// GET  ?telegramId=123                          -> full profile (+ history)
// PATCH { telegramId, isBanned?, banReason?, adjustAmount?, note?, addNote?, notifyUser? }
// POST  { telegramId, message }                 -> DM the user through the bot
const PUBLIC_FIELDS = "-sessionState -sessionData -lastMenuMessageId";

export default withAdmin(async (req, res) => {
  if (req.method === "GET") {
    if (req.query.telegramId) {
      const telegramId = Number(req.query.telegramId);
      if (!Number.isFinite(telegramId)) throw new HttpError(400, "Invalid telegramId");
      const user = await User.findOne({ telegramId }).select(PUBLIC_FIELDS).lean();
      if (!user) throw new HttpError(404, "User not found");

      const [transactions, tasks, workerSubs, ownerSubs, reports, referrals] = await Promise.all([
        Transaction.find({ telegramId }).sort({ createdAt: -1 }).limit(30).lean(),
        Task.find({ ownerTelegramId: telegramId })
          .select("-completedBy -completions -reports")
          .sort({ createdAt: -1 })
          .limit(20)
          .lean(),
        Submission.find({ workerTelegramId: telegramId }).sort({ createdAt: -1 }).limit(10).lean(),
        Submission.find({ ownerTelegramId: telegramId }).sort({ createdAt: -1 }).limit(10).lean(),
        Report.find({ reporterTelegramId: telegramId })
          .select("reportNumber category status priority text createdAt")
          .sort({ createdAt: -1 })
          .limit(10)
          .lean(),
        User.countDocuments({ referredBy: telegramId }),
      ]);

      res.status(200).json({
        user: { ...user, totalBalance: (user.donatedBalance || 0) + (user.earnedBalance || 0) },
        transactions,
        tasks,
        workerSubmissions: workerSubs,
        ownerSubmissions: ownerSubs,
        reports,
        referrals,
      });
      return;
    }

    const { page, limit, skip } = pageParams(req, { limit: 25 });
    const filter = {};
    const q = cleanStr(req.query.q, 100).replace(/^@/, "");
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const or = [{ username: rx }, { firstName: rx }, { lastName: rx }];
      if (isNumericId(q)) or.push({ telegramId: Number(q) });
      filter.$or = or;
    }
    if (req.query.banned) filter.isBanned = true;

    const sorts = {
      new: { createdAt: -1 },
      old: { createdAt: 1 },
      xp: { xp: -1 },
      earned: { earnedBalance: -1 },
      donated: { donatedBalance: -1 },
    };
    const sort = sorts[req.query.sort] || sorts.new;

    const [items, total] = await Promise.all([
      User.find(filter).select(PUBLIC_FIELDS).sort(sort).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);
    res.status(200).json({
      items: items.map((u) => ({ ...u, totalBalance: (u.donatedBalance || 0) + (u.earnedBalance || 0) })),
      total,
      page,
      pages: pagesOf(total, limit),
    });
    return;
  }

  if (req.method === "PATCH") {
    const { telegramId, isBanned, banReason, adjustAmount, note, addNote, notifyUser = true } = req.body || {};
    const user = await User.findOne({ telegramId: Number(telegramId) });
    if (!user) throw new HttpError(404, "User not found");

    const changes = [];
    const dms = []; // sent only after everything validated + saved

    if (typeof isBanned === "boolean" && isBanned !== user.isBanned) {
      const reason = cleanStr(banReason, 300);
      if (isBanned && !reason) throw new HttpError(400, "Please write a reason for the ban");
      user.isBanned = isBanned;
      user.banReason = isBanned ? reason : "";
      user.bannedAt = isBanned ? new Date() : null;
      changes.push(isBanned ? `BANNED (${reason})` : "UNBANNED");
      if (notifyUser) {
        dms.push({
          kind: "ban",
          text: isBanned
            ? `🚫 Your account has been restricted.\nReason: ${reason}\n\nIf you think this is a mistake, send /report to appeal.`
            : `✅ The restriction on your account was lifted. You can use the bot again.`,
        });
      }
    } else if (isBanned === true && user.isBanned && banReason !== undefined) {
      user.banReason = cleanStr(banReason, 300);
      changes.push("ban reason edited");
    }

    if (adjustAmount !== undefined && adjustAmount !== null && adjustAmount !== "") {
      const amount = Number(adjustAmount);
      const reason = cleanStr(note, 300);
      if (!Number.isFinite(amount) || amount === 0) throw new HttpError(400, "Amount must be a non-zero number");
      if (Math.abs(amount) > 1e9) throw new HttpError(400, "Amount is too large");
      if (reason.length < 3) throw new HttpError(400, "Please write a note explaining the balance change");

      // Atomic $inc (not read-modify-save) so a coin earned by the user in the
      // same second can't be overwritten by this adjustment.
      if (amount > 0) {
        await User.updateOne({ _id: user._id }, { $inc: { donatedBalance: amount } });
      } else {
        // Take away from donated coins first, then earned. Never below zero.
        const need = -amount;
        const total = user.donatedBalance + user.earnedBalance;
        if (need > total) throw new HttpError(400, `User only has ${total.toLocaleString()} GRAM`);
        const fromDonated = Math.min(user.donatedBalance, need);
        const fromEarned = need - fromDonated;
        const done = await User.updateOne(
          { _id: user._id, donatedBalance: { $gte: fromDonated }, earnedBalance: { $gte: fromEarned } },
          { $inc: { donatedBalance: -fromDonated, earnedBalance: -fromEarned } }
        );
        if (!done.modifiedCount) throw new HttpError(409, "Balance changed while you were editing — reload and try again");
      }
      await Transaction.create({ telegramId: user.telegramId, type: "admin_adjust", amount, note: reason });
      changes.push(`balance ${amount > 0 ? "+" : ""}${amount.toLocaleString()} GRAM (${reason})`);
      if (notifyUser) {
        dms.push({
          kind: "balance",
          text: `💰 Your balance was ${amount > 0 ? "increased" : "decreased"} by ${Math.abs(amount).toLocaleString()} GRAM by an admin.\nNote: ${reason}`,
        });
      }
    }

    const noteText = cleanStr(addNote, 2000);
    if (noteText) {
      user.adminNotes.push({ text: noteText, by: process.env.ADMIN_USERNAME || "admin" });
      changes.push("added admin note");
    }

    if (!changes.length) {
      res.status(200).json({ ok: true, unchanged: true });
      return;
    }

    await user.save();
    const delivery = [];
    for (const dm of dms) delivery.push({ kind: dm.kind, ...(await dmUser(user.telegramId, dm.text)) });
    await logAdmin(req, "user.update", {
      targetType: "user",
      targetId: user.telegramId,
      summary: `User ${user.telegramId}${user.username ? ` (@${user.username})` : ""}: ${changes.join("; ")}`,
      details: { changes, delivery },
    });
    res.status(200).json({ ok: true, delivery });
    return;
  }

  if (req.method === "POST") {
    const { telegramId, message } = req.body || {};
    const text = cleanStr(message, 3500);
    if (!text) throw new HttpError(400, "Message is empty");
    const user = await User.findOne({ telegramId: Number(telegramId) }).select("telegramId username").lean();
    if (!user) throw new HttpError(404, "User not found");
    const r = await dmUser(user.telegramId, `📩 Message from admin\n\n${text}`);
    await logAdmin(req, "user.message", {
      targetType: "user",
      targetId: user.telegramId,
      summary: `Sent a message to ${user.telegramId}: ${text.slice(0, 120)}`,
      details: { delivered: r.ok, error: r.error },
    });
    res.status(200).json({ ok: r.ok, error: r.error });
    return;
  }

  res.status(405).end();
});

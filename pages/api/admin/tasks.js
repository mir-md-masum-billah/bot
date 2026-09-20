import { withAdmin, HttpError, pageParams, pagesOf, escapeRegex, isNumericId, requireObjectId, cleanStr } from "../../../lib/adminApi.js";
import { logAdmin } from "../../../lib/adminLog.js";
import { dmUser } from "../../../lib/adminNotify.js";
import Task from "../../../models/Task.js";
import User from "../../../models/User.js";
import Transaction from "../../../models/Transaction.js";
import Submission from "../../../models/Submission.js";

// GET    ?q=&status=&type=&page=       -> list
// GET    ?id=<taskId>                  -> full task (with worker reports)
// PATCH  { id, status: active|paused, pricePerAction?, reason?, notifyOwner? }
// DELETE { id, refund?, reason?, notifyOwner? }
//   refund=true returns the unused budget (remaining × price) to the owner,
//   exactly like the owner deleting the task in the bot does.
const LIST_HIDE = "-completedBy -completions -reports -targetMessageIds";

const label = (t) => t.targetChatTitle || t.targetChatUsername || t.targetChatId;

export default withAdmin(async (req, res) => {
  if (req.method === "GET") {
    if (req.query.id) {
      requireObjectId(req.query.id, "task id");
      const task = await Task.findById(req.query.id).lean();
      if (!task) throw new HttpError(404, "Task not found");
      const [owner, submissionCount] = await Promise.all([
        User.findOne({ telegramId: task.ownerTelegramId }).select("telegramId username firstName isBanned").lean(),
        Submission.countDocuments({ taskId: task._id }),
      ]);
      const { completedBy, completions, ...rest } = task;
      res.status(200).json({
        task: { ...rest, completedByCount: (completedBy || []).length },
        owner,
        submissionCount,
      });
      return;
    }

    const { page, limit, skip } = pageParams(req, { limit: 25 });
    const filter = {};
    if (req.query.status && req.query.status !== "all") filter.status = String(req.query.status);
    if (req.query.type && req.query.type !== "all") filter.type = String(req.query.type);
    if (req.query.reported) filter.reportCount = { $gt: 0 };
    const q = cleanStr(req.query.q, 100).replace(/^@/, "");
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const or = [{ targetChatTitle: rx }, { targetChatUsername: rx }, { targetChatId: rx }];
      if (isNumericId(q)) or.push({ taskNumber: Number(q) }, { ownerTelegramId: Number(q) });
      filter.$or = or;
    }
    const [items, total] = await Promise.all([
      Task.find(filter).select(LIST_HIDE).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Task.countDocuments(filter),
    ]);
    res.status(200).json({ items, total, page, pages: pagesOf(total, limit) });
    return;
  }

  if (req.method === "PATCH") {
    const { id, status, pricePerAction, reason, notifyOwner = false } = req.body || {};
    requireObjectId(id, "task id");
    const task = await Task.findById(id);
    if (!task) throw new HttpError(404, "Task not found");
    if (task.status === "deleted") throw new HttpError(400, "This task was deleted");

    const changes = [];
    if (status !== undefined && status !== task.status) {
      if (!["active", "paused"].includes(status)) throw new HttpError(400, "Status must be active or paused");
      if (task.status === "completed") throw new HttpError(400, "A completed task can't be resumed");
      changes.push(`status ${task.status} → ${status}`);
      task.status = status;
    }
    if (pricePerAction !== undefined) {
      const price = Number(pricePerAction);
      if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, "pricePerAction must be a positive number");
      if (price !== task.pricePerAction) {
        changes.push(`price ${task.pricePerAction} → ${price}`);
        task.pricePerAction = price;
      }
    }
    if (!changes.length) {
      res.status(200).json({ ok: true, unchanged: true });
      return;
    }
    await task.save();

    let delivery = null;
    const why = cleanStr(reason, 300);
    if (notifyOwner) {
      delivery = await dmUser(
        task.ownerTelegramId,
        `⚙️ An admin changed your task "${label(task)}": ${changes.join(", ")}.${why ? `\nReason: ${why}` : ""}`
      );
    }
    await logAdmin(req, "task.update", {
      targetType: "task",
      targetId: String(task._id),
      summary: `Task ${task.taskNumber ? `#${task.taskNumber} ` : ""}"${label(task)}": ${changes.join("; ")}${why ? ` (${why})` : ""}`,
      details: { changes, reason: why, owner: task.ownerTelegramId, delivery },
    });
    res.status(200).json({ ok: true, task, delivery });
    return;
  }

  if (req.method === "DELETE") {
    const { id, refund = false, reason, notifyOwner = false } = req.body || {};
    requireObjectId(id, "task id");
    const task = await Task.findById(id);
    if (!task) throw new HttpError(404, "Task not found");
    if (task.status === "deleted") throw new HttpError(400, "Already deleted");

    const remaining = Math.max(task.goalCount - task.completedCount, 0);
    const refundAmount = refund ? remaining * task.pricePerAction : 0;

    task.status = "deleted";
    await task.save();

    if (refundAmount > 0 && Number.isFinite(refundAmount)) {
      const upd = await User.updateOne({ telegramId: task.ownerTelegramId }, { $inc: { donatedBalance: refundAmount } });
      if (upd.matchedCount) {
        await Transaction.create({
          telegramId: task.ownerTelegramId,
          type: "refund",
          amount: refundAmount,
          relatedTaskId: task._id,
          note: "Task removed by admin — unused balance refunded",
        });
      }
    }

    const why = cleanStr(reason, 300);
    let delivery = null;
    if (notifyOwner) {
      delivery = await dmUser(
        task.ownerTelegramId,
        `🗑 An admin removed your task "${label(task)}".${why ? `\nReason: ${why}` : ""}` +
          (refundAmount > 0 ? `\n💰 ${refundAmount.toLocaleString()} GRAM was refunded to your balance.` : "")
      );
    }
    await logAdmin(req, "task.delete", {
      targetType: "task",
      targetId: String(task._id),
      summary: `Deleted task ${task.taskNumber ? `#${task.taskNumber} ` : ""}"${label(task)}" — refund ${refundAmount.toLocaleString()} GRAM${why ? ` (${why})` : ""}`,
      details: { refundAmount, reason: why, owner: task.ownerTelegramId, delivery },
    });
    res.status(200).json({ ok: true, refunded: refundAmount });
    return;
  }

  res.status(405).end();
});

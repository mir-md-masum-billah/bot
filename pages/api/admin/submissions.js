import { withAdmin, HttpError, pageParams, pagesOf, isNumericId, requireObjectId, cleanStr } from "../../../lib/adminApi.js";
import { logAdmin } from "../../../lib/adminLog.js";
import Submission from "../../../models/Submission.js";
import Task from "../../../models/Task.js";
import User from "../../../models/User.js";
import { finalizeSubmissionApproval, applyRejectionPenalty, penalizeAndWarn } from "../../../bot/bot.js";

// GET  ?status=pending|approved|rejected&q=&page=  -> list, newest first,
//      joined with task title/conditions and worker/owner usernames.
// POST { id, action: "approve" | "reject", note }
//   - "approve": if the submission is currently "pending" this is just the
//     admin doing the owner's job (no penalty). If it's currently
//     "rejected", this is an OVERRIDE of a bad-faith owner rejection: the
//     worker gets paid as originally promised, and the penalty comes out of
//     the OWNER's balance instead, with a warning message to the owner.
//   - "reject": if the submission is currently "approved" (owner or
//     auto-approved), this claws the coins back from the WORKER with a
//     warning message — the admin decided that approval shouldn't have
//     happened. `note` is required in this case as the reason shown to the
//     worker.
export default withAdmin(async (req, res) => {
  if (req.method === "GET") {
    const { page, limit, skip } = pageParams(req, { limit: 20 });
    const filter = {};
    if (req.query.status) filter.status = String(req.query.status);
    const q = cleanStr(req.query.q, 50);
    if (q && isNumericId(q)) {
      filter.$or = [
        { workerTelegramId: Number(q) },
        { ownerTelegramId: Number(q) },
        { submissionNumber: Number(q) },
      ];
    }

    const [items, total, byStatus] = await Promise.all([
      Submission.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Submission.countDocuments(filter),
      Submission.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const taskIds = [...new Set(items.map((s) => String(s.taskId)))];
    const userIds = [...new Set(items.flatMap((s) => [s.workerTelegramId, s.ownerTelegramId]))];
    const [tasks, users] = await Promise.all([
      Task.find({ _id: { $in: taskIds } })
        .select("targetChatTitle targetChatUsername targetChatId conditionText pricePerAction taskNumber")
        .lean(),
      User.find({ telegramId: { $in: userIds } }).select("telegramId username firstName isBanned").lean(),
    ]);
    const taskMap = Object.fromEntries(tasks.map((t) => [String(t._id), t]));
    const userMap = Object.fromEntries(users.map((u) => [u.telegramId, u]));

    res.status(200).json({
      items: items.map((s) => ({
        ...s,
        task: taskMap[String(s.taskId)] || null,
        worker: userMap[s.workerTelegramId] || null,
        owner: userMap[s.ownerTelegramId] || null,
      })),
      total,
      page,
      pages: pagesOf(total, limit),
      counts: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    });
    return;
  }

  if (req.method === "POST") {
    const { id, action, note } = req.body || {};
    requireObjectId(id, "submission id");
    const submission = await Submission.findById(id);
    if (!submission) throw new HttpError(404, "Submission not found");
    const tag = `Submission #${submission.submissionNumber ?? String(submission._id).slice(-6)}`;

    if (action === "approve") {
      const wasRejected = submission.status === "rejected";
      const wasApproved = submission.status === "approved";

      if (!wasApproved) {
        await finalizeSubmissionApproval(submission, "admin"); // pays the worker, marks approved
      }

      if (wasRejected) {
        // The owner's rejection didn't hold up on review: the worker just
        // got paid above, and the coins instead come out of the OWNER's
        // balance as the penalty for the wrong call, per the requested rule.
        const task = await Task.findById(submission.taskId);
        const reason = cleanStr(note, 300) || "Overturned a rejection that shouldn't have happened.";
        await penalizeAndWarn(submission.ownerTelegramId, task, reason, String(submission._id));
        await Submission.findByIdAndUpdate(submission._id, {
          adminOverrode: true,
          adminNote: reason,
          adminReviewedAt: new Date(),
        });
        await logAdmin(req, "submission.override_approve", {
          targetType: "submission",
          targetId: String(submission._id),
          summary: `${tag}: rejection overturned — worker ${submission.workerTelegramId} paid, owner ${submission.ownerTelegramId} penalized (${reason})`,
          details: { reason },
        });
      } else {
        const n = cleanStr(note, 300);
        await Submission.findByIdAndUpdate(submission._id, {
          adminReviewedAt: new Date(),
          ...(n ? { adminNote: n } : {}),
        });
        await logAdmin(req, "submission.approve", {
          targetType: "submission",
          targetId: String(submission._id),
          summary: wasApproved
            ? `${tag}: already approved — marked as reviewed${n ? ` (${n})` : ""}`
            : `${tag}: approved by admin (worker ${submission.workerTelegramId})${n ? ` (${n})` : ""}`,
          details: { note: n },
        });
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "reject") {
      const wasApproved = submission.status === "approved";
      const reason = cleanStr(note, 300);
      if (!reason) throw new HttpError(400, "Please write a reason (the worker will see it)");
      // Only claw back from the worker when reversing a prior approval —
      // a still-pending submission being rejected fresh is an ordinary
      // reject, nobody "got it wrong" yet.
      await applyRejectionPenalty(submission, reason, wasApproved ? submission.workerTelegramId : null, "admin");
      await Submission.findByIdAndUpdate(submission._id, {
        adminOverrode: wasApproved,
        adminNote: reason,
        adminReviewedAt: new Date(),
      });
      await logAdmin(req, wasApproved ? "submission.override_reject" : "submission.reject", {
        targetType: "submission",
        targetId: String(submission._id),
        summary: wasApproved
          ? `${tag}: approval reversed — coins clawed back from worker ${submission.workerTelegramId} (${reason})`
          : `${tag}: rejected by admin (${reason})`,
        details: { reason },
      });
      res.status(200).json({ ok: true });
      return;
    }

    throw new HttpError(400, "action must be 'approve' or 'reject'");
  }

  res.status(405).end();
});

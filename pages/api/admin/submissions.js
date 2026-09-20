import { dbConnect } from "../../../lib/db.js";
import { isAuthed } from "../../../lib/adminAuth.js";
import Submission from "../../../models/Submission.js";
import Task from "../../../models/Task.js";
import { finalizeSubmissionApproval, applyRejectionPenalty, penalizeAndWarn } from "../../../bot/bot.js";

// GET  ?status=pending|approved|rejected  -> list, newest first
// POST { id, action: "approve" | "reject", note }
//   - action "approve": if the submission is currently "pending" this is
//     just the admin doing the owner's job (no penalty). If it's currently
//     "rejected", this is an OVERRIDE of a bad-faith owner rejection: the
//     worker gets paid as originally promised, and the penalty comes out of
//     the OWNER's balance instead, with a warning message to the owner.
//   - action "reject": if the submission is currently "approved" (owner or
//     auto-approved), this claws the coins back from the WORKER with a
//     warning message — the admin decided that approval shouldn't have
//     happened. `note` is required in this case as the reason shown to the
//     worker.
export default async function handler(req, res) {
  if (!isAuthed(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await dbConnect();

  if (req.method === "GET") {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const submissions = await Submission.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    res.status(200).json(submissions);
    return;
  }

  if (req.method === "POST") {
    const { id, action, note } = req.body || {};
    const submission = await Submission.findById(id);
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    if (action === "approve") {
      const wasRejected = submission.status === "rejected";

      if (submission.status !== "approved") {
        await finalizeSubmissionApproval(submission, "admin"); // pays the worker, marks approved
      }

      if (wasRejected) {
        // The owner's rejection didn't hold up on review: the worker just
        // got paid above, and the coins instead come out of the OWNER's
        // balance as the penalty for the wrong call, per the requested rule.
        const task = await Task.findById(submission.taskId);
        const reason = note || "Overturned a rejection that shouldn't have happened.";
        await penalizeAndWarn(submission.ownerTelegramId, task, reason);
        await Submission.findByIdAndUpdate(submission._id, {
          adminOverrode: true,
          adminNote: reason,
          adminReviewedAt: new Date(),
        });
      } else {
        await Submission.findByIdAndUpdate(submission._id, { adminReviewedAt: new Date() });
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (action === "reject") {
      const wasApproved = submission.status === "approved";
      const reason = note || "Rejected on admin review.";
      // Only claw back from the worker when reversing a prior approval —
      // a still-pending submission being rejected fresh is an ordinary
      // reject, nobody "got it wrong" yet.
      await applyRejectionPenalty(submission, reason, wasApproved ? submission.workerTelegramId : null, "admin");
      await Submission.findByIdAndUpdate(submission._id, {
        adminOverrode: wasApproved,
        adminNote: reason,
        adminReviewedAt: new Date(),
      });
      res.status(200).json({ ok: true });
      return;
    }

    res.status(400).json({ error: "action must be 'approve' or 'reject'" });
    return;
  }

  res.status(405).end();
}

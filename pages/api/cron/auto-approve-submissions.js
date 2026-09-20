import { dbConnect } from "../../../lib/db.js";
import Submission from "../../../models/Submission.js";
import Task from "../../../models/Task.js";
import { finalizeSubmissionApproval, notifyTaskOwner } from "../../../bot/bot.js";

// Point an external scheduler (Vercel Cron, cron-job.org, GitHub Actions,
// etc.) at this route every 10–15 minutes with
// `?secret=<CRON_SECRET or WEBHOOK_SECRET>`. It finds every screenshot
// submission still "pending" past its expiresAt (set at submission time to
// PROOF_AUTO_APPROVE_HOURS from now) and approves it automatically, exactly
// like the owner tapping ✅ Approve — same coin credit, same atomic
// completedCount update.
export const config = { api: { bodyParser: false }, maxDuration: 60 };

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET;
  if (!secret || req.query.secret !== secret) {
    res.status(404).end();
    return;
  }

  await dbConnect();

  const due = await Submission.find({ status: "pending", expiresAt: { $lte: new Date() } }).limit(200);

  let approved = 0;
  for (const submission of due) {
    try {
      const result = await finalizeSubmissionApproval(submission, "auto");
      if (result.ok) {
        approved += 1;
        const task = await Task.findById(submission.taskId);
        if (task) {
          await notifyTaskOwner(
            task,
            `⏱ A screenshot submission for "${task.targetChatTitle || task.targetChatId}" was auto-approved ` +
              `after ${process.env.PROOF_AUTO_APPROVE_HOURS || 24}h with no response from you.`
          );
        }
      }
    } catch (e) {
      console.error(`auto-approve-submissions: failed for ${submission._id}`, e);
    }
  }

  res.status(200).json({ checked: due.length, approved });
}

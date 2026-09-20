import { dbConnect } from "../../../lib/db.js";
import Submission from "../../../models/Submission.js";
import { finalizeSubmissionApproval } from "../../../bot/bot.js";

// Point an external scheduler (Vercel Cron, cron-job.org, etc.) at this
// route every 10-15 minutes:
//   GET /api/cron/auto-approve-submissions?secret=CRON_SECRET
//
// This is the other half of the "🤖 Bot — with additional conditions"
// screenshot flow: the owner gets PROOF_AUTO_APPROVE_HOURS (see .env) to
// tap ✅/❌ in the bot chat. If they never respond, the worker shouldn't be
// stuck waiting forever on a silent/inactive owner — this route finds every
// submission whose `expiresAt` has passed while still "pending" and
// approves it exactly the way the owner tapping ✅ would (pays the worker,
// marks the task's goal progress, sends the worker their "approved"
// notification) via the same finalizeSubmissionApproval used everywhere
// else, just with decidedBy: "auto" instead of "owner"/"admin".
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET || process.env.WEBHOOK_SECRET;
  // Accepts either a manual scheduler hitting ?secret=..., or Vercel's own
  // Cron Jobs feature, which automatically sends `Authorization: Bearer
  // <CRON_SECRET>` for routes it triggers (see vercel.json) once CRON_SECRET
  // is set as a project env var — no query param needed in that case.
  const authHeader = req.headers.authorization;
  const authed = Boolean(secret) && (req.query.secret === secret || authHeader === `Bearer ${secret}`);
  if (!authed) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  await dbConnect();

  const due = await Submission.find({
    status: "pending",
    expiresAt: { $lte: new Date() },
  }).limit(200);

  const results = [];
  for (const submission of due) {
    // Re-check right before acting: the owner (or a previous cron run)
    // may have already decided this one since the query above ran.
    const fresh = await Submission.findOne({ _id: submission._id, status: "pending" });
    if (!fresh) continue;

    try {
      const result = await finalizeSubmissionApproval(fresh, "auto");
      results.push({ id: String(fresh._id), ok: result.ok, reason: result.reason || null });
    } catch (e) {
      console.error(`auto-approve failed for submission ${fresh._id}:`, e);
      results.push({ id: String(fresh._id), ok: false, reason: "error" });
    }
  }

  res.status(200).json({ processed: results.length, results });
}

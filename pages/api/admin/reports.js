import { withAdmin, HttpError, pageParams, pagesOf, escapeRegex, isNumericId, requireObjectId, cleanStr } from "../../../lib/adminApi.js";
import { logAdmin } from "../../../lib/adminLog.js";
import { dmUser } from "../../../lib/adminNotify.js";
import Report, { REPORT_STATUSES, REPORT_PRIORITIES } from "../../../models/Report.js";
import User from "../../../models/User.js";
import Task from "../../../models/Task.js";
import Submission from "../../../models/Submission.js";

// Problem reports filed by bot users (with screenshots).
//
// GET  ?status=&category=&q=&unread=1&page=   -> list (+ per-status counts)
// GET  ?id=<reportId>                         -> full report, marks it read
// PATCH { id, status?, priority?, resolution?, note?, reply?, notifyUser? }
//   reply -> saved in the conversation AND sent to the reporter via the bot
//   note  -> private admin note (never sent)
//   status resolved/rejected -> the reporter is told, with `resolution` text
const STATUS_LABEL = { open: "Open", in_review: "In review", resolved: "Resolved", rejected: "Rejected" };

export default withAdmin(async (req, res) => {
  if (req.method === "GET") {
    if (req.query.id) {
      requireObjectId(req.query.id, "report id");
      const report = await Report.findById(req.query.id).lean();
      if (!report) throw new HttpError(404, "Report not found");

      // Opening it counts as reading it.
      if (report.unreadByAdmin) await Report.updateOne({ _id: report._id }, { unreadByAdmin: false });

      const [reporter, task, submission, reporterReportCount] = await Promise.all([
        User.findOne({ telegramId: report.reporterTelegramId })
          .select("telegramId username firstName lastName donatedBalance earnedBalance isBanned banReason createdAt")
          .lean(),
        report.relatedTaskId ? Task.findById(report.relatedTaskId).select("-completedBy -completions -reports").lean() : null,
        report.relatedSubmissionId ? Submission.findById(report.relatedSubmissionId).lean() : null,
        Report.countDocuments({ reporterTelegramId: report.reporterTelegramId }),
      ]);
      res.status(200).json({ report: { ...report, unreadByAdmin: false }, reporter, task, submission, reporterReportCount });
      return;
    }

    const { page, limit, skip } = pageParams(req, { limit: 20 });
    const filter = {};
    if (req.query.status && req.query.status !== "all") {
      if (req.query.status === "active") filter.status = { $in: ["open", "in_review"] };
      else if (REPORT_STATUSES.includes(req.query.status)) filter.status = req.query.status;
    }
    if (req.query.category && req.query.category !== "all") filter.category = String(req.query.category);
    if (req.query.unread) filter.unreadByAdmin = true;
    const q = cleanStr(req.query.q, 100);
    if (q) {
      const rx = new RegExp(escapeRegex(q), "i");
      const or = [{ text: rx }, { reporterUsername: rx }, { reporterName: rx }];
      if (isNumericId(q)) {
        or.push({ reportNumber: Number(q) }, { reporterTelegramId: Number(q) });
      }
      filter.$or = or;
    }

    const [items, total, byStatus] = await Promise.all([
      Report.find(filter)
        .select("-notes -replies.photos")
        .sort({ unreadByAdmin: -1, lastActivityAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Report.countDocuments(filter),
      Report.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    res.status(200).json({
      items: items.map((r) => ({
        ...r,
        photoCount: (r.photos || []).length,
        replyCount: (r.replies || []).length,
        replies: undefined,
        text: r.text.length > 240 ? `${r.text.slice(0, 240)}…` : r.text,
      })),
      total,
      page,
      pages: pagesOf(total, limit),
      counts: Object.fromEntries(byStatus.map((s) => [s._id, s.count])),
    });
    return;
  }

  if (req.method === "PATCH") {
    const { id, status, priority, resolution, note, reply, notifyUser = true } = req.body || {};
    requireObjectId(id, "report id");
    const report = await Report.findById(id);
    if (!report) throw new HttpError(404, "Report not found");

    const changes = [];
    const delivery = [];
    const tag = `#${report.reportNumber ?? String(report._id).slice(-6)}`;

    if (priority !== undefined) {
      if (!REPORT_PRIORITIES.includes(priority)) throw new HttpError(400, "Invalid priority");
      if (priority !== report.priority) {
        changes.push(`priority ${report.priority} → ${priority}`);
        report.priority = priority;
      }
    }

    const noteText = cleanStr(note, 2000);
    if (noteText) {
      report.notes.push({ text: noteText, by: process.env.ADMIN_USERNAME || "admin" });
      changes.push("added internal note");
    }

    const replyText = cleanStr(reply, 3000);
    if (replyText) {
      report.replies.push({ from: "admin", text: replyText });
      changes.push("replied to user");
      // First answer means someone is looking at it.
      if (report.status === "open" && status === undefined) {
        report.status = "in_review";
        changes.push("status open → in_review");
      }
      if (notifyUser) {
        const r = await dmUser(
          report.reporterTelegramId,
          `📨 Reply to your report ${tag}\n\n${replyText}`,
          { replyButtonReportId: String(report._id) }
        );
        delivery.push({ kind: "reply", ...r });
      }
    }

    if (status !== undefined && status !== report.status) {
      if (!REPORT_STATUSES.includes(status)) throw new HttpError(400, "Invalid status");
      const resText = cleanStr(resolution, 2000);
      const closing = status === "resolved" || status === "rejected";
      if (status === "rejected" && !resText) throw new HttpError(400, "Please write a reason for rejecting the report");
      changes.push(`status ${report.status} → ${status}`);
      report.status = status;
      if (closing) {
        report.resolution = resText;
        report.resolvedAt = new Date();
        report.resolvedBy = process.env.ADMIN_USERNAME || "admin";
        if (notifyUser) {
          const head =
            status === "resolved"
              ? `✅ Your report ${tag} has been resolved.`
              : `❌ Your report ${tag} was closed without action.`;
          const r = await dmUser(
            report.reporterTelegramId,
            `${head}${resText ? `\n\n${resText}` : ""}\n\nIf something is still wrong, tap Reply and tell us.`,
            { replyButtonReportId: String(report._id) }
          );
          delivery.push({ kind: "status", ...r });
        }
      } else {
        report.resolvedAt = null;
        if (notifyUser) {
          const r = await dmUser(report.reporterTelegramId, `🔎 Your report ${tag} is now: ${STATUS_LABEL[status]}.`);
          delivery.push({ kind: "status", ...r });
        }
      }
    }

    if (!changes.length) {
      res.status(200).json({ ok: true, unchanged: true });
      return;
    }

    report.unreadByAdmin = false;
    report.lastActivityAt = new Date();
    await report.save();

    await logAdmin(req, "report.update", {
      targetType: "report",
      targetId: String(report._id),
      summary: `Report ${tag}: ${changes.join("; ")}`,
      details: { changes, delivery, reporter: report.reporterTelegramId },
    });

    res.status(200).json({ ok: true, delivery, report });
    return;
  }

  res.status(405).end();
});

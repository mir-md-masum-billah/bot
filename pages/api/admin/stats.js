import { withAdmin } from "../../../lib/adminApi.js";
import User from "../../../models/User.js";
import Task from "../../../models/Task.js";
import Submission from "../../../models/Submission.js";
import Report from "../../../models/Report.js";
import Transaction from "../../../models/Transaction.js";

const DAY = 24 * 60 * 60 * 1000;

// GET            -> full overview numbers
// GET ?lite=1    -> just the badge counters (cheap; polled every 30s)
export default withAdmin(async (req, res) => {
  const [pendingSubmissions, openReports, unreadReports] = await Promise.all([
    Submission.countDocuments({ status: "pending" }),
    Report.countDocuments({ status: { $in: ["open", "in_review"] } }),
    Report.countDocuments({ unreadByAdmin: true }),
  ]);

  if (req.query.lite) {
    res.status(200).json({ pendingSubmissions, openReports, unreadReports });
    return;
  }

  const now = Date.now();
  const startToday = new Date();
  startToday.setUTCHours(0, 0, 0, 0);
  const d7 = new Date(now - 7 * DAY);
  const d14 = new Date(now - 14 * DAY);

  const [
    userCount,
    bannedUsers,
    newToday,
    new7d,
    activeTasks,
    pausedTasks,
    completedTasks,
    totalTasks,
    balances,
    tasksByType,
    signups,
    txn7d,
    submissionsByStatus,
  ] = await Promise.all([
    User.countDocuments({}),
    User.countDocuments({ isBanned: true }),
    User.countDocuments({ createdAt: { $gte: startToday } }),
    User.countDocuments({ createdAt: { $gte: d7 } }),
    Task.countDocuments({ status: "active" }),
    Task.countDocuments({ status: "paused" }),
    Task.countDocuments({ status: "completed" }),
    Task.countDocuments({ status: { $ne: "deleted" } }),
    User.aggregate([
      { $group: { _id: null, donated: { $sum: "$donatedBalance" }, earned: { $sum: "$earnedBalance" } } },
    ]),
    Task.aggregate([{ $match: { status: "active" } }, { $group: { _id: "$type", count: { $sum: 1 } } }]),
    User.aggregate([
      { $match: { createdAt: { $gte: d14 } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }, count: { $sum: 1 } } },
    ]),
    Transaction.aggregate([
      { $match: { createdAt: { $gte: d7 } } },
      { $group: { _id: "$type", total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Submission.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  // Fill in zero-days so the signup chart always has 14 bars.
  const byDay = Object.fromEntries(signups.map((s) => [s._id, s.count]));
  const signupsByDay = [];
  for (let i = 13; i >= 0; i--) {
    const day = new Date(now - i * DAY).toISOString().slice(0, 10);
    signupsByDay.push({ day, count: byDay[day] || 0 });
  }

  res.status(200).json({
    pendingSubmissions,
    openReports,
    unreadReports,
    userCount,
    bannedUsers,
    newToday,
    new7d,
    activeTasks,
    pausedTasks,
    completedTasks,
    totalTasks,
    donatedInCirculation: balances[0]?.donated || 0,
    earnedInCirculation: balances[0]?.earned || 0,
    tasksByType: Object.fromEntries(tasksByType.map((t) => [t._id, t.count])),
    signupsByDay,
    transactions7d: txn7d.map((t) => ({ type: t._id, total: t.total, count: t.count })),
    submissionsByStatus: Object.fromEntries(submissionsByStatus.map((s) => [s._id, s.count])),
  });
});

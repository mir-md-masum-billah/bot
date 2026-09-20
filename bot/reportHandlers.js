import { Markup } from "telegraf";
import { message } from "telegraf/filters";
import { dbConnect } from "../lib/db.js";
import User from "../models/User.js";
import Task from "../models/Task.js";
import Submission from "../models/Submission.js";
import Report, { REPORT_CATEGORIES } from "../models/Report.js";
import { nextCounterValue } from "../models/Counter.js";

// 🆘 "Report a Problem" — lets any user (worker, task owner, even a banned
// user appealing) send the admin a written report with up to 5 screenshots,
// follow its status, and answer the admin's replies. Everything lands in the
// dashboard → Reports tab.
//
// Entry points: 👤 My Cabinet → 🆘 Report a Problem, the /report command, and
// the "🆘 Dispute / Report" button on submission-rejection warnings.
//
// Session states used (all prefixed "support_" so the ban filter in bot.js
// lets them through):
//   support_report_text    waiting for the description
//   support_report_photos  waiting for screenshots / the Submit tap
//   support_report_reply   waiting for the user's answer on an existing report

export const REPORT_CATEGORY_LABELS = {
  balance: "💰 Balance / payment problem",
  task: "📋 Problem with a task",
  dispute: "⚖️ Rejected / disputed screenshot",
  abuse: "🚫 Report a user / scam",
  bug: "🐞 Bug in the bot",
  other: "❓ Something else",
};

const STATUS_ICON = { open: "🟡", in_review: "🔎", resolved: "✅", rejected: "❌" };
const STATUS_TEXT = { open: "Open", in_review: "In review", resolved: "Resolved", rejected: "Closed (no action)" };

const MAX_PHOTOS = 5;
const MAX_OPEN_REPORTS = 5;
const MAX_REPORTS_PER_DAY = 10;
const MAX_USER_REPLIES = 20;
const MIN_TEXT = 10;
const MAX_TEXT = 1500;

function adminIds() {
  return (process.env.ADMIN_TELEGRAM_IDS || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n !== 0);
}

function imageFileId(msg) {
  if (msg.photo?.length) return msg.photo[msg.photo.length - 1].file_id;
  if (msg.document && /^image\//.test(msg.document.mime_type || "")) return msg.document.file_id;
  return null;
}

const short = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
const displayName = (from) =>
  from.username ? `@${from.username}` : [from.first_name, from.last_name].filter(Boolean).join(" ") || String(from.id);

export function registerReportHandlers(bot, { getOrCreateUser, setSession, clearSession, sendOrReplace }) {
  // ---- helpers -----------------------------------------------------------

  async function notifyAdmins(text, photoFileId) {
    const ids = adminIds();
    if (!ids.length) return;
    const url = process.env.PUBLIC_URL ? `\n\n🔗 ${process.env.PUBLIC_URL.replace(/\/$/, "")}/admin` : "";
    await Promise.all(
      ids.map(async (id) => {
        try {
          if (photoFileId) {
            await bot.telegram.sendPhoto(id, photoFileId, { caption: short(text + url, 1000) });
          } else {
            await bot.telegram.sendMessage(id, text + url);
          }
        } catch (e) {
          // Admin hasn't started the bot / blocked it — the dashboard still has the report.
        }
      })
    );
  }

  const categoryMenu = () =>
    Markup.inlineKeyboard([
      ...REPORT_CATEGORIES.map((c) => [Markup.button.callback(REPORT_CATEGORY_LABELS[c], `rpt_cat_${c}`)]),
      [Markup.button.callback("📨 My reports", "rpt_mine")],
      [Markup.button.callback("⬅️ Back", "menu_cabinet")],
    ]);

  const cancelMenu = () => Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "rpt_cancel")]]);

  const submitMenu = () =>
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Send report", "rpt_submit")],
      [Markup.button.callback("❌ Cancel", "rpt_cancel")],
    ]);

  async function startReportFlow(ctx, user) {
    await dbConnect();
    const open = await Report.countDocuments({
      reporterTelegramId: user.telegramId,
      status: { $in: ["open", "in_review"] },
    });
    if (open >= MAX_OPEN_REPORTS) {
      await sendOrReplace(
        ctx,
        `🆘 You already have ${open} open reports. Please wait for the admin to answer them ` +
          `(or add details to one of them) before sending a new one.`,
        Markup.inlineKeyboard([
          [Markup.button.callback("📨 My reports", "rpt_mine")],
          [Markup.button.callback("⬅️ Back", "menu_cabinet")],
        ])
      );
      return;
    }
    await clearSession(user);
    await sendOrReplace(
      ctx,
      `🆘 Report a Problem\n\nWhat is this about? Pick a topic, then describe it and attach screenshots — ` +
        `the admin will look at it and reply to you here.`,
      categoryMenu()
    );
  }

  async function askDescription(ctx, user, data) {
    await setSession(user, "support_report_text", data);
    const extra =
      data.category === "dispute"
        ? "Explain why you think the decision was wrong."
        : data.category === "abuse"
        ? "Include the user's @username / ID or the channel link, and what they did."
        : data.category === "task"
        ? "Include the task number or the channel name."
        : data.category === "balance"
        ? "Say how many GRAM are missing/wrong and when it happened."
        : "Write what happened and what you expected.";
    await sendOrReplace(
      ctx,
      `${REPORT_CATEGORY_LABELS[data.category]}\n\n✏️ Describe the problem in one message (at least ${MIN_TEXT} characters).\n${extra}\n\n` +
        `📸 You can attach a screenshot right now (with a caption) or in the next step.`,
      cancelMenu()
    );
  }

  // ---- entry points ------------------------------------------------------

  bot.action(/^(cab_report|rpt_start)$/, async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await ctx.answerCbQuery();
    await startReportFlow(ctx, user);
  });

  bot.command("report", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await startReportFlow(ctx, user);
  });

  bot.command("myreports", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await showMyReports(ctx, user);
  });

  bot.action(/^rpt_cat_(\w+)$/, async (ctx) => {
    const category = ctx.match[1];
    if (!REPORT_CATEGORIES.includes(category)) {
      await ctx.answerCbQuery();
      return;
    }
    const user = await getOrCreateUser(ctx);
    await ctx.answerCbQuery();
    await askDescription(ctx, user, { category });
  });

  // "🆘 Dispute / Report" button under a submission rejection / penalty warning.
  bot.action(/^rpt_sub_([a-f0-9]{24})$/, async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await dbConnect();
    const submission = await Submission.findById(ctx.match[1]).lean();
    if (
      !submission ||
      (submission.workerTelegramId !== user.telegramId && submission.ownerTelegramId !== user.telegramId)
    ) {
      await ctx.answerCbQuery("This submission isn't yours.", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await askDescription(ctx, user, {
      category: "dispute",
      submissionId: String(submission._id),
      taskId: String(submission.taskId),
    });
  });

  bot.action("rpt_cancel", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await clearSession(user);
    await ctx.answerCbQuery("Cancelled");
    await sendOrReplace(
      ctx,
      "❎ Report cancelled.",
      Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "menu_cabinet")]])
    );
  });

  // ---- collecting text + screenshots -------------------------------------

  // Text messages while a report is being written. Anything else falls
  // through (next) to the rest of the bot's text handling.
  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text || "";
    if (text.startsWith("/")) return next();
    const user = await getOrCreateUser(ctx);
    const state = user.sessionState;
    if (!state || !state.startsWith("support_report_")) return next();

    if (state === "support_report_text") {
      if (text.trim().length < MIN_TEXT) {
        await ctx.reply(`Please write a bit more (at least ${MIN_TEXT} characters) so the admin can understand.`, cancelMenu());
        return;
      }
      await setSession(user, "support_report_photos", {
        ...user.sessionData,
        text: text.trim().slice(0, MAX_TEXT),
        photos: [],
      });
      await ctx.reply(
        `📸 Now send your screenshot(s) — up to ${MAX_PHOTOS}. Photos as files work too.\n\n` +
          `When you're ready tap "Send report" (you can also send it without screenshots).`,
        submitMenu()
      );
      return;
    }

    if (state === "support_report_photos") {
      // Extra text → append to the description.
      const current = user.sessionData?.text || "";
      const merged = `${current}\n${text.trim()}`.slice(0, MAX_TEXT);
      await User.updateOne({ telegramId: user.telegramId }, { $set: { "sessionData.text": merged } });
      await ctx.reply("📝 Added to your report. Send screenshots or tap Send report.", submitMenu());
      return;
    }

    if (state === "support_report_reply") {
      await saveUserReply(ctx, user, text.trim().slice(0, MAX_TEXT), []);
      return;
    }

    return next();
  });

  // Screenshots (photo or image sent as a file).
  bot.on([message("photo"), message("document")], async (ctx, next) => {
    const fileId = imageFileId(ctx.message);
    if (!fileId) return next();
    const user = await getOrCreateUser(ctx);
    const state = user.sessionState;
    if (!state || !state.startsWith("support_report_")) return next();
    const caption = (ctx.message.caption || "").trim();

    if (state === "support_report_text") {
      if (caption.length < MIN_TEXT) {
        await ctx.reply(
          `Please describe the problem in words first (at least ${MIN_TEXT} characters). ` +
            `You can also send the screenshot again with the description as its caption.`,
          cancelMenu()
        );
        return;
      }
      await setSession(user, "support_report_photos", {
        ...user.sessionData,
        text: caption.slice(0, MAX_TEXT),
        photos: [fileId],
      });
      await ctx.reply(`📸 Screenshot 1/${MAX_PHOTOS} saved. Send more or tap Send report.`, submitMenu());
      return;
    }

    if (state === "support_report_photos") {
      // Atomic add, so an album of several photos arriving at once can't
      // overwrite each other. The filter also enforces the max of 5.
      await User.updateOne(
        {
          telegramId: user.telegramId,
          sessionState: "support_report_photos",
          [`sessionData.photos.${MAX_PHOTOS - 1}`]: { $exists: false },
        },
        { $addToSet: { "sessionData.photos": fileId } }
      );
      const fresh = await User.findOne({ telegramId: user.telegramId }).select("sessionData sessionState").lean();
      const n = fresh?.sessionData?.photos?.length || 0;
      await ctx.reply(
        n >= MAX_PHOTOS
          ? `📸 ${n}/${MAX_PHOTOS} saved — that's the maximum. Tap Send report.`
          : `📸 Screenshot ${n}/${MAX_PHOTOS} saved. Send more or tap Send report.`,
        submitMenu()
      );
      return;
    }

    if (state === "support_report_reply") {
      await saveUserReply(ctx, user, caption.slice(0, MAX_TEXT) || "📸 (screenshot)", [fileId]);
      return;
    }

    return next();
  });

  // ---- submit ------------------------------------------------------------

  bot.action("rpt_submit", async (ctx) => {
    await dbConnect();
    // Atomically take the pending draft out of the session, so tapping the
    // button twice can't create the same report twice.
    const before = await User.findOneAndUpdate(
      { telegramId: ctx.from.id, sessionState: "support_report_photos" },
      { $set: { sessionState: null, sessionData: {} } },
      { new: false }
    ).lean();
    if (!before) {
      await ctx.answerCbQuery("Nothing to send.");
      return;
    }
    const d = before.sessionData || {};
    if (!d.text || !REPORT_CATEGORIES.includes(d.category)) {
      await ctx.answerCbQuery("Something went wrong, please start again.", { show_alert: true });
      return;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await Report.countDocuments({ reporterTelegramId: before.telegramId, createdAt: { $gte: since } });
    if (recent >= MAX_REPORTS_PER_DAY) {
      await ctx.answerCbQuery();
      await sendOrReplace(
        ctx,
        "⚠️ You've sent many reports today. Please wait for replies before sending more.",
        Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "menu_cabinet")]])
      );
      return;
    }

    const photos = Array.isArray(d.photos) ? d.photos.slice(0, MAX_PHOTOS) : [];
    const report = await Report.create({
      reportNumber: await nextCounterValue("reports", 0),
      reporterTelegramId: before.telegramId,
      reporterUsername: before.username || ctx.from.username || "",
      reporterName: [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" "),
      category: d.category,
      text: d.text,
      photos,
      relatedTaskId: d.taskId || null,
      relatedSubmissionId: d.submissionId || null,
      // A banned user's report is an appeal — surface it.
      priority: before.isBanned ? "high" : "normal",
    });

    await ctx.answerCbQuery("Report sent ✅");
    await sendOrReplace(
      ctx,
      `✅ Report #${report.reportNumber} sent.\n\n` +
        `${REPORT_CATEGORY_LABELS[report.category]}\n` +
        `📸 Screenshots: ${photos.length}\n\n` +
        `The admin will reply here in the bot. You can follow it any time in 📨 My reports.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📨 My reports", "rpt_mine")],
        [Markup.button.callback("⬅️ Back", "menu_cabinet")],
      ])
    );

    await notifyAdmins(
      `🆘 New report #${report.reportNumber}${before.isBanned ? " (BANNED user — appeal)" : ""}\n` +
        `${REPORT_CATEGORY_LABELS[report.category]}\n` +
        `👤 ${displayName(ctx.from)} (ID ${before.telegramId})\n` +
        `📸 ${photos.length} screenshot(s)\n\n` +
        short(report.text, 400),
      photos[0]
    );
  });

  // ---- my reports --------------------------------------------------------

  async function showMyReports(ctx, user) {
    await dbConnect();
    const reports = await Report.find({ reporterTelegramId: user.telegramId })
      .select("reportNumber category status createdAt")
      .sort({ createdAt: -1 })
      .limit(8)
      .lean();
    if (!reports.length) {
      await sendOrReplace(
        ctx,
        "📨 You haven't sent any reports yet.",
        Markup.inlineKeyboard([
          [Markup.button.callback("🆘 Report a Problem", "rpt_start")],
          [Markup.button.callback("⬅️ Back", "menu_cabinet")],
        ])
      );
      return;
    }
    await sendOrReplace(
      ctx,
      "📨 Your reports (latest 8) — tap one to see the answer:",
      Markup.inlineKeyboard([
        ...reports.map((r) => [
          Markup.button.callback(
            `${STATUS_ICON[r.status] || "•"} #${r.reportNumber} · ${REPORT_CATEGORY_LABELS[r.category] || r.category}`,
            `rpt_view_${r._id}`
          ),
        ]),
        [Markup.button.callback("🆘 New report", "rpt_start")],
        [Markup.button.callback("⬅️ Back", "menu_cabinet")],
      ])
    );
  }

  bot.action("rpt_mine", async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await ctx.answerCbQuery();
    await showMyReports(ctx, user);
  });

  bot.action(/^rpt_view_([a-f0-9]{24})$/, async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await dbConnect();
    const r = await Report.findOne({ _id: ctx.match[1], reporterTelegramId: user.telegramId }).lean();
    if (!r) {
      await ctx.answerCbQuery("Report not found.", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const lastAdmin = [...(r.replies || [])].reverse().find((x) => x.from === "admin");
    const userReplies = (r.replies || []).filter((x) => x.from === "user").length;
    const lines = [
      `📨 Report #${r.reportNumber}`,
      `${STATUS_ICON[r.status] || ""} Status: ${STATUS_TEXT[r.status] || r.status}`,
      `${REPORT_CATEGORY_LABELS[r.category] || r.category}`,
      `📅 ${new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC · 📸 ${(r.photos || []).length}`,
      "",
      `📝 ${short(r.text, 500)}`,
    ];
    if (lastAdmin) lines.push("", `💬 Admin: ${short(lastAdmin.text, 700)}`);
    if (r.resolution) lines.push("", `📌 Resolution: ${short(r.resolution, 700)}`);
    const rows = [];
    if (userReplies < MAX_USER_REPLIES) rows.push([Markup.button.callback("💬 Reply / add info", `rpt_reply_${r._id}`)]);
    rows.push([Markup.button.callback("⬅️ Back", "rpt_mine")]);
    await sendOrReplace(ctx, lines.join("\n"), Markup.inlineKeyboard(rows));
  });

  bot.action(/^rpt_reply_([a-f0-9]{24})$/, async (ctx) => {
    const user = await getOrCreateUser(ctx);
    await dbConnect();
    const r = await Report.findOne({ _id: ctx.match[1], reporterTelegramId: user.telegramId })
      .select("reportNumber replies")
      .lean();
    if (!r) {
      await ctx.answerCbQuery("Report not found.", { show_alert: true });
      return;
    }
    if ((r.replies || []).filter((x) => x.from === "user").length >= MAX_USER_REPLIES) {
      await ctx.answerCbQuery("Reply limit reached for this report.", { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    await setSession(user, "support_report_reply", { reportId: String(r._id) });
    await sendOrReplace(
      ctx,
      `💬 Report #${r.reportNumber}\n\n✏️ Send your message (you can attach a screenshot with a caption).`,
      cancelMenu()
    );
  });

  async function saveUserReply(ctx, user, text, photos) {
    await dbConnect();
    const reportId = user.sessionData?.reportId;
    const report = reportId ? await Report.findOne({ _id: reportId, reporterTelegramId: user.telegramId }) : null;
    if (!report) {
      await clearSession(user);
      await ctx.reply("That report no longer exists.");
      return;
    }
    if (report.replies.filter((x) => x.from === "user").length >= MAX_USER_REPLIES) {
      await clearSession(user);
      await ctx.reply("Reply limit reached for this report.");
      return;
    }
    const reopened = report.status === "resolved" || report.status === "rejected";
    report.replies.push({ from: "user", text, photos });
    if (reopened) {
      report.status = "open";
      report.resolvedAt = null;
    }
    report.unreadByAdmin = true;
    report.lastActivityAt = new Date();
    await report.save();
    await clearSession(user);

    await ctx.reply(
      `✅ Sent to the admin${reopened ? " — the report was re-opened" : ""}.`,
      Markup.inlineKeyboard([
        [Markup.button.callback("📨 My reports", "rpt_mine")],
        [Markup.button.callback("⬅️ Back", "menu_cabinet")],
      ])
    );
    await notifyAdmins(
      `💬 New reply on report #${report.reportNumber}${reopened ? " (re-opened)" : ""}\n` +
        `👤 ${displayName(ctx.from)} (ID ${user.telegramId})\n\n${short(text, 400)}`,
      photos[0]
    );
  }
}

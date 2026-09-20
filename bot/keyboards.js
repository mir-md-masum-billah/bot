import { Markup } from "telegraf";

export const mainMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📢 Promote", "menu_promote")],
    [Markup.button.callback("💰 Earn", "menu_earn")],
    [Markup.button.callback("🗂 My Cabinet", "menu_cabinet")],
    [Markup.button.callback("💳 Balance", "menu_balance")],
  ]);

// Persistent bottom keyboard (always visible under the message box),
// matching the PR GRAM-style layout.
export const replyMainMenu = () =>
  Markup.keyboard([
    ["💰 Earnings", "📢 Promote"],
    ["📤 Checks", "👤 My Cabinet"],
    ["✅ Subscription Check", "📊 Our Bots and Statistics"],
    ["🔗 Useful Links", "ℹ️ Instruction"],
  ]).resize();

// (The old inline promoteTypeMenu was replaced by promoteTypeReplyMenu
// below — the real app uses a persistent reply keyboard for this step.)

// The earn screen lists every category two-per-row with the number of
// tasks the *current user* can still take in it — "📢 Channels · 328".
// The counts are supplied by getEarnCounts() in bot.js (they're per-user,
// so they can't be cached or hard-coded here). A missing count renders as
// 0 rather than blowing up, so a failed count query degrades to a usable
// menu instead of no menu at all.
export const earnTypeMenu = (counts = {}) => {
  const cat = (label, key, action) =>
    Markup.button.callback(`${label} · ${(counts[key] || 0).toLocaleString()}`, action);

  return Markup.inlineKeyboard([
    [cat("📢 Channels", "channel", "earn_channel"), cat("👥 Groups", "group", "earn_group")],
    [cat("👁 Views", "views", "earn_views"), cat("🤖 Bots", "bot", "earn_bot")],
    [cat("❤️ Reactions", "reactions", "earn_reactions"), cat("⚡️ Boost", "boost", "earn_boost")],
    [Markup.button.callback("📋 Rules", "earn_rules")],
    [Markup.button.callback("⬅️ Back", "menu_main")],
  ]);
};

// Shown right after "🤖 Bot" is picked in 📢 Promote, so the user actually
// picks WHICH bot is being promoted before anything else. There's no Bot
// API call that lists "bots this user owns/has chatted with" — the only
// way to offer a real picker is Telegram's own `request_users` button
// (KeyboardButtonRequestUsers), filtered to bots only. Once the user picks
// one there, Telegram sends this bot a `users_shared` service message with
// its id (and, since request_username/request_name are set below, its
// @username and display name too — no extra getChat call needed).
export const botRequestReplyMenu = () =>
  Markup.keyboard([
    [
      Markup.button.userRequest("🤖 Choose bot", 1, {
        user_is_bot: true,
        request_name: true,
        request_username: true,
      }),
    ],
    ["⬅️ Back"],
  ]).resize();

// Shown right after a bot has been picked, mirroring PR GRAM's
// "Choose the task type" step.
export const botTaskTypeMenu = () =>
  Markup.keyboard([
    ["▶️ Bot start only", "📝 With additional conditions"],
    ["⬅️ Back"],
  ]).resize();

// Sent to the task owner alongside the worker's screenshot.
export const submissionReviewMenu = (submissionId) =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("✅ Approve", `submission_approve_${submissionId}`),
      Markup.button.callback("❌ Reject", `submission_reject_${submissionId}`),
    ],
  ]);

export const subscriberCountMenu = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("50", "count_50"),
      Markup.button.callback("100", "count_100"),
      Markup.button.callback("250", "count_250"),
    ],
    [
      Markup.button.callback("500", "count_500"),
      Markup.button.callback("1000", "count_1000"),
    ],
    [Markup.button.callback("✏️ Custom amount", "count_custom")],
    [Markup.button.callback("⬅️ Back", "menu_promote")],
  ]);

// ---------- 👤 My Cabinet ----------
// Mirrors the PR GRAM cabinet screen: one full-width inline button per row,
// with the notification row reflecting the user's current setting.
export const cabinetMenu = (user = {}) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("💳 Replenish Balance", "cab_replenish")],
    [Markup.button.callback("👥 Referral System", "cab_referral")],
    [Markup.button.callback("📈 Level System", "cab_levels")],
    [Markup.button.callback("📋 My Tasks", "cabinet_tasks")],
    [Markup.button.callback("🌐 Change Language", "cab_language")],
    [
      user.notificationsEnabled === false
        ? Markup.button.callback("🔔 Enable notifications", "cab_notif_on")
        : Markup.button.callback("❌ Disable notifications", "cab_notif_off"),
    ],
    [Markup.button.callback("⬅️ Back", "menu_main")],
  ]);

// Status icon shown in front of every task row and in the task header.
export const TASK_STATUS_ICON = {
  active: "▶️",
  paused: "⏸",
  completed: "✅",
};

const TASK_TYPE_ICON = {
  channel: "📢",
  group: "👥",
  views: "👁",
  bot: "🤖",
  boost: "⚡️",
  reactions: "❤️",
};

// One compact row per task — "▶️ 👥 3 - 1000 💰" (status, type, goal,
// price) — then the status filter row, exactly like the real app's list.
export const myTasksMenu = (tasks, filter = "active") => {
  const rows = tasks.map((t) => [
    Markup.button.callback(
      `${TASK_STATUS_ICON[t.status] || "▶️"} ${TASK_TYPE_ICON[t.type] || "📋"} ` +
        `${t.goalCount} - ${t.pricePerAction} 💰`,
      `taskdet_${t._id}`
    ),
  ]);

  // The active filter is marked so the list never looks identical between
  // tabs when one of them happens to be empty.
  const tab = (label, value) =>
    Markup.button.callback(filter === value ? `• ${label} •` : label, `tasklist_${value}`);

  rows.push([tab("In progress", "active"), tab("Finished", "completed"), tab("Paused", "paused")]);
  rows.push([Markup.button.callback("➕ Create New Task", "menu_promote")]);
  rows.push([Markup.button.callback("⬅️ Back", "menu_cabinet")]);
  return Markup.inlineKeyboard(rows);
};

// The single-task management screen.
export const taskDetailMenu = (task) => {
  const id = task._id.toString();
  return Markup.inlineKeyboard([
    [Markup.button.callback("➕ Add Execution", `task_add_${id}`)],
    [
      task.status === "active"
        ? Markup.button.callback("⏸ Pause", `task_pause_${id}`)
        : Markup.button.callback("▶️ Resume", `task_resume_${id}`),
      Markup.button.callback("🗑 Delete", `task_delete_${id}`),
    ],
    [Markup.button.callback("✏️ Change Price", `task_price_${id}`)],
    [
      Markup.button.callback(
        `👤 Account type: ${task.audienceMode === "premium_only" ? "Premium only" : "All users"}`,
        `task_acct_${id}`
      ),
    ],
    [
      Markup.button.callback(
        `🌐 Audience: ${task.languages?.length ? `${task.languages.length} language(s)` : "All users"}`,
        `task_aud_${id}`
      ),
    ],
    [
      task.notifyOwner === false
        ? Markup.button.callback("🔔 Enable notification", `task_notif_${id}_on`)
        : Markup.button.callback("❌ Disable notification", `task_notif_${id}_off`),
    ],
    [Markup.button.callback("🔄 Refresh Invite Link", `task_link_${id}`)],
    [Markup.button.callback("⬅️ Back", "cabinet_tasks")],
  ]);
};

// Confirmation step for Delete — a mis-tap here refunds and kills a paid
// task, so it never fires straight from the detail screen.
export const taskDeleteConfirmMenu = (taskId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🗑 Yes, delete it", `task_delconf_${taskId}`)],
    [Markup.button.callback("⬅️ No, keep it", `taskdet_${taskId}`)],
  ]);

// Inline language multi-select. Used both for the cabinet's interface
// language (single pick, prefix "cablang_") and for a task's audience
// filter (multi pick, prefix "taskaud_") — the caller supplies the prefix.
export const languagePickMenu = (prefix, selected = [], doneAction, multi = true) => {
  const rows = [];
  for (let i = 0; i < LANGUAGES.length; i += 2) {
    rows.push(
      LANGUAGES.slice(i, i + 2).map((l) =>
        Markup.button.callback(
          `${multi && selected.includes(l.code) ? "✅ " : ""}${l.label}`,
          `${prefix}${l.code}`
        )
      )
    );
  }
  if (multi) rows.push([Markup.button.callback("☑️ Save", doneAction)]);
  else rows.push([Markup.button.callback("⬅️ Back", doneAction)]);
  return Markup.inlineKeyboard(rows);
};

export const backToCabinetMenu = () =>
  Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", "menu_cabinet")]]);

export const backToTaskMenu = (taskId) =>
  Markup.inlineKeyboard([[Markup.button.callback("⬅️ Back", `taskdet_${taskId}`)]]);

// (earnActionMenu removed — replaced by the paginated earnTaskListMenu below)
// ---------- earn task list (channels/groups/etc, paginated) ----------

// One row per task: a URL button to actually open/join the chat, paired
// with a "Check" button the bot uses to verify membership and pay out.
// Post-view tasks work differently from subscribe tasks: there is nothing
// to open and no membership to check. Tapping the button makes the bot
// forward the promoted post straight into this chat and pay immediately,
// so it's a single callback button per task (matching "👁 View Post +N GRAM").
// Verb shown on the URL button, per category — "Subscribe" is wrong for a
// bot (you start it), a reaction (you react) or a boost (you boost), and
// the worker needs to know which action actually gets paid.
const EARN_ACTION_VERB = {
  channel: "Subscribe",
  group: "Join",
  sub: "Subscribe",
  bot: "Start Bot",
  reactions: "React",
  boost: "Boost",
};

export const earnTaskListMenu = (tasks, category, page, totalPages) => {
  const verb = EARN_ACTION_VERB[category] || "Open";
  const rows =
    category === "views"
      ? tasks.map((t) => [
          Markup.button.callback(
            `👁 View Post +${t.pricePerAction} GRAM`,
            `viewpost_${t._id}`
          ),
        ])
      : tasks.map((t) => [
          Markup.button.url(
            `💲 +${t.pricePerAction} | ${verb}`,
            t.targetInviteLink || "https://t.me"
          ),
          Markup.button.callback("🔄 Check", `verify_${t._id}`),
        ]);

  rows.push([
    Markup.button.callback("1", `earnpage_${category}_1`),
    Markup.button.callback("<", `earnpage_${category}_${Math.max(1, page - 1)}`),
    Markup.button.callback(`${page}`, `earnpage_${category}_${page}`),
    Markup.button.callback(">", `earnpage_${category}_${Math.min(totalPages, page + 1)}`),
    Markup.button.callback(`${totalPages}`, `earnpage_${category}_${totalPages}`),
  ]);
  // Views tasks get their own Report button right under the post the user
  // just saw (see afterViewMenu), so the generic one is only for the rest.
  if (category !== "views") {
    rows.push([Markup.button.callback("❌ Report", `earnreport_${category}_${page}`)]);
  }
  rows.push([Markup.button.callback("⬅️ Back", "menu_earn")]);

  return Markup.inlineKeyboard(rows);
};

// ---------- post (views) promotion + viewing ----------

// Shown while the bot waits for the user to forward the post they want
// promoted. Only "⬅️ Back" — the actual input is a forwarded message.
export const postForwardMenu = () => Markup.keyboard([["⬅️ Back"]]).resize();

// Shown when the bot isn't an admin in the channel the post came from.
// The deep link opens Telegram's own "Choose a Channel" dialog and grants
// the listed admin rights in one step.
export const addBotToChannelMenu = (addBotLink) =>
  Markup.inlineKeyboard([
    [Markup.button.url("➕ Add bot to channel", addBotLink)],
    [Markup.button.callback("🔄 Check again", "postadmin_recheck")],
  ]);

// Sent right after a worker is shown a promoted post and paid for it.
// "Next Post" goes straight to the next unseen post (nextpost_views in
// bot.js) so viewing runs post → post → post without returning to the list.
export const afterViewMenu = (taskId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("➡️ Next Post", "nextpost_views")],
    [Markup.button.callback("❌ Report", `postreport_${taskId}`)],
    [Markup.button.callback("⬅️ Back", "menu_earn")],
  ]);

export const reportReasonMenu = (taskId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🔞 Inappropriate content", `prsn_${taskId}_adult`)],
    [Markup.button.callback("📝 Other reason", `prsn_${taskId}_other`)],
    [Markup.button.callback("⬅️ Back", "earn_views")],
  ]);

// Shown when a user's periodic human-verification is due (see
// ANTI_BOT_CHECK_INTERVAL in bot.js) before any further Check taps count.
export const humanVerifyMenu = (verifyUrl) =>
  Markup.inlineKeyboard([
    [Markup.button.webApp("🧩 Verify", verifyUrl)],
    [Markup.button.callback("✅ Continue", "hv_continue")],
  ]);

// ---------- promote wizard (channel/group/post/boost/reactions) ----------
// This whole section mirrors the real app's flow: every step here is a
// persistent reply keyboard (full-width buttons), not inline buttons.

export const promoteTypeReplyMenu = () =>
  Markup.keyboard([
    ["📢 Channel", "👥 Group"],
    ["👁 Post", "🤖 Bot"],
    ["⚡️ Premium boost (channel)", "❤️ Reactions"],
    ["⚙️ Auto-task settings"],
    ["📋 My Tasks", "⬅️ Back"],
  ]).resize();

// `request_chat` keyboard buttons are the only Bot API mechanism that can
// show "pick one of your own channels/groups" — there's no API call that
// lists which chats a given user administers. Telegram itself renders the
// "Choose a Channel/Group" screen (with the admin-rights requirement and a
// "Create a New Channel for This" option) and, once the user picks or
// creates one, both (a) grants the bot the requested admin rights there and
// (b) sends this bot a `chat_shared` service message with the chosen
// chat's id. Both "I'm an admin" and "I'm not an admin" open the exact same
// picker — whichever the user already has, this is how the bot actually
// finds out the chat id and becomes an admin if it wasn't one already.
function chatRequestButton(text, requestId, type) {
  const rights = { can_invite_users: true };
  const extra = { user_administrator_rights: rights, bot_administrator_rights: rights };
  return type === "group"
    ? Markup.button.groupRequest(text, requestId, extra)
    : Markup.button.channelRequest(text, requestId, extra);
}

export const adminStatusReplyMenu = (type) =>
  Markup.keyboard([
    [chatRequestButton("🏠 I'm an admin", 1, type)],
    [chatRequestButton("👁 I'm not an admin", 2, type)],
    ["⬅️ Back"],
  ]).resize();

export const linkTypeMenu = () =>
  Markup.keyboard([["➡️ Skip"], ["➕ Join-request link"], ["⬅️ Back"]]).resize();

export const audienceMainMenu = () =>
  Markup.keyboard([["🌐 Allow all"], ["🎯 Select audience"], ["⬅️ Back"]]).resize();

export const audienceTierMenu = () =>
  Markup.keyboard([["1️⃣ All users"], ["2️⃣ Telegram Premium only"], ["⬅️ Back"]]).resize();

// Language codes shown for the audience-language filter. Add/remove entries
// here to change what's offered — this list isn't tied to anything else.
export const LANGUAGES = [
  { code: "uk", label: "🇺🇦 Українська" },
  { code: "ru", label: "🇷🇺 Русский" },
  { code: "en", label: "🇬🇧 English" },
  { code: "de", label: "🇩🇪 Deutsch" },
  { code: "zh", label: "🇨🇳 中文" },
  { code: "ar", label: "🇸🇦 العربية" },
  { code: "fa", label: "🇮🇷 فارسی" },
  { code: "es", label: "🇪🇸 Español" },
  { code: "id", label: "🇮🇩 Bahasa Indonesia" },
  { code: "pt", label: "🇧🇷 Português" },
  { code: "hi", label: "🇮🇳 हिंदी" },
  { code: "bn", label: "🇧🇩 বাংলা" },
  { code: "uz", label: "🇺🇿 O'zbekcha" },
  { code: "tr", label: "🇹🇷 Türkçe" },
  { code: "kk", label: "🇰🇿 Қазақша" },
  { code: "fr", label: "🇫🇷 Français" },
];

// Reply-keyboard buttons can't show a real checkbox, so a selected language
// is prefixed with ✅ instead — strip that prefix back off when matching
// incoming taps against LANGUAGES (see findLanguageByButtonText in bot.js).
export const languageMenu = (selected = []) => {
  const rows = [];
  for (let i = 0; i < LANGUAGES.length; i += 2) {
    rows.push(
      LANGUAGES.slice(i, i + 2).map(
        (l) => `${selected.includes(l.code) ? "✅ " : ""}${l.label}`
      )
    );
  }
  rows.push([`☑️ Continue (${selected.length} selected)`]);
  rows.push(["⬅️ Back"]);
  return Markup.keyboard(rows).resize();
};

// Five balance-based choices (1/5, 2/5, 3/5, 4/5 and the full maximum the
// user can afford) plus a free-text option, so the common case is one tap
// and nobody has to work out what their balance covers.
export const countMenu = (maxForBalance) => {
  const fractions = [1, 2, 3, 4]
    .map((part) => Math.floor((maxForBalance * part) / 5))
    .filter((n, i, arr) => n >= 1 && arr.indexOf(n) === i && n < maxForBalance)
    .map(String);

  const rows = [];
  if (fractions.length) rows.push(fractions);
  rows.push([`${maxForBalance} (Maximum for your balance)`]);
  rows.push(["✏️ Custom amount"]);
  rows.push(["⬅️ Back"]);
  return Markup.keyboard(rows).resize();
};

// The price step takes a typed number, so the audience buttons from the
// previous step must not stay on screen — this replaces them.
export const priceInputMenu = () => Markup.keyboard([["⬅️ Back"]]).resize();

export const paymentMethodMenu = (gramCost, starsCost) =>
  Markup.keyboard([
    [`💲 ${gramCost} GRAM`],
    [`⭐ ${starsCost} Telegram stars (-15%)`],
    ["⬅️ Back"],
  ]).resize();

export const joinRequestConfirmMenu = () =>
  Markup.keyboard([["✅ Yes, confirm"], ["⬅️ Back"]]).resize();

export const publishConfirmMenu = () =>
  Markup.keyboard([["✅ Publish Task"], ["⬅️ Back"]]).resize();

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

export const earnTypeMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("👥 Subscribe (Channel/Group)", "earn_sub")],
    [Markup.button.callback("👀 Views", "earn_views")],
    [Markup.button.callback("🤖 Bots", "earn_bot")],
    [Markup.button.callback("⬅️ Back", "menu_main")],
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

export const cabinetMenu = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📋 My Tasks", "cabinet_tasks")],
    [Markup.button.callback("⬅️ Back", "menu_main")],
  ]);

export const taskManageMenu = (taskId, status) =>
  Markup.inlineKeyboard([
    [
      status === "active"
        ? Markup.button.callback("⏸ Pause", `task_pause_${taskId}`)
        : Markup.button.callback("▶️ Resume", `task_resume_${taskId}`),
      Markup.button.callback("🗑 Delete", `task_delete_${taskId}`),
    ],
    [Markup.button.callback("⬅️ Back to list", "cabinet_tasks")],
  ]);

// (earnActionMenu removed — replaced by the paginated earnTaskListMenu below)
// ---------- earn task list (channels/groups/etc, paginated) ----------

// One row per task: a URL button to actually open/join the chat, paired
// with a "Check" button the bot uses to verify membership and pay out.
// Post-view tasks work differently from subscribe tasks: there is nothing
// to open and no membership to check. Tapping the button makes the bot
// forward the promoted post straight into this chat and pay immediately,
// so it's a single callback button per task (matching "👁 View Post +N GRAM").
export const earnTaskListMenu = (tasks, category, page, totalPages) => {
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
            `💲 +${t.pricePerAction} | Subscribe`,
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
export const afterViewMenu = (taskId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("➡️ Next Post", "earn_views")],
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

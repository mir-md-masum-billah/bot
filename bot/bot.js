import { Telegraf, Markup } from "telegraf";
import { dbConnect } from "../lib/db.js";
import User from "../models/User.js";
import Task from "../models/Task.js";
import Transaction from "../models/Transaction.js";
import Chat from "../models/Chat.js";
import {
  mainMenu,
  replyMainMenu,
  promoteTypeMenu,
  earnTypeMenu,
  subscriberCountMenu,
  cabinetMenu,
  taskManageMenu,
  earnActionMenu,
  adminStatusReplyMenu,
  addBotMenu,
  chatPickerMenu,
} from "./keyboards.js";

// Telegram gives channels the type "channel", but groups/supergroups come
// back as "group" or "supergroup" — normalize both to our own "group".
function normalizeChatType(telegramChatType) {
  return telegramChatType === "channel" ? "channel" : "group";
}

const COMMISSION_PERCENT = Number(process.env.EARNED_COMMISSION_PERCENT || 10);

// Turn the "delete old menu / delete user's message" behavior on or off in
// one place. Set back to true to re-enable auto-delete later.
const AUTO_DELETE_MESSAGES = false;

// A single Telegraf instance is reused across warm serverless invocations.
export const bot = new Telegraf(process.env.BOT_TOKEN);

// Cached so we don't call getMe() on every single deep-link build.
let cachedBotUsername = null;
async function getBotUsername() {
  if (!cachedBotUsername) {
    const me = await bot.telegram.getMe();
    cachedBotUsername = me.username;
  }
  return cachedBotUsername;
}

const TYPE_LABELS = {
  channel: "📢 Channel",
  group: "👥 Group",
  views: "👁 Post",
  bot: "🤖 Bot",
  boost: "⚡️ Premium Boost",
  reactions: "❤️ Reactions",
};

// ---------- helpers ----------

async function getOrCreateUser(ctx) {
  await dbConnect();
  const from = ctx.from;
  let user = await User.findOne({ telegramId: from.id });
  if (!user) {
    user = await User.create({
      telegramId: from.id,
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    });
  }
  return user;
}

async function setSession(user, state, data = {}) {
  user.sessionState = state;
  user.sessionData = data;
  await user.save();
}

async function clearSession(user) {
  user.sessionState = null;
  user.sessionData = {};
  await user.save();
}

async function creditEarned(user, amount, note, relatedTaskId) {
  user.earnedBalance += amount;
  await user.save();
  await Transaction.create({
    telegramId: user.telegramId,
    type: "earn_task",
    amount,
    relatedTaskId,
    note,
  });
}

// Spend: donated balance first, then earned balance (commission applies
// only to the portion paid from earned/non-donated coins).
async function spendForTask(user, totalCost) {
  let fromDonated = Math.min(user.donatedBalance, totalCost);
  let fromEarned = totalCost - fromDonated;
  let commission = 0;

  if (fromEarned > 0) {
    commission = Math.ceil((fromEarned * COMMISSION_PERCENT) / 100);
  }

  const grandTotal = fromDonated + fromEarned + commission;
  if (user.donatedBalance + user.earnedBalance < grandTotal) {
    return { ok: false, needed: grandTotal };
  }

  user.donatedBalance -= fromDonated;
  user.earnedBalance -= fromEarned + commission;
  await user.save();

  await Transaction.create({
    telegramId: user.telegramId,
    type: "spend_task",
    amount: -(fromDonated + fromEarned),
    note: "Task creation cost",
  });
  if (commission > 0) {
    await Transaction.create({
      telegramId: user.telegramId,
      type: "commission",
      amount: -commission,
      note: `${COMMISSION_PERCENT}% commission on earned coins`,
    });
  }

  return { ok: true, commission };
}

async function isBotAdminIn(chatId) {
  try {
    const me = await bot.telegram.getMe();
    const member = await bot.telegram.getChatMember(chatId, me.id);
    return ["administrator", "creator"].includes(member.status);
  } catch (e) {
    return false;
  }
}

async function isUserMemberOf(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) {
    return false;
  }
}

async function isUserAdminOf(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ["administrator", "creator"].includes(member.status);
  } catch (e) {
    // Chat deleted, bot kicked, or user left — treat as "can't confirm admin".
    return false;
  }
}

// Builds the "🏠 I'm an admin" / "👁 I'm not an admin" picker list from
// chats WE ALREADY KNOW ABOUT (see the my_chat_member handler below).
// There is no Bot API call that returns "every chat this Telegram user
// administers" — a bot can only introspect membership for chats it has
// itself already joined, so this list can never be a full account-wide
// picker the way Telegram's own native add-to-chat dialog is.
async function showChatPicker(ctx, user, type, wantAdmin) {
  await dbConnect();
  const candidates = await Chat.find({ type, isBotActive: true }).limit(200);

  const matches = [];
  for (const chat of candidates) {
    const isAdmin = await isUserAdminOf(chat.chatId, ctx.from.id);
    if (isAdmin === wantAdmin) matches.push(chat);
  }

  if (!matches.length) {
    await ctx.reply(
      wantAdmin
        ? `⚠️ Emon kono ${type} pawa jayni jekhane ami (bot) age theke add ache ar apni admin. ` +
            `Age amake oi ${type}-ta te admin banan, tarpor "🏠 I'm an admin" abar try korun.`
        : `⚠️ Emon kono ${type} pawa jayni jekhane ami (bot) age theke add ache ar apni admin na. ` +
            `Note: ami sudhu segulo dekhate pari jegulote amake age theke add kora hoyeche — ` +
            `notun kono chat er khoje ei list e ashbe na.`,
      replyMainMenu()
    );
    return;
  }

  await setSession(user, "picking_chat", { type });
  await ctx.reply(
    `👇 Niche theke ${type === "channel" ? "channel" : "group"}-ta select korun:`,
    chatPickerMenu(matches)
  );
}

bot.action(/pick_chat_(.+)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  if (user.sessionState !== "picking_chat") return;
  const { type } = user.sessionData;

  await dbConnect();
  const chat = await Chat.findById(ctx.match[1]);
  if (!chat) {
    await ctx.reply("Chat-ta ar khuje pawa jayni. Abar list dekhun.");
    return;
  }

  await setSession(user, "awaiting_price", {
    type,
    targetChatId: chat.chatId,
    targetChatTitle: chat.title,
    targetChatUsername: chat.username,
  });
  await ctx.editMessageText(
    `${TYPE_LABELS[type]} selected — ${chat.title || chat.username || chat.chatId}\n\n` +
      `💡 Send the price (in coins) you want to pay per completion.\n` +
      `Tip: check the "Earn" section for current prices — higher prices get completed faster.`
  );
});

// Tracks every chat the bot itself is added to / removed from / promoted
// in, so the pickers above have something to search. Fires on ANY change
// to the bot's own membership status in a chat.
bot.on("my_chat_member", async (ctx) => {
  try {
    await dbConnect();
    const update = ctx.myChatMember;
    const chat = update.chat;
    const status = update.new_chat_member.status;
    const isActive = ["administrator", "member", "creator"].includes(status);

    await Chat.findOneAndUpdate(
      { chatId: String(chat.id) },
      {
        chatId: String(chat.id),
        type: normalizeChatType(chat.type),
        title: chat.title,
        username: chat.username,
        isBotActive: isActive,
      },
      { upsert: true }
    );
  } catch (e) {
    console.error("Failed to track my_chat_member update:", e);
  }
});

// Deletes the bot's previous menu message (if any) before sending a new
// one, then remembers the new message id. Keeps the chat from filling up
// with old menus every time the user taps a reply-keyboard button.
async function sendClean(ctx, user, text, extra) {
  if (AUTO_DELETE_MESSAGES && user.lastMenuMessageId) {
    try {
      await bot.telegram.deleteMessage(ctx.chat.id, user.lastMenuMessageId);
    } catch (e) {
      // Already deleted, too old (48h+), or the bot lacks permission — ignore.
    }
  }
  const sent = await ctx.reply(text, extra);
  user.lastMenuMessageId = sent.message_id;
  await user.save();
  return sent;
}

// Best-effort deletion of the user's own triggering message. Telegram only
// allows this in groups/supergroups where the bot is an admin with delete
// rights — in private chats a bot can NEVER delete a message the user sent,
// so this silently does nothing there. This is a Telegram platform rule,
// not something that can be worked around from bot code.
async function tryDeleteUserMessage(ctx) {
  if (!AUTO_DELETE_MESSAGES) return;
  try {
    await ctx.deleteMessage();
  } catch (e) {
    // no-op
  }
}

// ---------- commands ----------

bot.start(async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await clearSession(user);
  await tryDeleteUserMessage(ctx);
  await sendClean(
    ctx,
    user,
    `👋 Welcome to the Promotion Bot!\n\n` +
      `📢 Promote your channel/group/bot using coins.\n` +
      `💰 Earn coins by subscribing to others' channels and completing tasks.\n\n` +
      `💳 Balance: ${user.donatedBalance + user.earnedBalance} coins`,
    replyMainMenu()
  );
});

bot.command("balance", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.reply(
    `💳 Your balance:\n` +
      `• Donated: ${user.donatedBalance}\n` +
      `• Earned: ${user.earnedBalance}\n` +
      `• Total: ${user.donatedBalance + user.earnedBalance} coins`
  );
});

// ---------- navigation ----------

bot.action("menu_main", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await clearSession(user);
  await ctx.editMessageText("🏠 Main Menu", mainMenu());
});

bot.action("menu_balance", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await ctx.reply(
    `💳 Your balance:\n` +
      `• Donated: ${user.donatedBalance}\n` +
      `• Earned: ${user.earnedBalance}\n` +
      `• Total: ${user.donatedBalance + user.earnedBalance} coins`
  );
});

bot.action("menu_promote", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const total = user.donatedBalance + user.earnedBalance;
  await ctx.editMessageText(
    `📢 What do you want to promote?\n\n💰 Balance: ${total.toLocaleString()} GRAM`,
    promoteTypeMenu()
  );
});

bot.action("menu_earn", async (ctx) => {
  await ctx.editMessageText("💰 Choose a category to earn coins:", earnTypeMenu());
});

bot.action("menu_cabinet", async (ctx) => {
  await ctx.editMessageText("🗂 My Cabinet", cabinetMenu());
});

// ---------- promote flow ----------

// Shared "ask for price" step, used once we know (or the user has
// confirmed) that the bot is an admin in the target chat.
async function startPriceFlow(ctx, type) {
  const user = await getOrCreateUser(ctx);
  await setSession(user, "awaiting_price", { type });
  await ctx.editMessageText(
    `${TYPE_LABELS[type]} selected.\n\n` +
      `💡 Send the price (in coins) you want to pay per completion.\n` +
      `Tip: check the "Earn" section for current prices — higher prices get completed faster.`
  );
}

// Views/Bot/Boost/Reactions go straight to the price step, same as before.
bot.action(/promote_(views|bot|boost|reactions)/, async (ctx) => {
  await startPriceFlow(ctx, ctx.match[1]);
});

// Channel/Group first ask whether the bot is already an admin there, since
// that's a hard requirement (see isBotAdminIn) before a task can go live.
// This step uses a persistent reply keyboard (not inline buttons), matching
// the target UI, so it's handled by the bot.hears() handlers below rather
// than bot.action().
bot.action(/promote_(channel|group)/, async (ctx) => {
  const type = ctx.match[1];
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await setSession(user, "choosing_admin_status", { type });
  await ctx.reply(
    "📢 Choose a chat or channel to promote (the bot must be an admin)",
    adminStatusReplyMenu()
  );
});

// "🏠 I'm an admin" — show a list of chats (of the type already chosen)
// that the bot already knows about, filtered to the ones THIS user is
// admin/creator of. Tapping one jumps straight to the price step with
// that chat locked in (see pick_chat_ handler above).
bot.hears("🏠 I'm an admin", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  if (user.sessionState !== "choosing_admin_status") return;
  const { type } = user.sessionData;
  await showChatPicker(ctx, user, type, true);
});

// "👁 I'm not an admin" — same list, but filtered to chats the bot knows
// about where this user is NOT admin/creator.
//
// IMPORTANT LIMITATION: both lists can only ever contain chats the bot has
// already been added to at some point (tracked via my_chat_member below).
// There is no Telegram Bot API call that returns "every chat this user
// administers" across their whole account — only Telegram's own native
// add-to-chat dialog (used previously here) can show that. If the chat the
// user actually wants isn't in the list yet, they still need to add the
// bot to it first — offer that as a fallback.
bot.hears("👁 I'm not an admin", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  if (user.sessionState !== "choosing_admin_status") return;
  const { type } = user.sessionData;
  await showChatPicker(ctx, user, type, false);
});

// Fallback for when the wanted chat isn't in either list yet — opens
// Telegram's native add-to-channel/add-to-group picker so the user can add
// the bot somewhere new. Kept as an explicit escape hatch since the two
// pickers above are limited to chats already known to the bot.
bot.hears("➕ Add me to a new chat", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  if (user.sessionState !== "choosing_admin_status") return;
  const { type } = user.sessionData;
  const botUsername = await getBotUsername();
  await ctx.reply(
    `➕ Tap the button below to add me to your ${type}.\n\n` +
      `Telegram will show you a list of the ${type}s you manage — pick one and ` +
      `confirm the admin permissions. Then come back here and tap "I've added it".`,
    addBotMenu(type, botUsername)
  );
});

// "⬅️ Back" from the admin-status reply keyboard — return to the promote
// type menu and restore the normal persistent keyboard.
bot.hears("⬅️ Back", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  if (user.sessionState !== "choosing_admin_status") return;
  await clearSession(user);
  const total = user.donatedBalance + user.earnedBalance;
  await ctx.reply(
    `📢 What do you want to promote?\n\n💰 Balance: ${total.toLocaleString()} GRAM`,
    replyMainMenu()
  );
  await ctx.reply("👇 Pick a type:", promoteTypeMenu());
});

// "✅ I've added it — Continue" (inline button shown alongside the
// "➕ Add to Channel/Group" link) — proceed to price step.
bot.action(/admin_yes_(channel|group)/, async (ctx) => {
  await ctx.answerCbQuery();
  await startPriceFlow(ctx, ctx.match[1]);
});

bot.action("promote_auto_settings", async (ctx) => {
  // Placeholder: auto-task settings (automatically recreate a task with the
  // same parameters once it completes) isn't wired up to real logic yet.
  // A full version would add fields like `autoRepeat`/`autoRepeatCount` on
  // the Task model and a scheduled job (e.g. a Vercel Cron route) that
  // recreates completed tasks for users who enabled this.
  await ctx.answerCbQuery();
  await ctx.editMessageText(
    "⚙️ Auto-task settings\n\n" +
      "This feature (automatically recreating a task once it completes) isn't " +
      "built yet in this version — let me know if you want it added.",
    promoteTypeMenu()
  );
});

bot.action("cabinet_tasks", async (ctx) => {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  const tasks = await Task.find({
    ownerTelegramId: user.telegramId,
    status: { $ne: "deleted" },
  }).sort({ createdAt: -1 });

  if (!tasks.length) {
    await ctx.editMessageText("You have no tasks yet.", cabinetMenu());
    return;
  }

  await ctx.editMessageText(`📋 You have ${tasks.length} task(s):`);
  for (const t of tasks) {
    await ctx.reply(
      `${TYPE_LABELS[t.type]} — ${t.targetChatTitle || t.targetChatId}\n` +
        `Price: ${t.pricePerAction} coins | Progress: ${t.completedCount}/${t.goalCount}\n` +
        `Status: ${t.status}`,
      taskManageMenu(t._id.toString(), t.status)
    );
  }
});

bot.action(/task_pause_(.+)/, async (ctx) => {
  await dbConnect();
  await Task.updateOne({ _id: ctx.match[1] }, { status: "paused" });
  await ctx.answerCbQuery("Task paused");
  await ctx.editMessageText("⏸ Task paused.");
});

bot.action(/task_resume_(.+)/, async (ctx) => {
  await dbConnect();
  await Task.updateOne({ _id: ctx.match[1] }, { status: "active" });
  await ctx.answerCbQuery("Task resumed");
  await ctx.editMessageText("▶️ Task resumed.");
});

bot.action(/task_delete_(.+)/, async (ctx) => {
  await dbConnect();
  const task = await Task.findById(ctx.match[1]);
  if (task) {
    task.status = "deleted";
    await task.save();
    // Refund remaining (undone) portion to the owner's donated balance.
    const remaining = Math.max(task.goalCount - task.completedCount, 0);
    const refund = remaining * task.pricePerAction;
    if (refund > 0) {
      const owner = await User.findOne({ telegramId: task.ownerTelegramId });
      if (owner) {
        owner.donatedBalance += refund;
        await owner.save();
        await Transaction.create({
          telegramId: owner.telegramId,
          type: "refund",
          amount: refund,
          relatedTaskId: task._id,
          note: "Task deleted — unused balance refunded",
        });
      }
    }
  }
  await ctx.answerCbQuery("Task deleted");
  await ctx.editMessageText(
    "🗑 Task deleted. Note: users who already completed it keep their reward, " +
      "and it will NOT be re-awarded if you recreate the task with the same users."
  );
});

// ---------- earn flow ----------

bot.action(/earn_(sub|views|bot)/, async (ctx) => {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  const typeMap = { sub: ["channel", "group"], views: ["views"], bot: ["bot"] };
  const types = typeMap[ctx.match[1]];

  const task = await Task.findOne({
    type: { $in: types },
    status: "active",
    ownerTelegramId: { $ne: user.telegramId },
    completedBy: { $ne: user.telegramId },
    $expr: { $lt: ["$completedCount", "$goalCount"] },
  }).sort({ pricePerAction: -1 });

  if (!task) {
    await ctx.answerCbQuery();
    await ctx.editMessageText("No available tasks right now. Check back later!", earnTypeMenu());
    return;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText(
    `${TYPE_LABELS[task.type]}\n` +
      `${task.targetChatTitle || task.targetChatUsername || task.targetChatId}\n\n` +
      `💰 Reward: ${task.pricePerAction} coins\n\n` +
      `1. Open and join/subscribe.\n2. Come back and tap Check.`,
    earnActionMenu(task._id.toString())
  );
});

bot.action(/verify_(.+)/, async (ctx) => {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  const task = await Task.findById(ctx.match[1]);

  if (!task || task.status !== "active") {
    await ctx.answerCbQuery("This task is no longer available.");
    return;
  }
  if (task.completedBy.includes(user.telegramId)) {
    await ctx.answerCbQuery("You already completed this task.");
    return;
  }

  const isMember =
    task.type === "views" || task.type === "bot"
      ? true // views/bot completion can't be verified via getChatMember; trust + admin review
      : await isUserMemberOf(task.targetChatId, user.telegramId);

  if (!isMember) {
    await ctx.answerCbQuery("❌ Not detected yet. Make sure you joined, then try again.", {
      show_alert: true,
    });
    return;
  }

  task.completedCount += 1;
  task.completedBy.push(user.telegramId);
  if (task.completedCount >= task.goalCount) task.status = "completed";
  await task.save();

  await creditEarned(user, task.pricePerAction, "Completed promotion task", task._id);

  await ctx.answerCbQuery("✅ Verified! Coins added.", { show_alert: true });
  await ctx.editMessageText(`✅ Success! +${task.pricePerAction} coins credited.`);
});

// ---------- persistent reply-keyboard buttons ----------

bot.hears("📢 Promote", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await clearSession(user);
  await tryDeleteUserMessage(ctx);
  const total = user.donatedBalance + user.earnedBalance;
  await sendClean(
    ctx,
    user,
    `📢 What do you want to promote?\n\n💰 Balance: ${total.toLocaleString()} GRAM`,
    promoteTypeMenu()
  );
});

bot.hears("💰 Earnings", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await sendClean(ctx, user, "💰 Choose a category to earn coins:", earnTypeMenu());
});

bot.hears("👤 My Cabinet", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await sendClean(ctx, user, "🗂 My Cabinet", cabinetMenu());
});

bot.hears("✅ Subscription Check", async (ctx) => {
  // Shortcut: jump straight into the "subscribe" earn flow so the user can
  // recheck / grab the next available task without navigating the menu.
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);

  const task = await Task.findOne({
    type: { $in: ["channel", "group"] },
    status: "active",
    ownerTelegramId: { $ne: user.telegramId },
    completedBy: { $ne: user.telegramId },
    $expr: { $lt: ["$completedCount", "$goalCount"] },
  }).sort({ pricePerAction: -1 });

  if (!task) {
    await sendClean(ctx, user, "No available subscription tasks right now. Check back later!");
    return;
  }

  await sendClean(
    ctx,
    user,
    `${TYPE_LABELS[task.type]}\n` +
      `${task.targetChatTitle || task.targetChatUsername || task.targetChatId}\n\n` +
      `💰 Reward: ${task.pricePerAction} coins\n\n` +
      `1. Open and join/subscribe.\n2. Come back and tap Check.`,
    earnActionMenu(task._id.toString())
  );
});

bot.hears("📤 Checks", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  const total = user.donatedBalance + user.earnedBalance;
  // NOTE: this is informational only — no automatic payout is wired up yet.
  // To turn this into a real withdrawal system you'd add a WithdrawalRequest
  // model, let the user submit a payment method/amount here, and review
  // requests from the admin dashboard before paying out and deducting coins.
  await sendClean(
    ctx,
    user,
    `📤 Withdrawal / Checks\n\n` +
      `💳 Your current balance: ${total} coins\n\n` +
      `Withdrawal requests aren't automated yet in this build. ` +
      `Contact the admin directly to cash out, or extend the bot with a ` +
      `withdrawal-request feature if you want this self-service.`
  );
});

bot.hears("📊 Our Bots and Statistics", async (ctx) => {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  const [userCount, activeTasks, completedTasks] = await Promise.all([
    User.countDocuments({}),
    Task.countDocuments({ status: "active" }),
    Task.countDocuments({ status: "completed" }),
  ]);
  await sendClean(
    ctx,
    user,
    `📊 Bot Statistics\n\n` +
      `👥 Total users: ${userCount}\n` +
      `🟢 Active tasks: ${activeTasks}\n` +
      `✅ Completed tasks: ${completedTasks}`
  );
});

bot.hears("🔗 Useful Links", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  // Customize these with your own channel/support/group links.
  await sendClean(
    ctx,
    user,
    `🔗 Useful Links\n\n` +
      `📢 Updates channel: https://t.me/your_channel\n` +
      `💬 Support: https://t.me/your_support_username\n` +
      `👥 Community group: https://t.me/your_group`
  );
});

bot.hears("ℹ️ Instruction", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await sendClean(
    ctx,
    user,
    `ℹ️ How this bot works\n\n` +
      `📢 Promote — spend coins to get real subscribers/views for your channel, group, or bot.\n` +
      `💰 Earnings — join other people's channels/groups to earn coins.\n` +
      `👤 My Cabinet — manage the tasks you created (pause/resume/delete).\n` +
      `✅ Subscription Check — quickly grab and verify the next available task.\n` +
      `📤 Checks — see your balance and request a withdrawal.\n\n` +
      `💡 Tip: price your task competitively (check 💰 Earnings to see going rates) so it gets completed faster.`
  );
});

// ---------- text input (price / count / chat) ----------

bot.on("text", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const state = user.sessionState;
  const text = ctx.message.text.trim();

  if (state === "awaiting_price") {
    const price = Number(text);
    if (!Number.isFinite(price) || price <= 0) {
      await ctx.reply("Please send a valid positive number for the price.");
      return;
    }
    await setSession(user, "awaiting_count", { ...user.sessionData, price });
    await ctx.reply(
      "Choose how many subscribers/views/completions you want:",
      subscriberCountMenu()
    );
    return;
  }

  if (state === "awaiting_custom_count") {
    const count = parseInt(text, 10);
    if (!Number.isFinite(count) || count <= 0) {
      await ctx.reply("Please send a valid positive whole number.");
      return;
    }
    await finalizeCount(ctx, user, count);
    return;
  }

  if (state === "awaiting_chat") {
    await handleChatInput(ctx, user, ctx.message);
    return;
  }

  // No active flow — show main menu as a fallback.
  await ctx.reply("Use the menu below 👇", mainMenu());
});

bot.action("count_custom", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await setSession(user, "awaiting_custom_count", user.sessionData);
  await ctx.answerCbQuery();
  await ctx.editMessageText("✏️ Send the exact number you want:");
});

bot.action(/count_(\d+)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await finalizeCount(ctx, user, Number(ctx.match[1]));
});

async function finalizeCount(ctx, user, count) {
  const { type, price, targetChatId, targetChatTitle, targetChatUsername } = user.sessionData;
  const totalCost = price * count;
  const available = user.donatedBalance + user.earnedBalance;

  if (available < totalCost) {
    await clearSession(user);
    await ctx.reply(
      `❌ Insufficient balance. This task needs up to ${totalCost} coins ` +
        `(plus commission if paid from earned coins). Your balance: ${available}.`,
      mainMenu()
    );
    return;
  }

  // Chat was already picked from a "🏠 I'm an admin" / "👁 I'm not an
  // admin" list earlier — skip the forward/@username step entirely.
  if (targetChatId) {
    await createTask(ctx, user, {
      type,
      price,
      count,
      chatId: targetChatId,
      chatTitle: targetChatTitle,
      chatUsername: targetChatUsername,
    });
    return;
  }

  await setSession(user, "awaiting_chat", { type, price, count });
  await ctx.reply(
    "📌 Now add me as an admin to the chat you want to promote, then:\n" +
      "• Forward any message from that channel/group here, OR\n" +
      "• Send its @username\n\n" +
      "🏠 If it's your own chat, I can request admin rights automatically once you forward a message from it.\n" +
      "🌐 If it's not your chat, grant me admin rights manually first."
  );
}

async function handleChatInput(ctx, user, message) {
  let chatId = null;
  let chatUsername = null;

  if (message.forward_from_chat) {
    chatId = message.forward_from_chat.id;
    chatUsername = message.forward_from_chat.username;
  } else if (message.text && message.text.startsWith("@")) {
    chatUsername = message.text;
    chatId = message.text; // Telegram API accepts @username as chat id for public chats
  } else {
    await ctx.reply("Please forward a message from the chat, or send its @username.");
    return;
  }

  let chatInfo;
  try {
    chatInfo = await bot.telegram.getChat(chatId);
  } catch (e) {
    await ctx.reply("Couldn't read that chat. Please try again.");
    return;
  }

  const { type, price, count } = user.sessionData;
  await createTask(ctx, user, {
    type,
    price,
    count,
    chatId: String(chatId),
    chatTitle: chatInfo.title,
    chatUsername: chatInfo.username,
  });
}

// Shared task-creation step used both when the chat came from a
// "🏠 I'm an admin" / "👁 I'm not an admin" picker list and when it came
// from a forwarded message / @username. Always re-checks that the bot is
// currently an admin there (a picker entry can go stale — admin rights can
// be revoked any time after the chat was first tracked).
async function createTask(ctx, user, { type, price, count, chatId, chatTitle, chatUsername }) {
  const adminOk = await isBotAdminIn(chatId);
  if (!adminOk) {
    await ctx.reply(
      "⚠️ I'm not an admin there (anymore). Please add me as an administrator " +
        "(with 'invite users via link' permission) and try again."
    );
    await clearSession(user);
    return;
  }

  await dbConnect();
  const spend = await spendForTask(user, price * count);
  if (!spend.ok) {
    await ctx.reply(`❌ Insufficient balance. Needed: ${spend.needed} coins.`);
    return;
  }

  const task = await Task.create({
    ownerTelegramId: user.telegramId,
    type,
    targetChatId: String(chatId),
    targetChatTitle: chatTitle,
    targetChatUsername: chatUsername,
    pricePerAction: price,
    goalCount: count,
  });

  await clearSession(user);
  await ctx.reply(
    `✅ Task created!\n\n` +
      `${TYPE_LABELS[type]} — ${chatTitle || chatUsername}\n` +
      `Price: ${price} coins × ${count} = ${price * count} coins` +
      (spend.commission ? ` (+${spend.commission} commission)` : "") +
      `\n\nTrack it under 🗂 My Cabinet → My Tasks.`,
    mainMenu()
  );
}

export default bot;

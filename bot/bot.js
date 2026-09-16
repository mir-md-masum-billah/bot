import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { dbConnect } from "../lib/db.js";
import User from "../models/User.js";
import Task from "../models/Task.js";
import Transaction from "../models/Transaction.js";
import {
  mainMenu,
  replyMainMenu,
  earnTypeMenu,
  subscriberCountMenu,
  cabinetMenu,
  myTasksMenu,
  taskDetailMenu,
  taskDeleteConfirmMenu,
  languagePickMenu,
  backToCabinetMenu,
  backToTaskMenu,
  TASK_STATUS_ICON,
  promoteTypeReplyMenu,
  adminStatusReplyMenu,
  linkTypeMenu,
  audienceMainMenu,
  audienceTierMenu,
  languageMenu,
  LANGUAGES,
  countMenu,
  priceInputMenu,
  paymentMethodMenu,
  joinRequestConfirmMenu,
  publishConfirmMenu,
  earnTaskListMenu,
  humanVerifyMenu,
  postForwardMenu,
  addBotToChannelMenu,
  afterViewMenu,
  reportReasonMenu,
} from "./keyboards.js";
import { nextCounterValue } from "../models/Counter.js";

const COMMISSION_PERCENT = Number(process.env.EARNED_COMMISSION_PERCENT || 10);
// No official published GRAM<->Stars rate exists for this kind of bot —
// this is a configurable approximation, not a real exchange rate. Adjust
// via env var to whatever rate you actually want to offer.
const GRAM_PER_STAR = Number(process.env.GRAM_PER_STAR || 2000);
const STARS_DISCOUNT_PERCENT = 15;

// Minimum/recommended price-per-completion, in GRAM coins. Selecting a
// narrower audience (Premium-only, or one/more languages) raises the
// minimum, matching the "audience filter adds +100 GRAM" messaging.
const BASE_MIN_PRICE = 750;
const PREMIUM_MIN_PRICE = 1400;
const LANGUAGE_FILTER_SURCHARGE = 100;
const RECOMMENDED_SURCHARGE = 150;

function computeMinPrice(audienceMode, languages) {
  let min = audienceMode === "premium_only" ? PREMIUM_MIN_PRICE : BASE_MIN_PRICE;
  if (languages && languages.length > 0) min += LANGUAGE_FILTER_SURCHARGE;
  return min;
}

// ---------- level system ----------
// XP is only ever awarded by creditEarned (one completed task = XP_PER_TASK),
// and the level is derived from the total at display time, so thresholds can
// be retuned here without touching any stored data.
const XP_PER_TASK = 10;
const LEVELS = [
  { name: "Novice", icon: "🐣", upTo: 500 },
  { name: "Worker", icon: "🐤", upTo: 2000 },
  { name: "Expert", icon: "🦅", upTo: 10000 },
  { name: "Master", icon: "🐉", upTo: Infinity },
];

function levelFor(xp = 0) {
  let floor = 0;
  for (const lvl of LEVELS) {
    if (xp < lvl.upTo) {
      return {
        ...lvl,
        into: xp - floor,
        span: lvl.upTo === Infinity ? null : lvl.upTo - floor,
      };
    }
    floor = lvl.upTo;
  }
  const last = LEVELS[LEVELS.length - 1];
  return { ...last, into: xp, span: null };
}

function levelLabel(user) {
  const l = levelFor(user.xp || 0);
  return l.span ? `${l.icon}${l.name} ${l.into}/${l.span} XP` : `${l.icon}${l.name} ${l.into} XP`;
}

function gramToStars(totalGram) {
  return Math.max(1, Math.ceil((totalGram * (100 - STARS_DISCOUNT_PERCENT)) / 100 / GRAM_PER_STAR));
}

// Turn the "delete old menu / delete user's message" behavior on or off in
// one place. Set back to true to re-enable auto-delete later.
const AUTO_DELETE_MESSAGES = false;

// A single Telegraf instance is reused across warm serverless invocations.
//
// handlerTimeout: Telegraf's default is 90s, but a Vercel function is capped
// at 60s (and defaults to 10s), so the default guard can never fire before
// the platform kills the invocation. 25s keeps the error inside our own logs.
//
// webhookReply: false — with webhook replies on, Telegraf answers the first
// Telegram API call by writing it into the HTTP response body. On Vercel the
// function is frozen the instant the response ends, so anything still awaited
// after that (DB writes, follow-up sendMessage) is suspended mid-update and
// only resumes if/when the container thaws. Every API call goes out as its
// own request instead.
export const bot = new Telegraf(process.env.BOT_TOKEN, {
  handlerTimeout: 25_000,
  telegram: { webhookReply: false },
});

// Without this, an error thrown anywhere in a handler (a bad DB write, a
// Telegram API call failing, etc.) is only logged by Telegraf's default
// handler as "Unhandled error while processing <update>" with the actual
// error message easy to lose in serverless logs, AND the tapped button is
// left with no response at all (Telegram just clears the loading spinner
// after its own timeout, so it looks like "the button doesn't work"). This
// logs the real error clearly and — for button taps — answers the callback
// so the person sees a message instead of silence.
bot.catch((err, ctx) => {
  console.error(`Bot error for update ${ctx.update?.update_id}:`, err);
  if (ctx.callbackQuery) {
    ctx.answerCbQuery("⚠️ Something went wrong, please try again.").catch(() => {});
  }
});

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

// Sends a task-owner alert unless they muted it — either for this one task
// (👤 detail screen → Disable notification) or globally (cabinet → Disable
// notifications). Never throws: a blocked bot must not break the caller.
async function notifyTaskOwner(task, text) {
  try {
    if (task.notifyOwner === false) return;
    const owner = await User.findOne({ telegramId: task.ownerTelegramId });
    if (owner && owner.notificationsEnabled === false) return;
    await bot.telegram.sendMessage(task.ownerTelegramId, text);
  } catch (e) {
    // Owner blocked the bot / chat not found — nothing to do.
  }
}

async function creditEarned(user, amount, note, relatedTaskId) {
  if (!Number.isFinite(amount)) {
    console.error(`creditEarned: refusing non-finite amount (${amount}) for user ${user.telegramId}, task ${relatedTaskId}`);
    return;
  }
  user.earnedBalance += amount;
  // Every paid completion also moves the level bar in 👤 My Cabinet.
  user.xp = (user.xp || 0) + XP_PER_TASK;
  await user.save();
  await Transaction.create({
    telegramId: user.telegramId,
    type: "earn_task",
    amount,
    relatedTaskId,
    note,
  });
}

// Claws back up to `amount` GRAM from a worker's earned balance (never goes
// below 0 even if they've already spent it elsewhere) and logs it. Returns
// how much was actually deducted, so the owner is only ever credited what
// was actually recovered.
async function clawbackEarned(user, amount, note, relatedTaskId) {
  if (!Number.isFinite(amount)) {
    console.error(`clawbackEarned: refusing non-finite amount (${amount}) for user ${user.telegramId}, task ${relatedTaskId}`);
    return 0;
  }
  const deducted = Math.min(user.earnedBalance, amount);
  user.earnedBalance -= deducted;
  await user.save();
  if (deducted > 0) {
    await Transaction.create({
      telegramId: user.telegramId,
      type: "admin_adjust",
      amount: -deducted,
      relatedTaskId,
      note,
    });
  }
  return deducted;
}

// Returns reclaimed GRAM to the task owner's donated balance (same pool
// used for task-deletion refunds), so it costs no commission to reuse.
async function creditOwnerReclaimed(ownerTelegramId, amount, relatedTaskId) {
  if (amount <= 0) return;
  const owner = await User.findOne({ telegramId: ownerTelegramId });
  if (!owner) return;
  owner.donatedBalance += amount;
  await owner.save();
  await Transaction.create({
    telegramId: owner.telegramId,
    type: "refund",
    amount,
    relatedTaskId,
    note: `Subscriber left before the ${MIN_STAY_DAYS}-day minimum — GRAM reclaimed`,
  });
}

// Spend: donated balance first, then earned balance (commission applies
// only to the portion paid from earned/non-donated coins).
async function spendForTask(user, totalCost) {
  if (!Number.isFinite(totalCost) || totalCost <= 0) {
    console.error(`spendForTask: refusing non-finite/invalid totalCost (${totalCost}) for user ${user.telegramId}`);
    return { ok: false, needed: 0, invalid: true };
  }
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

// Every inline-button tap updates the message it came from in place —
// editMessageText — instead of deleting it and sending a new one. This
// keeps the same message id/scroll position throughout a whole cabinet/task
// navigation, so nothing "jumps" or gets deleted-and-recreated on screen.
//
// Pass { forceNew: true } for the one flow where an edit would be wrong: a
// viewed post is forwarded as its own message *between* the old menu and
// the new one, so editing the old menu in place would leave it stranded
// above that post instead of under it. That single call site sends a fresh
// message on purpose; everywhere else always edits.
async function sendOrReplace(ctx, text, extra, { forceNew = false } = {}) {
  if (!forceNew && ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (e) {
      const desc = e?.description || e?.message || "";
      // Content identical to what's already shown — nothing to do.
      if (/message is not modified/i.test(desc)) return;
      // Anything else (message too old, already deleted, wasn't a text
      // message) — fall through to a fresh send so the user still gets
      // a working menu instead of silence.
    }
  }
  if (ctx.callbackQuery?.message) await ctx.deleteMessage().catch(() => {});
  return ctx.reply(text, extra);
}

// Largest number of completions the user can actually pay for, commission
// included. Commission only applies to the part paid from earned coins
// (see spendForTask), so this walks down from the naive ceiling until the
// real cost fits — at most a couple of iterations.
function maxAffordable(user, price) {
  const available = user.donatedBalance + user.earnedBalance;
  if (!Number.isFinite(price) || price <= 0) return 1;
  let n = Math.floor(available / price);
  while (n > 1) {
    const gross = price * n;
    const fromEarned = Math.max(0, gross - user.donatedBalance);
    const commission = Math.ceil((fromEarned * COMMISSION_PERCENT) / 100);
    if (gross + commission <= available) break;
    n -= 1;
  }
  return Math.max(1, n);
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

// Admin rights requested by the "➕ Add bot to channel" deep link. The bot
// only really needs to be an admin at all (so it can read + forward the
// post), but Telegram shows this exact list in its confirmation dialog.
const POST_ADMIN_RIGHTS = "post_messages+edit_messages+delete_messages+invite_users";

// Built from getMe() rather than an env var so it can never point at the
// wrong bot if BOT_USERNAME is stale or missing.
let cachedBotUsername = null;
async function addBotToChannelLink() {
  if (!cachedBotUsername) {
    cachedBotUsername = (await bot.telegram.getMe()).username;
  }
  return `https://t.me/${cachedBotUsername}?startchannel&admin=${POST_ADMIN_RIGHTS}`;
}

// Pulls (chat, message_id) out of a forwarded message. Bot API 7.0+ sends
// this as `forward_origin`; older payloads use the deprecated flat fields,
// so both are handled. Anything that isn't a channel post — a forward from
// a user, a hidden-account forward, or a plain copy-paste — returns null,
// because only channel posts carry a message_id the bot can forward later.
function extractForwardedPost(message) {
  const origin = message?.forward_origin;
  if (origin?.type === "channel" && origin.chat && origin.message_id) {
    return {
      chatId: origin.chat.id,
      messageId: origin.message_id,
      title: origin.chat.title,
      username: origin.chat.username,
    };
  }
  if (message?.forward_from_chat?.type === "channel" && message.forward_from_message_id) {
    return {
      chatId: message.forward_from_chat.id,
      messageId: message.forward_from_message_id,
      title: message.forward_from_chat.title,
      username: message.forward_from_chat.username,
    };
  }
  return null;
}

async function isUserMemberOf(chatId, userId) {
  try {
    const member = await bot.telegram.getChatMember(chatId, userId);
    return ["member", "administrator", "creator"].includes(member.status);
  } catch (e) {
    return false;
  }
}

// Always produces a working invite link for the earn-list "Subscribe"
// button, even for private chats with no @username. For join-request tasks
// this is the join-request link created at publish time (matches the
// "creates_join_request" flow); for everything else it's the chat's
// @username if public, or a fresh regular invite link if private.
async function resolveInviteLink(chatId, username, linkType) {
  if (linkType === "join_request") {
    try {
      const link = await bot.telegram.createChatInviteLink(chatId, {
        creates_join_request: true,
      });
      return link.invite_link;
    } catch (e) {
      return username ? `https://t.me/${username}` : null;
    }
  }
  if (username) return `https://t.me/${username}`;
  try {
    const link = await bot.telegram.createChatInviteLink(chatId);
    return link.invite_link;
  } catch (e) {
    return null;
  }
}

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
  // "?start=ref_<id>" from 👤 My Cabinet → Referral System. Only ever set
  // once, and never to the user's own id.
  const payload = ctx.startPayload || "";
  if (!user.referredBy && payload.startsWith("ref_")) {
    const inviter = Number(payload.slice(4));
    if (Number.isFinite(inviter) && inviter !== user.telegramId) {
      const exists = await User.exists({ telegramId: inviter });
      if (exists) {
        user.referredBy = inviter;
        await user.save();
      }
    }
  }
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
  await ctx.answerCbQuery();
  await showPromoteTypeMenu(ctx, user);
});

bot.action("menu_earn", async (ctx) => {
  await ctx.editMessageText("💰 Choose a category to earn coins:", earnTypeMenu());
});

bot.action("menu_cabinet", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await showCabinet(ctx, user);
});

// ---------- promote flow ----------
// Full task-creation wizard: type -> admin/chat picker -> link type ->
// audience -> price -> count -> payment method -> (join-request confirm) ->
// publish. Every step here is a persistent reply keyboard, matching the
// real app's style — see keyboards.js for the button layouts.

// Types that need a target channel/group picked via Telegram's native
// `request_chat` flow. "bot" targets another bot (not a chat), so it keeps
// the simpler legacy price->count->@username flow further below instead.
// "views" is NOT here: a post task needs one specific message, and the chat
// picker only returns a chat id. It uses the forward-the-post flow instead
// (see startPostWizard / the forwarded-post middleware below).
const CHAT_PICKER_TYPES = ["channel", "group", "boost", "reactions"];

async function showPromoteTypeMenu(ctx, user) {
  await setSession(user, "promote_type_menu", {});
  await renderWizardStep(ctx, user, "promote_type_menu");
}

// Pushes the CURRENT state onto a small stack before moving to `newState`,
// so a later "⬅️ Back" tap can pop back to exactly where the user was.
async function goForward(user, newState, dataPatch = {}) {
  const backStack = [...(user.sessionData?.backStack || [])];
  if (user.sessionState) backStack.push(user.sessionState);
  await setSession(user, newState, { ...user.sessionData, ...dataPatch, backStack });
}

// Renders whichever wizard step `state` refers to, using data already on
// the user's session. Shared by forward transitions and by "⬅️ Back".
async function renderWizardStep(ctx, user, state) {
  const d = user.sessionData || {};
  switch (state) {
    case "promote_type_menu": {
      const total = user.donatedBalance + user.earnedBalance;
      await ctx.reply(
        `📢 What do you want to promote?\n\n💰 Balance: ${total.toLocaleString()} GRAM`,
        promoteTypeReplyMenu()
      );
      return;
    }
    case "choosing_admin_status":
      await ctx.reply(
        "📢 Choose a chat or channel to promote (the bot must be an admin)",
        adminStatusReplyMenu(d.type)
      );
      return;
    case "awaiting_post_forward":
      await ctx.reply(
        `📣 Forward the post you want to promote.\n\n` +
          `Open the channel → pick the post → Forward → this bot\n\n` +
          `⚠️ I must be an admin in that channel, otherwise I can't show the ` +
          `post to workers later.`,
        postForwardMenu()
      );
      return;
    case "choosing_link_type":
      await ctx.reply(
        `"${d.targetChatTitle || "Chat"}" added successfully.\n\n` +
          `Choose the link type:\n` +
          `🔗 Regular — members join instantly (tap "Skip").\n` +
          `✅ With join requests — you approve everyone who joins.`,
        linkTypeMenu()
      );
      return;
    case "choosing_audience_main":
      await ctx.reply(
        `🎯 Task audience\n` +
          `Current: ${
            d.audienceMode === "premium_only" ? "Telegram Premium only" : "no restrictions"
          }${d.languages?.length ? ` (${d.languages.join(", ")})` : ""}\n\n` +
          `Choose who can access the task:\n` +
          `💡 The audience filter adds +${LANGUAGE_FILTER_SURCHARGE} GRAM to the min. price per completion.`,
        audienceMainMenu()
      );
      return;
    case "choosing_audience_tier":
      await ctx.reply(
        `1️⃣ All users\n` +
          `Broad reach among all PR GRAM users.\n` +
          `💡 Minimum price: ${BASE_MIN_PRICE} GRAM/unit.\n\n` +
          `2️⃣ Telegram Premium only\n` +
          `Shown only to Telegram Premium users — a higher-quality audience.\n` +
          `💡 Minimum price: ${PREMIUM_MIN_PRICE} GRAM/unit.`,
        audienceTierMenu()
      );
      return;
    case "choosing_audience_languages":
      await ctx.reply(
        `🈚 Choose one or more languages\n` +
          `💡 The audience filter adds +${LANGUAGE_FILTER_SURCHARGE} GRAM to the min. price per completion.`,
        languageMenu(d.languages || [])
      );
      return;
    case "wizard_awaiting_price": {
      const min = computeMinPrice(d.audienceMode, d.languages);
      const unit = d.type === "views" ? "view" : "subscription";
      await ctx.reply(
        `💲 Set the price for 1 ${unit} — this is the worker's reward.\n\n` +
          `Minimum — ${min} GRAM\n` +
          `💡 Recommended — ${min + RECOMMENDED_SURCHARGE} GRAM\n` +
          `Completion speed depends on your price.`,
        priceInputMenu()
      );
      return;
    }
    case "wizard_choosing_count": {
      const total = user.donatedBalance + user.earnedBalance;
      const maxForBalance = maxAffordable(user, d.price);
      const unit = d.type === "views" ? "views" : "subscriptions";
      await ctx.reply(
        `ℹ️ Task creation commission — ${COMMISSION_PERCENT}%.\n\n` +
          `💵 ${d.type === "views" ? "View" : "Subscription"} price — ${d.price} GRAM\n` +
          `💰 Your balance — ${total.toLocaleString()} GRAM\n\n` +
          `📝 Enter the number of ${unit} or choose:`,
        countMenu(maxForBalance)
      );
      return;
    }
    case "wizard_awaiting_custom_count":
      await ctx.reply("✏️ Send the exact number of subscriptions you want:");
      return;
    case "wizard_choosing_payment": {
      const totalGram = d.price * d.count;
      await ctx.reply(
        "💳 Choose a payment method:",
        paymentMethodMenu(totalGram, gramToStars(totalGram))
      );
      return;
    }
    case "wizard_confirming_join_request":
      await ctx.reply(
        `🔗 Create a join-request link?\n\n` +
          `• Members join only after your approval.\n` +
          `• The worker is paid as soon as they submit a join request.`,
        joinRequestConfirmMenu()
      );
      return;
    case "wizard_confirming_publish":
      await ctx.reply(
        `✅ Everything is ready to publish.\nPress "Publish Task" to post it.`,
        publishConfirmMenu()
      );
      return;
    default:
      await showPromoteTypeMenu(ctx, user);
  }
}

async function startChatPickerWizard(ctx, type) {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "promote_type_menu") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "choosing_admin_status", { type });
  await renderWizardStep(ctx, user, "choosing_admin_status");
}

bot.hears("📢 Channel", (ctx) => startChatPickerWizard(ctx, "channel"));
bot.hears("👥 Group", (ctx) => startChatPickerWizard(ctx, "group"));
// A post task can't use the chat picker — Telegram's picker returns a chat,
// never a specific message — so the user forwards the actual post instead.
async function startPostWizard(ctx) {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "promote_type_menu") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "awaiting_post_forward", { type: "views" });
  await renderWizardStep(ctx, user, "awaiting_post_forward");
}

bot.hears("👁 Post", startPostWizard);

// Runs before the generic bot.on("text") handler further down, and only
// touches the DB when the incoming message actually is a forwarded channel
// post — every other update falls straight through to next().
bot.use(async (ctx, next) => {
  const post = ctx.message && extractForwardedPost(ctx.message);
  if (!post) return next();
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "awaiting_post_forward") return next();
  await handlePostForward(ctx, user, post);
});

async function handlePostForward(ctx, user, post) {
  // 1) Is the bot an admin in the channel this post came from? Without it,
  //    forwardMessage to workers fails later — so it's checked up front,
  //    before the user spends anything.
  if (!(await isBotAdminIn(post.chatId))) {
    await setSession(user, "awaiting_post_forward", {
      ...user.sessionData,
      pendingChatId: String(post.chatId),
      pendingMessageId: post.messageId,
      pendingTitle: post.title,
      pendingUsername: post.username,
    });
    await ctx.reply(
      `⛔️ The bot lacks admin rights in "${post.title || "that channel"}".\n` +
        `Add the bot to the channel and try again.`,
      addBotToChannelMenu(await addBotToChannelLink())
    );
    return;
  }

  // 2) Admin rights alone aren't enough: a channel with "Restrict saving
  //    content" on blocks forwarding entirely. Prove it works now by
  //    forwarding the post to the owner and deleting it again, rather than
  //    letting every worker hit the error after the task is paid for.
  try {
    const probe = await bot.telegram.forwardMessage(ctx.chat.id, post.chatId, post.messageId, {
      disable_notification: true,
    });
    await bot.telegram.deleteMessage(ctx.chat.id, probe.message_id).catch(() => {});
  } catch (e) {
    await ctx.reply(
      `⛔️ I can't forward that post.\n\n` +
        `Turn off "Restrict saving content" in the channel settings (or check ` +
        `that the post still exists) and forward it again.`
    );
    return;
  }

  await goForward(user, "choosing_audience_main", {
    targetChatId: String(post.chatId),
    targetChatTitle: post.title,
    targetChatUsername: post.username,
    targetMessageId: post.messageId,
    linkType: "regular",
  });
  await renderWizardStep(ctx, user, "choosing_audience_main");
}

// "🔄 Check again" after the user has (hopefully) granted admin rights.
bot.action("postadmin_recheck", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const d = user.sessionData || {};
  if (!d.pendingChatId) {
    await ctx.answerCbQuery("Please forward the post again.", { show_alert: true });
    return;
  }
  if (!(await isBotAdminIn(d.pendingChatId))) {
    await ctx.answerCbQuery("Still not an admin there — grant the rights and retry.", {
      show_alert: true,
    });
    return;
  }
  await ctx.answerCbQuery("✅ Admin rights OK");
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await handlePostForward(ctx, user, {
    chatId: d.pendingChatId,
    messageId: d.pendingMessageId,
    title: d.pendingTitle,
    username: d.pendingUsername,
  });
});
bot.hears("⚡️ Premium boost (channel)", (ctx) => startChatPickerWizard(ctx, "boost"));
bot.hears("❤️ Reactions", (ctx) => startChatPickerWizard(ctx, "reactions"));

// "Bot" promotion targets another bot, not a chat, so `request_chat` doesn't
// apply — it keeps the simpler legacy price → count → @username flow that
// already existed (see the "awaiting_price"/"awaiting_chat" branches below).
bot.hears("🤖 Bot", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "promote_type_menu") return;
  await tryDeleteUserMessage(ctx);
  await setSession(user, "awaiting_price", { type: "bot" });
  await ctx.reply(
    `${TYPE_LABELS.bot} selected.\n\n` +
      `💡 Send the price (in coins) you want to pay per completion.\n` +
      `Tip: check the "Earn" section for current prices — higher prices get completed faster.`
  );
});

// `request_chat` buttons don't send their label as text when tapped — they
// open Telegram's native chat picker directly. Once the user picks (or
// creates) a chat there, Telegram both grants the bot the requested admin
// rights in it AND sends this "chat_shared" service message with its id.
// There is no Bot API call that lists a user's channels/groups itself, so
// this native picker — requesting exactly the admin right the bot needs
// (`can_invite_users`, used by isBotAdminIn/getChatMember) — is the only
// way to offer a "pick from your channels" experience. Both admin-status
// buttons use this same mechanism, since either way this is how the bot
// actually learns which chat was chosen.
bot.on(message("chat_shared"), async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_admin_status") return;
  const chatId = ctx.message.chat_shared.chat_id;

  let chatInfo;
  try {
    chatInfo = await bot.telegram.getChat(chatId);
  } catch (e) {
    await ctx.reply("Couldn't read that chat yet — please try adding it again.");
    return;
  }

  const adminOk = await isBotAdminIn(chatId);
  if (!adminOk) {
    await ctx.reply(
      "⚠️ I'm still not an admin there. Please try again and make sure to grant the requested permission."
    );
    return;
  }

  await goForward(user, "choosing_link_type", {
    targetChatId: String(chatId),
    targetChatTitle: chatInfo.title,
    targetChatUsername: chatInfo.username,
  });
  await renderWizardStep(ctx, user, "choosing_link_type");
});

bot.hears("➡️ Skip", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_link_type") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "choosing_audience_main", { linkType: "regular" });
  await renderWizardStep(ctx, user, "choosing_audience_main");
});

bot.hears("➕ Join-request link", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_link_type") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "choosing_audience_main", { linkType: "join_request" });
  await renderWizardStep(ctx, user, "choosing_audience_main");
});

bot.hears("🌐 Allow all", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_audience_main") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "wizard_awaiting_price", { audienceMode: "all", languages: [] });
  await renderWizardStep(ctx, user, "wizard_awaiting_price");
});

bot.hears("🎯 Select audience", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_audience_main") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "choosing_audience_tier", {});
  await renderWizardStep(ctx, user, "choosing_audience_tier");
});

bot.hears("1️⃣ All users", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_audience_tier") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "choosing_audience_languages", { audienceMode: "all" });
  await renderWizardStep(ctx, user, "choosing_audience_languages");
});

bot.hears("2️⃣ Telegram Premium only", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "choosing_audience_tier") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "choosing_audience_languages", { audienceMode: "premium_only" });
  await renderWizardStep(ctx, user, "choosing_audience_languages");
});

// Language multi-select and the count/payment amount buttons all carry
// dynamic numbers/labels in their text, so they're matched inside the
// generic bot.on("text") handler below rather than via bot.hears(), which
// only matches fixed strings.

bot.hears("✅ Yes, confirm", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "wizard_confirming_join_request") return;
  await tryDeleteUserMessage(ctx);
  await goForward(user, "wizard_confirming_publish", {});
  await renderWizardStep(ctx, user, "wizard_confirming_publish");
});

bot.hears("✅ Publish Task", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "wizard_confirming_publish") return;
  await tryDeleteUserMessage(ctx);
  await publishWizardTask(ctx, user);
});

// Moves from count -> payment method, after checking the balance can cover
// at least this many completions at the chosen price.
async function proceedToPayment(ctx, user, count) {
  const totalGram = user.sessionData.price * count;
  const available = user.donatedBalance + user.earnedBalance;
  if (!Number.isFinite(totalGram)) {
    await clearSession(user);
    await ctx.reply("⚠️ Something went wrong with your task details. Please start over.", mainMenu());
    return;
  }
  const affordable = maxAffordable(user, user.sessionData.price);
  if (available < totalGram || count > affordable) {
    await ctx.reply(
      `❌ Insufficient balance for that many (commission included). ` +
        `Max you can afford: ${affordable}.`
    );
    return;
  }
  await goForward(user, "wizard_choosing_payment", { count });
  await renderWizardStep(ctx, user, "wizard_choosing_payment");
}

async function proceedAfterPaymentChoice(ctx, user, method) {
  const nextState =
    user.sessionData.linkType === "join_request"
      ? "wizard_confirming_join_request"
      : "wizard_confirming_publish";
  await goForward(user, nextState, { paymentMethod: method });
  await renderWizardStep(ctx, user, nextState);
}

// Creates the join-request invite link (if requested), deducts GRAM, and
// creates the Task document. For Stars payment this is called from the
// successful_payment handler instead, once Telegram confirms the charge.
async function createWizardTask(ctx, user, paymentMethod) {
  const d = user.sessionData;
  const totalGram = d.price * d.count;

  // A post task lives or dies on the bot still being an admin in the source
  // channel — the owner could have removed it between forwarding the post
  // and tapping Publish, so it's verified one last time before any GRAM
  // changes hands. There's also no invite link to resolve for this type.
  let inviteLink = null;
  if (d.type === "views") {
    if (!(await isBotAdminIn(d.targetChatId))) {
      await ctx.reply(
        `⛔️ The bot lacks admin rights in "${d.targetChatTitle || "that channel"}" anymore, ` +
          `so the task can't be published.`,
        addBotToChannelMenu(await addBotToChannelLink())
      );
      return;
    }
  } else {
    inviteLink = await resolveInviteLink(d.targetChatId, d.targetChatUsername, d.linkType);
  }

  let commission = 0;
  if (paymentMethod === "gram") {
    const spend = await spendForTask(user, totalGram);
    if (!spend.ok) {
      if (spend.invalid) {
        await clearSession(user);
        await ctx.reply("⚠️ Something went wrong with your task details. Please start over.", mainMenu());
      } else {
        await ctx.reply(`❌ Insufficient balance. Needed: ${spend.needed} GRAM.`);
      }
      return;
    }
    commission = spend.commission;
  }

  await Task.create({
    ownerTelegramId: user.telegramId,
    taskNumber: await nextCounterValue("tasks", 1888000),
    type: d.type,
    targetChatId: d.targetChatId,
    targetChatTitle: d.targetChatTitle,
    targetChatUsername: d.targetChatUsername,
    targetInviteLink: inviteLink,
    targetMessageId: d.targetMessageId,
    linkType: d.linkType,
    audienceMode: d.audienceMode,
    languages: d.languages || [],
    paymentMethod,
    pricePerAction: d.price,
    goalCount: d.count,
  });

  await clearSession(user);
  await ctx.reply(
    `✅ Task published!\n\n` +
      `${TYPE_LABELS[d.type]} — ${d.targetChatTitle}\n` +
      `Price: ${d.price} GRAM × ${d.count} = ${totalGram} GRAM` +
      (commission ? ` (+${commission} commission)` : "") +
      (inviteLink ? `\n🔗 Link: ${inviteLink}` : "") +
      `\n\nTrack it under 👤 My Cabinet → My Tasks.`,
    replyMainMenu()
  );
}

async function publishWizardTask(ctx, user) {
  const d = user.sessionData;

  if (d.paymentMethod === "stars") {
    const totalGram = d.price * d.count;
    const starsCost = gramToStars(totalGram);
    try {
      await ctx.replyWithInvoice({
        title: `${TYPE_LABELS[d.type]} promotion task`,
        description: `${d.count} completions at ${d.price} GRAM each for "${d.targetChatTitle}"`,
        payload: "promote_task",
        provider_token: "", // empty provider_token = pay with Telegram Stars
        currency: "XTR",
        prices: [{ label: "Task cost", amount: starsCost }],
      });
    } catch (e) {
      await ctx.reply(
        "Couldn't create the Stars invoice. Please try again, or go back and pay with GRAM instead."
      );
    }
    return; // the task itself is created once successful_payment comes in
  }

  await createWizardTask(ctx, user, "gram");
}

// Telegram requires the bot to answer every pre_checkout_query within 10s.
bot.on("pre_checkout_query", async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// Fires once a Telegram Stars payment actually completes. The task's
// details are still sitting in the user's session (we never cleared it
// while waiting for payment), so it's built from there.
bot.on(message("successful_payment"), async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user.sessionData?.type || !user.sessionData?.targetChatId) {
    await ctx.reply(
      "✅ Payment received, but I couldn't find the pending task details — please contact support."
    );
    return;
  }
  await createWizardTask(ctx, user, "stars");
});

bot.hears("⚙️ Auto-task settings", async (ctx) => {
  // Placeholder: auto-task settings (automatically recreate a task with the
  // same parameters once it completes) isn't wired up to real logic yet.
  // A full version would add fields like `autoRepeat`/`autoRepeatCount` on
  // the Task model and a scheduled job (e.g. a Vercel Cron route) that
  // recreates completed tasks for users who enabled this.
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "promote_type_menu") return;
  await tryDeleteUserMessage(ctx);
  await ctx.reply(
    "⚙️ Auto-task settings\n\n" +
      "This feature (automatically recreating a task once it completes) isn't " +
      "built yet in this version — let me know if you want it added."
  );
});

// Single generic "⬅️ Back" for the whole wizard: pops the tracked back
// stack and re-renders whatever step that was. With nothing tracked (top of
// the wizard, or not in it at all), it returns to the persistent main menu.
bot.hears("⬅️ Back", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  const stack = [...(user.sessionData?.backStack || [])];
  if (!stack.length) {
    await clearSession(user);
    await ctx.reply("🏠 Main Menu", replyMainMenu());
    return;
  }
  const prevState = stack.pop();
  await setSession(user, prevState, { ...user.sessionData, backStack: stack });
  await renderWizardStep(ctx, user, prevState);
});

// ---------- 👤 My Cabinet ----------

// The cabinet header — id, level bar and balance — exactly the three lines
// the real app shows above the cabinet buttons.
function cabinetText(user) {
  const total = user.donatedBalance + user.earnedBalance;
  return (
    `👤 Your Cabinet:\n\n` +
    `🆔 My ID: ${user.telegramId}\n` +
    `📈 Level: ${levelLabel(user)}\n` +
    `💲 Balance: ${total.toLocaleString()} GRAM`
  );
}

async function showCabinet(ctx, user) {
  await sendOrReplace(ctx, cabinetText(user), cabinetMenu(user));
}

bot.action("cab_replenish", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    `💳 Replenish Balance\n\n` +
      `Top-ups are handled with Telegram Stars during task creation: pick ` +
      `⭐ Stars at the payment step and the task is paid for directly.\n\n` +
      `A standalone "buy GRAM" purchase isn't wired up in this build — ` +
      `contact the admin to credit your balance manually.`,
    backToCabinetMenu()
  );
});

bot.action("cab_referral", async (ctx) => {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  if (!cachedBotUsername) cachedBotUsername = (await bot.telegram.getMe()).username;
  const invited = await User.countDocuments({ referredBy: user.telegramId });
  await sendOrReplace(
    ctx,
    `👥 Referral System\n\n` +
      `🔗 Your link:\nhttps://t.me/${cachedBotUsername}?start=ref_${user.telegramId}\n\n` +
      `👤 Invited: ${invited}\n\n` +
      `Share the link — anyone who starts the bot through it is permanently ` +
      `tied to your account.`,
    backToCabinetMenu()
  );
});

bot.action("cab_levels", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  const lines = LEVELS.map((l, i) => {
    const from = i === 0 ? 0 : LEVELS[i - 1].upTo;
    const range = l.upTo === Infinity ? `${from}+ XP` : `${from}–${l.upTo} XP`;
    return `${l.icon} ${l.name} — ${range}`;
  }).join("\n");
  await sendOrReplace(
    ctx,
    `📈 Level System\n\n` +
      `You earn ${XP_PER_TASK} XP for every task you complete.\n\n` +
      `${lines}\n\n` +
      `Your level: ${levelLabel(user)}`,
    backToCabinetMenu()
  );
});

bot.action("cab_language", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  const current = LANGUAGES.find((l) => l.code === user.language);
  await sendOrReplace(
    ctx,
    `🌐 Change Language\n\nCurrent: ${current ? current.label : user.language}`,
    languagePickMenu("cablang_", [], "menu_cabinet", false)
  );
});

bot.action(/cablang_(.+)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const code = ctx.match[1];
  const lang = LANGUAGES.find((l) => l.code === code);
  user.language = code;
  await user.save();
  await ctx.answerCbQuery(lang ? `Language: ${lang.label}` : "Saved");
  // NOTE: this only records the preference. Bot texts are English-only in
  // this build — translate them with this field to make it take effect.
  await showCabinet(ctx, user);
});

bot.action(/cab_notif_(on|off)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  user.notificationsEnabled = ctx.match[1] === "on";
  await user.save();
  await ctx.answerCbQuery(user.notificationsEnabled ? "🔔 Notifications on" : "🔕 Notifications off");
  await showCabinet(ctx, user);
});

// ---------- 📋 My Tasks ----------

const TASK_FILTERS = {
  active: { label: "In progress", status: "active" },
  completed: { label: "Finished", status: "completed" },
  paused: { label: "Paused", status: "paused" },
};

async function showMyTasks(ctx, user, filter = "active") {
  await dbConnect();
  const tasks = await Task.find({
    ownerTelegramId: user.telegramId,
    status: TASK_FILTERS[filter]?.status || "active",
  })
    .sort({ createdAt: -1 })
    .limit(20);

  const header = `📋 Manage your tasks — ${TASK_FILTERS[filter]?.label || "In progress"}`;
  const body = tasks.length
    ? `${header}\n\nTap a task to open it.`
    : `${header}\n\nNothing here yet.`;

  await sendOrReplace(ctx, body, myTasksMenu(tasks, filter));
}

bot.hears("📋 My Tasks", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (user.sessionState !== "promote_type_menu") return;
  await tryDeleteUserMessage(ctx);
  await showMyTasks(ctx, user);
});

bot.action("cabinet_tasks", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await showMyTasks(ctx, user);
});

bot.action(/tasklist_(active|completed|paused)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await showMyTasks(ctx, user, ctx.match[1]);
});

// Loads a task and refuses it unless the caller owns it — every task_*
// callback carries a task id that a user could otherwise guess at.
async function loadOwnedTask(ctx, taskId) {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  const task = await Task.findById(taskId).catch(() => null);
  if (!task || task.status === "deleted" || task.ownerTelegramId !== user.telegramId) {
    await ctx.answerCbQuery("Task not found.", { show_alert: true });
    return {};
  }
  return { user, task };
}

const UNIT_LABEL = {
  channel: "subscriptions",
  group: "subscriptions",
  views: "views",
  bot: "bot starts",
  boost: "boosts",
  reactions: "reactions",
};

function taskDetailText(task) {
  const statusText =
    task.status === "active" ? "In Progress" : task.status === "paused" ? "Paused" : "Finished";
  const remaining = Math.max(task.goalCount - task.completedCount, 0);
  const langs = task.languages?.length
    ? task.languages.map((c) => LANGUAGES.find((l) => l.code === c)?.label || c).join(", ")
    : "All users";

  return (
    `📋 Task #${(task.taskNumber || 0).toLocaleString()}\n` +
    `Status: ${TASK_STATUS_ICON[task.status] || "▶️"} ${statusText}\n` +
    `🔍 Task Details:\n` +
    `• ${task.goalCount} ${UNIT_LABEL[task.type] || "actions"}\n` +
    `• Reward: ${task.pricePerAction.toLocaleString()} GRAM/unit\n` +
    `• Completed: ${task.completedCount}/${task.goalCount}\n` +
    `• Remaining: ${remaining}\n` +
    `• Refunded for unsubscribes: ${task.refundedCount || 0}\n` +
    `🔗 ${TYPE_LABELS[task.type]}: ${task.targetChatTitle || task.targetChatId}\n\n` +
    `Access filters:\n` +
    `• Account type: ${task.audienceMode === "premium_only" ? "Telegram Premium only" : "All users"}\n` +
    `• Audience: ${langs}`
  );
}

async function showTaskDetail(ctx, task) {
  // Tasks created before the numbering existed get their number on first
  // open, so the header is never "Task #0".
  if (!task.taskNumber) {
    task.taskNumber = await nextCounterValue("tasks", 1888000);
    await task.save();
  }
  await sendOrReplace(ctx, taskDetailText(task), taskDetailMenu(task));
}

bot.action(/taskdet_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  await ctx.answerCbQuery();
  await showTaskDetail(ctx, task);
});

bot.action(/task_pause_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  task.status = "paused";
  await task.save();
  await ctx.answerCbQuery("⏸ Task paused");
  await showTaskDetail(ctx, task);
});

bot.action(/task_resume_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  task.status = task.completedCount >= task.goalCount ? "completed" : "active";
  await task.save();
  await ctx.answerCbQuery("▶️ Task resumed");
  await showTaskDetail(ctx, task);
});

bot.action(/task_notif_(.+)_(on|off)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  task.notifyOwner = ctx.match[2] === "on";
  await task.save();
  await ctx.answerCbQuery(task.notifyOwner ? "🔔 On" : "🔕 Off");
  await showTaskDetail(ctx, task);
});

bot.action(/task_acct_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  const next = task.audienceMode === "premium_only" ? "all" : "premium_only";
  const min = computeMinPrice(next, task.languages);
  // A narrower audience costs more per completion, so the switch is blocked
  // rather than silently leaving the task priced below its own minimum.
  if (task.pricePerAction < min) {
    await ctx.answerCbQuery(
      `Premium-only needs at least ${min} GRAM/unit. Raise the price first.`,
      { show_alert: true }
    );
    return;
  }
  task.audienceMode = next;
  await task.save();
  await ctx.answerCbQuery(next === "premium_only" ? "👑 Premium only" : "👥 All users");
  await showTaskDetail(ctx, task);
});

bot.action(/task_aud_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    `🌐 Audience languages\n\nTap to toggle, then Save. No selection = all users.`,
    languagePickMenu(`taskaud_${task._id}_`, task.languages || [], `taskdet_${task._id}`)
  );
});

bot.action(/taskaud_([a-f0-9]{24})_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  const code = ctx.match[2];
  const list = new Set(task.languages || []);
  list.has(code) ? list.delete(code) : list.add(code);
  const next = [...list];

  const min = computeMinPrice(task.audienceMode, next);
  if (task.pricePerAction < min) {
    await ctx.answerCbQuery(
      `A language filter needs at least ${min} GRAM/unit. Raise the price first.`,
      { show_alert: true }
    );
    return;
  }
  task.languages = next;
  await task.save();
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    `🌐 Audience languages\n\nTap to toggle, then Save. No selection = all users.`,
    languagePickMenu(`taskaud_${task._id}_`, next, `taskdet_${task._id}`)
  );
});

bot.action(/task_link_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  await ctx.answerCbQuery("Refreshing…");
  const link = await resolveInviteLink(task.targetChatId, task.targetChatUsername, task.linkType);
  if (!link) {
    await sendOrReplace(
      ctx,
      `⚠️ Couldn't create a new invite link. Make sure the bot is still an ` +
        `admin in "${task.targetChatTitle || task.targetChatId}" with the ` +
        `"Invite users via link" right.`,
      backToTaskMenu(task._id.toString())
    );
    return;
  }
  task.targetInviteLink = link;
  await task.save();
  await sendOrReplace(ctx, `🔄 New invite link:\n${link}`, backToTaskMenu(task._id.toString()));
});

// ---------- change price / add execution ----------

bot.action(/task_price_(.+)/, async (ctx) => {
  const { user, task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  const min = computeMinPrice(task.audienceMode, task.languages);
  await setSession(user, "awaiting_task_price", { taskId: task._id.toString() });
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    `✏️ Send the new reward per unit for task #${(task.taskNumber || 0).toLocaleString()}.\n\n` +
      `Current: ${task.pricePerAction.toLocaleString()} GRAM\n` +
      `Minimum for this audience: ${min.toLocaleString()} GRAM\n\n` +
      `Note: raising the price does NOT charge you now — the remaining ` +
      `completions are paid from your balance as they happen.`,
    backToTaskMenu(task._id.toString())
  );
});

bot.action(/task_add_(.+)/, async (ctx) => {
  const { user, task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  const canAfford = maxAffordable(user, task.pricePerAction);
  await setSession(user, "awaiting_task_add", { taskId: task._id.toString() });
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    `➕ How many extra ${UNIT_LABEL[task.type] || "actions"} do you want to add?\n\n` +
      `Price: ${task.pricePerAction.toLocaleString()} GRAM each\n` +
      `💰 Balance: ${(user.donatedBalance + user.earnedBalance).toLocaleString()} GRAM ` +
      `(up to ${canAfford} more)\n\n` +
      `Send a number.`,
    backToTaskMenu(task._id.toString())
  );
});

// Called from the text router below once the user replies with a number.
async function applyTaskPrice(ctx, user, text) {
  const price = Number(text);
  const task = await Task.findById(user.sessionData.taskId).catch(() => null);
  if (!task || task.ownerTelegramId !== user.telegramId) {
    await clearSession(user);
    await ctx.reply("Task not found.");
    return;
  }
  const min = computeMinPrice(task.audienceMode, task.languages);
  if (!Number.isFinite(price) || price < min) {
    await ctx.reply(`Please send a number of at least ${min.toLocaleString()} GRAM.`);
    return;
  }
  task.pricePerAction = Math.floor(price);
  await task.save();
  await clearSession(user);
  await ctx.reply(taskDetailText(task), taskDetailMenu(task));
}

async function applyTaskAdd(ctx, user, text) {
  const count = parseInt(text, 10);
  const task = await Task.findById(user.sessionData.taskId).catch(() => null);
  if (!task || task.ownerTelegramId !== user.telegramId) {
    await clearSession(user);
    await ctx.reply("Task not found.");
    return;
  }
  if (!Number.isFinite(count) || count <= 0) {
    await ctx.reply("Please send a valid positive whole number.");
    return;
  }

  // Extra executions are paid for up front, the same way the original
  // goalCount was at publish time (commission included).
  const spend = await spendForTask(user, count * task.pricePerAction);
  if (!spend.ok) {
    await ctx.reply(
      `❌ Insufficient balance. That would need ${spend.needed.toLocaleString()} GRAM ` +
        `(commission included).`
    );
    return;
  }

  task.goalCount += count;
  if (task.status === "completed") task.status = "active";
  await task.save();
  await clearSession(user);
  await ctx.reply(taskDetailText(task), taskDetailMenu(task));
}

// ---------- delete ----------

bot.action(/task_delete_(.+)/, async (ctx) => {
  const { task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
  const remaining = Math.max(task.goalCount - task.completedCount, 0);
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    `🗑 Delete task #${(task.taskNumber || 0).toLocaleString()}?\n\n` +
      `${(remaining * task.pricePerAction).toLocaleString()} GRAM for the ` +
      `${remaining} unfinished unit(s) will be refunded to your balance.\n` +
      `Workers who already completed it keep their reward.`,
    taskDeleteConfirmMenu(task._id.toString())
  );
});

bot.action(/task_delconf_(.+)/, async (ctx) => {
  const { user, task } = await loadOwnedTask(ctx, ctx.match[1]);
  if (!task) return;
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
  await ctx.answerCbQuery("Task deleted");
  await showMyTasks(ctx, user);
});

// ---------- earn flow ----------

const EARN_PAGE_SIZE = 10;
// After this many successful Checks since the last verification, the user
// must pass the human-verification puzzle again before another Check counts.
// The very first completion a user ever makes always forces one too (see
// the "totalTasksCompleted === 1" check in the verify_ handler below).
const ANTI_BOT_CHECK_INTERVAL = 10;

// A worker who completed a channel/group subscribe task must stay
// subscribed at least this many days, or the GRAM they earned for it is
// clawed back and returned to the task owner (see the chat_member handler).
const MIN_STAY_DAYS = 7;
const MIN_STAY_MS = MIN_STAY_DAYS * 24 * 60 * 60 * 1000;

const EARN_TYPE_MAP = { sub: ["channel", "group"], views: ["views"], bot: ["bot"] };

// Resolves the public base URL used to build the WebApp verify link.
// Priority: explicit PUBLIC_URL env var -> Vercel's stable production
// domain -> Vercel's per-deployment domain -> null (nothing usable).
// This means even if PUBLIC_URL is forgotten in the Vercel dashboard,
// the bot will still build a valid https:// link instead of sending
// Telegram a bare "/verify?..." path (which Telegram rejects with
// "URL host is empty" and silently breaks the button for the user).
function resolvePublicUrl() {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

function verifyUrlFor(user) {
  const base = resolvePublicUrl();
  if (!base) return null;
  return `${base}/verify?tid=${user.telegramId}`;
}

async function promptHumanVerification(ctx, user) {
  const verifyUrl = verifyUrlFor(user);
  if (!verifyUrl) {
    // No usable base URL at all (shouldn't happen on Vercel, but guard
    // anyway so we never crash the handler or send a broken button).
    console.error(
      "promptHumanVerification: no PUBLIC_URL/VERCEL_URL available, cannot build verify link"
    );
    await ctx.reply(
      "🔒 Human verification is temporarily unavailable. Please try again in a moment or contact support."
    );
    return;
  }
  await ctx.reply(
    "🔒 Please verify that you are human to keep earning.",
    humanVerifyMenu(verifyUrl)
  );
}

// Shared filter for every earn list (first page, pagination, and the
// in-place refresh after a completion) so they can never drift apart.
// Post tasks additionally require a stored targetMessageId — tasks created
// before the post flow existed have none and could never be forwarded, so
// they're hidden instead of failing in the worker's face.
function buildEarnFilter(types, category, telegramId) {
  const filter = {
    type: { $in: types },
    status: "active",
    ownerTelegramId: { $ne: telegramId },
    completedBy: { $ne: telegramId },
    $expr: { $lt: ["$completedCount", "$goalCount"] },
  };
  if (category === "views") filter.targetMessageId = { $exists: true, $ne: null };
  return filter;
}

async function showEarnList(ctx, user, category, page = 1) {
  await dbConnect();
  const types = EARN_TYPE_MAP[category];
  if (!types) return;

  const filter = buildEarnFilter(types, category, user.telegramId);

  const totalCount = await Task.countDocuments(filter);
  if (!totalCount) {
    await sendOrReplace(ctx, "No available tasks right now. Check back later!", earnTypeMenu());
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / EARN_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const tasks = await Task.find(filter)
    .sort({ pricePerAction: -1, _id: 1 })
    .skip((safePage - 1) * EARN_PAGE_SIZE)
    .limit(EARN_PAGE_SIZE);

  await sendOrReplace(
    ctx,
    category === "views"
      ? `👁 Post tasks — tap a post to view it and get paid instantly.\n\n` +
          `⚠️ Attention! Some posts are long — scroll them up and down.`
      : `${TYPE_LABELS[types[0]]} tasks — tap Subscribe to open it, then Check to get paid.`,
    earnTaskListMenu(tasks, category, safePage, totalPages)
  );
}

bot.action(/earn_(sub|views|bot)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await ctx.answerCbQuery();
  await showEarnList(ctx, user, ctx.match[1], 1);
});

bot.action(/earnpage_(sub|views|bot)_(\d+)/, async (ctx) => {
  const user = await getOrCreateUser(ctx);
  const [, category, pageStr] = ctx.match;
  await ctx.answerCbQuery();
  await dbConnect();
  const types = EARN_TYPE_MAP[category];
  const filter = buildEarnFilter(types, category, user.telegramId);
  const totalCount = await Task.countDocuments(filter);
  const totalPages = Math.max(1, Math.ceil(totalCount / EARN_PAGE_SIZE));
  const page = Math.min(Math.max(1, Number(pageStr)), totalPages);
  const tasks = await Task.find(filter)
    .sort({ pricePerAction: -1, _id: 1 })
    .skip((page - 1) * EARN_PAGE_SIZE)
    .limit(EARN_PAGE_SIZE);
  try {
    await ctx.editMessageReplyMarkup(
      earnTaskListMenu(tasks, category, page, totalPages).reply_markup
    );
  } catch (e) {
    // "message not modified" when already on that page — harmless.
  }
});

bot.action(/earnreport_(sub|views|bot)_(\d+)/, async (ctx) => {
  await ctx.answerCbQuery(
    "To report a task, contact support with its link — thanks for flagging it!",
    { show_alert: true }
  );
});

// A views task is paused automatically once this many workers report it,
// so a bad post stops circulating without waiting for manual moderation.
const REPORT_AUTO_PAUSE = 3;

// ---------- post (views) tasks: show the post, pay, allow reporting ----------

bot.action(/viewpost_(.+)/, async (ctx) => {
  await dbConnect();
  const user = await getOrCreateUser(ctx);
  const task = await Task.findById(ctx.match[1]);

  if (!task || task.status !== "active" || task.completedCount >= task.goalCount) {
    await ctx.answerCbQuery("This task is no longer available.");
    return;
  }
  if (task.completedBy.includes(user.telegramId)) {
    await ctx.answerCbQuery("You already viewed this post.");
    return;
  }
  if (!task.targetMessageId) {
    await ctx.answerCbQuery("This task is missing its post — skipping it.");
    return;
  }
  if (!user.isVerified) {
    await ctx.answerCbQuery();
    await promptHumanVerification(ctx, user);
    return;
  }

  // Show the post first. Forwarding from the original channel (rather than
  // copying it) is what makes the view count for the owner AND keeps the
  // "Forwarded from <channel>" header, so the worker can see the source.
  try {
    await bot.telegram.forwardMessage(user.telegramId, task.targetChatId, task.targetMessageId);
  } catch (e) {
    // Post deleted, or the bot was removed as admin. Pause the task so no
    // one else hits this, and tell the owner how to fix or refund it.
    if (task.status === "active") {
      task.status = "paused";
      await task.save();
      await notifyTaskOwner(
        task,
        `⏸ Your post task "${task.targetChatTitle || task.targetChatId}" was paused — ` +
          `I can no longer forward that post.\n\n` +
          `Either the post was deleted, or I'm not an admin in the channel anymore. ` +
          `Fix it and resume from 👤 My Cabinet → 📋 My Tasks, or delete the task to ` +
          `get the unused GRAM refunded.`
      );
    }
    await ctx.answerCbQuery("That post isn't available anymore — try another one.", {
      show_alert: true,
    });
    return;
  }

  // Same atomic claim the subscribe flow uses: the filter can only match
  // once, so double-tapping can never pay twice.
  const updatedTask = await Task.findOneAndUpdate(
    {
      _id: task._id,
      status: "active",
      completedBy: { $ne: user.telegramId },
      $expr: { $lt: ["$completedCount", "$goalCount"] },
    },
    {
      $inc: { completedCount: 1 },
      $push: {
        completedBy: user.telegramId,
        completions: { telegramId: user.telegramId, completedAt: new Date() },
      },
    },
    { new: true }
  );

  if (!updatedTask) {
    await ctx.answerCbQuery("You already viewed this post, or it just filled up.");
    return;
  }
  if (updatedTask.completedCount >= updatedTask.goalCount && updatedTask.status === "active") {
    updatedTask.status = "completed";
    await updatedTask.save();
  }

  await creditEarned(user, updatedTask.pricePerAction, "Viewed promoted post", updatedTask._id);

  const postNumber = await nextCounterValue("completions", 800000);
  const balance = user.donatedBalance + user.earnedBalance;
  await ctx.answerCbQuery("✅ Paid!");
  // forceNew: the post was just forwarded below the old task-list message,
  // so the reward + "Next Post" buttons belong underneath the post, not
  // edited into the list above it. Tapping Next Post rebuilds the list
  // from the DB, which no longer contains this task.
  await sendOrReplace(
    ctx,
    `💲 You earned +${updatedTask.pricePerAction.toLocaleString()} GRAM for viewing post ` +
      `#${postNumber.toLocaleString()}!\n` +
      `💰 Your balance: ${balance.toLocaleString()} GRAM`,
    afterViewMenu(updatedTask._id.toString()),
    { forceNew: true }
  );

  user.totalTasksCompleted += 1;
  user.tasksSinceVerification += 1;
  const isFirstEverCompletion = user.totalTasksCompleted === 1;
  if (isFirstEverCompletion || user.tasksSinceVerification >= ANTI_BOT_CHECK_INTERVAL) {
    user.tasksSinceVerification = 0;
    user.isVerified = false;
    await user.save();
    await promptHumanVerification(ctx, user);
  } else {
    await user.save();
  }
});

bot.action(/postreport_(.+)/, async (ctx) => {
  await ctx.answerCbQuery();
  await sendOrReplace(
    ctx,
    "Please select the reason for your complaint:",
    reportReasonMenu(ctx.match[1])
  );
});

bot.action(/prsn_(.+)_(adult|other)/, async (ctx) => {
  const [, taskId, kind] = ctx.match;
  const user = await getOrCreateUser(ctx);

  if (kind === "other") {
    await setSession(user, "awaiting_report_text", { reportTaskId: taskId });
    await ctx.answerCbQuery();
    await sendOrReplace(ctx, "✍️ Send a short description of the problem:");
    return;
  }

  await recordReport(taskId, user, "Inappropriate content");
  await ctx.answerCbQuery("Report received");
  await sendOrReplace(
    ctx,
    "✅ Thanks — your report has been recorded.",
    Markup.inlineKeyboard([
      [Markup.button.callback("➡️ Next Post", "earn_views")],
      [Markup.button.callback("⬅️ Back", "menu_earn")],
    ])
  );
});

// Stores the report, and pauses the task (notifying its owner) once enough
// different workers have flagged the same post.
async function recordReport(taskId, user, reason) {
  await dbConnect();
  const task = await Task.findById(taskId);
  if (!task) return;
  if (task.reports.some((r) => r.telegramId === user.telegramId)) return; // one per worker

  task.reports.push({ telegramId: user.telegramId, reason });
  task.reportCount = task.reports.length;

  if (task.reportCount >= REPORT_AUTO_PAUSE && task.status === "active") {
    task.status = "paused";
    await notifyTaskOwner(
      task,
      `⚠️ Your post task "${task.targetChatTitle || task.targetChatId}" was paused after ` +
        `${task.reportCount} reports from workers. An admin will review it.`
    );
  }

  await task.save();
}

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

  if (!user.isVerified) {
    await ctx.answerCbQuery();
    await promptHumanVerification(ctx, user);
    return;
  }

  const isMember =
    task.type === "views" || task.type === "bot"
      ? true // views/bot completion can't be verified via getChatMember; trust + admin review
      : await isUserMemberOf(task.targetChatId, user.telegramId);

  if (!isMember) {
    await ctx.answerCbQuery();
    await ctx.reply("ℹ️ You are not subscribed to the channel/chat yet. Subscribe and try again.");
    return;
  }

  // Atomic, filtered update: only succeeds if the task is still active, not
  // yet full, and this user hasn't already completed it — all checked and
  // written in one DB operation. This is what actually prevents the "Check
  // button doesn't work" failures seen in the logs: tapping Check more than
  // once quickly fires multiple concurrent requests, and the old
  // load-then-save pattern let two of them race on the same document,
  // throwing a Mongoose VersionError on the loser (visible only as an
  // "Unhandled error" with no user-facing response). findOneAndUpdate can't
  // lose that race — the filter simply won't match a second time.
  const updatedTask = await Task.findOneAndUpdate(
    {
      _id: task._id,
      status: "active",
      completedBy: { $ne: user.telegramId },
      $expr: { $lt: ["$completedCount", "$goalCount"] },
    },
    {
      $inc: { completedCount: 1 },
      $push: {
        completedBy: user.telegramId,
        // Recorded so the chat_member handler can later check whether this
        // user stayed subscribed at least MIN_STAY_DAYS before clawing the
        // reward back.
        completions: { telegramId: user.telegramId, completedAt: new Date() },
      },
    },
    { new: true }
  );

  if (!updatedTask) {
    await ctx.answerCbQuery("You already completed this task, or it just filled up.");
    return;
  }
  if (updatedTask.completedCount >= updatedTask.goalCount && updatedTask.status === "active") {
    updatedTask.status = "completed";
    await updatedTask.save();
  }

  await creditEarned(user, updatedTask.pricePerAction, "Completed promotion task", updatedTask._id);

  const taskNumber = await nextCounterValue("completions", 800000);
  const balance = user.donatedBalance + user.earnedBalance;
  await ctx.answerCbQuery("✅ Verified! Coins added.");
  await ctx.reply(
    `✅ Task №${taskNumber.toLocaleString()} completed\n\n` +
      `💵 You received +${updatedTask.pricePerAction.toLocaleString()} GRAM\n` +
      `💰 Balance: ${balance.toLocaleString()} GRAM\n\n` +
      (updatedTask.type === "channel" || updatedTask.type === "group"
        ? `ℹ️ Stay subscribed at least ${MIN_STAY_DAYS} days — leaving early gets this reward deducted again.`
        : "")
  );

  // Refresh the earn list in place: remove the just-completed task and
  // re-sort so the highest-paying remaining task is back on top.
  await refreshEarnListInPlace(ctx, updatedTask, user.telegramId);

  user.totalTasksCompleted += 1;
  user.tasksSinceVerification += 1;
  const isFirstEverCompletion = user.totalTasksCompleted === 1;
  if (isFirstEverCompletion || user.tasksSinceVerification >= ANTI_BOT_CHECK_INTERVAL) {
    user.tasksSinceVerification = 0;
    user.isVerified = false;
    await user.save();
    await promptHumanVerification(ctx, user);
  } else {
    await user.save();
  }
});

// After a Check succeeds, re-renders the same earn-list message (same
// category/page it was tapped from) with the just-completed task removed
// and the remaining ones freshly sorted highest-price-first.
async function refreshEarnListInPlace(ctx, task, completingTelegramId) {
  try {
    await dbConnect();
    const category = task.type === "views" ? "views" : task.type === "bot" ? "bot" : "sub";

    // The current page is always the 3rd button of the pagination row
    // (["1", "<", `${page}`, ">", `${totalPages}`]) — see earnTaskListMenu.
    let page = 1;
    const rows = ctx.callbackQuery?.message?.reply_markup?.inline_keyboard || [];
    for (const row of rows) {
      const match = row[2]?.callback_data?.match(/^earnpage_(?:sub|views|bot)_(\d+)$/);
      if (match) {
        page = Number(match[1]);
        break;
      }
    }

    const types = EARN_TYPE_MAP[category];
    const filter = buildEarnFilter(types, category, completingTelegramId);

    const totalCount = await Task.countDocuments(filter);
    if (!totalCount) {
      await ctx.editMessageText("No available tasks right now. Check back later!", earnTypeMenu());
      return;
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / EARN_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const tasks = await Task.find(filter)
      .sort({ pricePerAction: -1, _id: 1 })
      .skip((safePage - 1) * EARN_PAGE_SIZE)
      .limit(EARN_PAGE_SIZE);

    await ctx.editMessageReplyMarkup(
      earnTaskListMenu(tasks, category, safePage, totalPages).reply_markup
    );
  } catch (e) {
    // "message not modified" (nothing changed) or the message got too old
    // to edit — both harmless, the user can still reopen 💰 Earnings.
  }
}

// "✅ Continue" on the verification prompt, tapped before actually solving
// the puzzle (the puzzle itself reports success via web_app_data below).
// Named "hv_continue" (not "verify_continue") so it can never collide with
// the /verify_(.+)/ task-Check handler above.
bot.action("hv_continue", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  if (!user.isVerified) {
    await ctx.answerCbQuery("Please tap Verify first.", { show_alert: true });
    return;
  }
  await ctx.answerCbQuery("You're verified — carry on!");
  await ctx.deleteMessage().catch(() => {});
});

// The verify.js WebApp calls Telegram.WebApp.sendData(...) once the puzzle
// is solved, which arrives here as a private-chat message.
bot.on(message("web_app_data"), async (ctx) => {
  const user = await getOrCreateUser(ctx);
  let payload = {};
  try {
    payload = JSON.parse(ctx.message.web_app_data.data);
  } catch (e) {
    // ignore malformed payloads
  }
  if (payload.verified) {
    user.isVerified = true;
    user.tasksSinceVerification = 0;
    await user.save();
    await ctx.reply("✅ Verified! You can keep earning — tap Check again on any task.");
  }
});

// A private chat's join-request link (see resolveInviteLink/linkType
// "join_request") normally waits for the chat owner to approve each
// request by hand. Since our worker is only paid once getChatMember shows
// them as an actual member (see isUserMemberOf in the verify_ handler), any
// task using that link type auto-approves join requests immediately instead
// — the worker gets in (and paid) right away, with no manual step.
bot.on("chat_join_request", async (ctx) => {
  try {
    await dbConnect();
    const req = ctx.update.chat_join_request;
    if (!req) return;
    const chatId = String(req.chat.id);

    const hasJoinRequestTask = await Task.exists({
      targetChatId: chatId,
      linkType: "join_request",
      status: { $ne: "deleted" },
    });
    if (!hasJoinRequestTask) return; // not one of our promoted chats — leave it to the owner

    await ctx.telegram.approveChatJoinRequest(chatId, req.from.id);
  } catch (e) {
    console.error("Auto-approve join request failed:", e);
  }
});

// Fires whenever a user's membership status changes in any chat where the
// bot is an admin (requires "chat_member" in setWebhook's allowed_updates —
// see scripts/setWebhook.js). Used to enforce the "must stay subscribed at
// least MIN_STAY_DAYS days" rule: if a worker leaves/is kicked from a
// channel/group they were paid to join before that window closes, the GRAM
// they earned for it is clawed back and returned to the task owner.
bot.on("chat_member", async (ctx) => {
  try {
    await dbConnect();
    const update = ctx.update.chat_member;
    if (!update) return;

    const oldStatus = update.old_chat_member?.status;
    const newStatus = update.new_chat_member?.status;
    const wasIn = ["member", "administrator", "creator", "restricted"].includes(oldStatus);
    const isOut = ["left", "kicked"].includes(newStatus);
    if (!wasIn || !isOut) return;

    const chatId = String(update.chat.id);
    const telegramId = update.new_chat_member.user.id;

    const tasks = await Task.find({
      targetChatId: chatId,
      type: { $in: ["channel", "group"] },
      completions: { $elemMatch: { telegramId, settled: false } },
    });

    for (const task of tasks) {
      let dirty = false;
      for (const completion of task.completions) {
        if (completion.telegramId !== telegramId || completion.settled) continue;

        const elapsed = Date.now() - new Date(completion.completedAt).getTime();
        if (elapsed < MIN_STAY_MS) {
          const worker = await User.findOne({ telegramId });
          if (worker) {
            const deducted = await clawbackEarned(
              worker,
              task.pricePerAction,
              `Left "${task.targetChatTitle || chatId}" before the ${MIN_STAY_DAYS}-day minimum`,
              task._id
            );
            if (deducted > 0) {
              task.refundedCount = (task.refundedCount || 0) + 1;
              await creditOwnerReclaimed(task.ownerTelegramId, deducted, task._id);
              await bot.telegram
                .sendMessage(
                  telegramId,
                  `⚠️ You left "${task.targetChatTitle || "the channel/group"}" before staying ` +
                    `the required ${MIN_STAY_DAYS} days.\n` +
                    `💸 ${deducted.toLocaleString()} GRAM earned from that task has been deducted ` +
                    `from your balance.`
                )
                .catch(() => {});
            }
          }
        }
        completion.settled = true;
        dirty = true;
      }
      if (dirty) await task.save();
    }
  } catch (e) {
    console.error("chat_member handler error:", e);
  }
});

// ---------- persistent reply-keyboard buttons ----------

bot.hears("📢 Promote", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await showPromoteTypeMenu(ctx, user);
});

bot.hears("💰 Earnings", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await sendClean(ctx, user, "💰 Choose a category to earn coins:", earnTypeMenu());
});

bot.hears("👤 My Cabinet", async (ctx) => {
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await showCabinet(ctx, user);
});

bot.hears("✅ Subscription Check", async (ctx) => {
  // Shortcut: jump straight into the "subscribe" earn list (channels +
  // groups) so the user can grab any available task without navigating.
  const user = await getOrCreateUser(ctx);
  await tryDeleteUserMessage(ctx);
  await showEarnList(ctx, user, "sub", 1);
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

  if (state === "awaiting_report_text") {
    await recordReport(user.sessionData.reportTaskId, user, text.slice(0, 300));
    await clearSession(user);
    await ctx.reply(
      "✅ Thanks — your report has been recorded.",
      Markup.inlineKeyboard([
        [Markup.button.callback("➡️ Next Post", "earn_views")],
        [Markup.button.callback("⬅️ Back", "menu_earn")],
      ])
    );
    return;
  }

  if (state === "awaiting_task_price") {
    await applyTaskPrice(ctx, user, text);
    return;
  }

  if (state === "awaiting_task_add") {
    await applyTaskAdd(ctx, user, text);
    return;
  }

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

  // ---- new promote-wizard states (channel/group/views/boost/reactions) ----

  if (state === "choosing_audience_languages") {
    if (text.startsWith("☑️ Continue")) {
      await goForward(user, "wizard_awaiting_price", {});
      await renderWizardStep(ctx, user, "wizard_awaiting_price");
      return;
    }
    const clean = text.replace(/^✅\s*/, "");
    const lang = LANGUAGES.find((l) => l.label === clean);
    if (!lang) {
      await ctx.reply("Tap a language to toggle it, or tap Continue.");
      return;
    }
    const current = user.sessionData.languages || [];
    const languages = current.includes(lang.code)
      ? current.filter((c) => c !== lang.code)
      : [...current, lang.code];
    await setSession(user, "choosing_audience_languages", { ...user.sessionData, languages });
    await renderWizardStep(ctx, user, "choosing_audience_languages");
    return;
  }

  if (state === "wizard_awaiting_price") {
    const price = Number(text);
    const min = computeMinPrice(user.sessionData.audienceMode, user.sessionData.languages);
    if (!Number.isFinite(price) || price <= 0) {
      await ctx.reply("Please send a valid positive number for the price.");
      return;
    }
    if (price < min) {
      await ctx.reply(`⚠️ Price too low. Minimum — ${min} GRAM per subscriber.`);
      await renderWizardStep(ctx, user, "wizard_awaiting_price");
      return;
    }
    await goForward(user, "wizard_choosing_count", { price });
    await renderWizardStep(ctx, user, "wizard_choosing_count");
    return;
  }

  if (state === "wizard_choosing_count") {
    if (text === "✏️ Custom amount") {
      await goForward(user, "wizard_awaiting_custom_count", {});
      await renderWizardStep(ctx, user, "wizard_awaiting_custom_count");
      return;
    }
    // Covers the "(Maximum for your balance)" button, the four
    // balance-fraction buttons, and anything typed by hand — they all
    // arrive as text, and proceedToPayment re-checks affordability anyway.
    const tapped = parseInt(text, 10);
    if (Number.isFinite(tapped) && tapped > 0) {
      await proceedToPayment(ctx, user, tapped);
      return;
    }
    await ctx.reply('Tap a button below, or use "✏️ Custom amount" to type a number.');
    return;
  }

  if (state === "wizard_awaiting_custom_count") {
    const count = parseInt(text, 10);
    if (!Number.isFinite(count) || count <= 0) {
      await ctx.reply("Please send a valid positive whole number.");
      return;
    }
    await proceedToPayment(ctx, user, count);
    return;
  }

  if (state === "wizard_choosing_payment") {
    const totalGram = user.sessionData.price * user.sessionData.count;
    const starsCost = gramToStars(totalGram);
    if (text === `💲 ${totalGram} GRAM`) {
      await proceedAfterPaymentChoice(ctx, user, "gram");
      return;
    }
    if (text === `⭐ ${starsCost} Telegram stars (-${STARS_DISCOUNT_PERCENT}%)`) {
      await proceedAfterPaymentChoice(ctx, user, "stars");
      return;
    }
    await ctx.reply("Please tap one of the payment method buttons below.");
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
  const { type, price } = user.sessionData;
  const totalCost = price * count;
  const available = user.donatedBalance + user.earnedBalance;

  if (!Number.isFinite(totalCost)) {
    await clearSession(user);
    await ctx.reply("⚠️ Something went wrong with your task details. Please start over.", mainMenu());
    return;
  }

  if (available < totalCost) {
    await clearSession(user);
    await ctx.reply(
      `❌ Insufficient balance. This task needs up to ${totalCost} coins ` +
        `(plus commission if paid from earned coins). Your balance: ${available}.`,
      mainMenu()
    );
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

  const adminOk = await isBotAdminIn(chatId);
  if (!adminOk) {
    await ctx.reply(
      "⚠️ I'm not an admin there yet. Please add me as an administrator " +
        "(with 'invite users via link' permission) and send the chat again."
    );
    return;
  }

  let chatInfo;
  try {
    chatInfo = await bot.telegram.getChat(chatId);
  } catch (e) {
    await ctx.reply("Couldn't read that chat. Please try again.");
    return;
  }

  await dbConnect();
  const { type, price, count } = user.sessionData;
  const spend = await spendForTask(user, price * count);
  if (!spend.ok) {
    if (spend.invalid) {
      await clearSession(user);
      await ctx.reply("⚠️ Something went wrong with your task details. Please start over.", mainMenu());
    } else {
      await ctx.reply(`❌ Insufficient balance. Needed: ${spend.needed} coins.`);
    }
    return;
  }

  const task = await Task.create({
    ownerTelegramId: user.telegramId,
    taskNumber: await nextCounterValue("tasks", 1888000),
    type,
    targetChatId: String(chatId),
    targetChatTitle: chatInfo.title,
    targetChatUsername: chatInfo.username,
    pricePerAction: price,
    goalCount: count,
  });

  await clearSession(user);
  await ctx.reply(
    `✅ Task created!\n\n` +
      `${TYPE_LABELS[type]} — ${chatInfo.title || chatUsername}\n` +
      `Price: ${price} coins × ${count} = ${price * count} coins` +
      (spend.commission ? ` (+${spend.commission} commission)` : "") +
      `\n\nTrack it under 🗂 My Cabinet → My Tasks.`,
    mainMenu()
  );
}

export default bot;

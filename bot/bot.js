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
  taskManageMenu,
  promoteTypeReplyMenu,
  adminStatusReplyMenu,
  linkTypeMenu,
  audienceMainMenu,
  audienceTierMenu,
  languageMenu,
  LANGUAGES,
  countMenu,
  paymentMethodMenu,
  joinRequestConfirmMenu,
  publishConfirmMenu,
  earnTaskListMenu,
  humanVerifyMenu,
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

function gramToStars(totalGram) {
  return Math.max(1, Math.ceil((totalGram * (100 - STARS_DISCOUNT_PERCENT)) / 100 / GRAM_PER_STAR));
}

// Turn the "delete old menu / delete user's message" behavior on or off in
// one place. Set back to true to re-enable auto-delete later.
const AUTO_DELETE_MESSAGES = false;

// A single Telegraf instance is reused across warm serverless invocations.
export const bot = new Telegraf(process.env.BOT_TOKEN);

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

async function creditEarned(user, amount, note, relatedTaskId) {
  if (!Number.isFinite(amount)) {
    console.error(`creditEarned: refusing non-finite amount (${amount}) for user ${user.telegramId}, task ${relatedTaskId}`);
    return;
  }
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
  await ctx.editMessageText("🗂 My Cabinet", cabinetMenu());
});

// ---------- promote flow ----------
// Full task-creation wizard: type -> admin/chat picker -> link type ->
// audience -> price -> count -> payment method -> (join-request confirm) ->
// publish. Every step here is a persistent reply keyboard, matching the
// real app's style — see keyboards.js for the button layouts.

// Types that need a target channel/group picked via Telegram's native
// `request_chat` flow. "bot" targets another bot (not a chat), so it keeps
// the simpler legacy price->count->@username flow further below instead.
const CHAT_PICKER_TYPES = ["channel", "group", "views", "boost", "reactions"];

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
      await ctx.reply(
        `💲 Set the price for 1 subscription — this is the worker's reward.\n\n` +
          `Minimum — ${min} GRAM\n` +
          `💡 Recommended — ${min + RECOMMENDED_SURCHARGE} GRAM\n` +
          `Completion speed depends on your price.`
      );
      return;
    }
    case "wizard_choosing_count": {
      const total = user.donatedBalance + user.earnedBalance;
      const maxForBalance = Math.max(1, Math.floor(total / d.price));
      await ctx.reply(
        `🧾 Enter the number of subscriptions or choose:\n` +
          `💵 Subscription price — ${d.price} GRAM\n` +
          `💰 Your balance — ${total.toLocaleString()} GRAM`,
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
bot.hears("👁 Post", (ctx) => startChatPickerWizard(ctx, "views"));
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
  if (available < totalGram) {
    await ctx.reply(
      `❌ Insufficient balance for that many. Max you can afford: ` +
        `${Math.max(1, Math.floor(available / user.sessionData.price))}.`
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

  const inviteLink = await resolveInviteLink(d.targetChatId, d.targetChatUsername, d.linkType);

  let commission = 0;
  if (paymentMethod === "gram") {
    const spend = await spendForTask(user, totalGram);
    if (!spend.ok) {
      await ctx.reply(`❌ Insufficient balance. Needed: ${spend.needed} GRAM.`);
      return;
    }
    commission = spend.commission;
  }

  await Task.create({
    ownerTelegramId: user.telegramId,
    type: d.type,
    targetChatId: d.targetChatId,
    targetChatTitle: d.targetChatTitle,
    targetChatUsername: d.targetChatUsername,
    targetInviteLink: inviteLink,
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

async function showMyTasks(ctx, user) {
  await dbConnect();
  const tasks = await Task.find({
    ownerTelegramId: user.telegramId,
    status: { $ne: "deleted" },
  }).sort({ createdAt: -1 });

  if (!tasks.length) {
    await ctx.reply("You have no tasks yet.", cabinetMenu());
    return;
  }

  await ctx.reply(`📋 You have ${tasks.length} task(s):`);
  for (const t of tasks) {
    await ctx.reply(
      `${TYPE_LABELS[t.type]} — ${t.targetChatTitle || t.targetChatId}\n` +
        `Price: ${t.pricePerAction} coins | Progress: ${t.completedCount}/${t.goalCount}\n` +
        `Status: ${t.status}`,
      taskManageMenu(t._id.toString(), t.status)
    );
  }
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

async function showEarnList(ctx, user, category, page = 1) {
  await dbConnect();
  const types = EARN_TYPE_MAP[category];
  if (!types) return;

  const filter = {
    type: { $in: types },
    status: "active",
    ownerTelegramId: { $ne: user.telegramId },
    completedBy: { $ne: user.telegramId },
    $expr: { $lt: ["$completedCount", "$goalCount"] },
  };

  const totalCount = await Task.countDocuments(filter);
  if (!totalCount) {
    await ctx.reply("No available tasks right now. Check back later!", earnTypeMenu());
    return;
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / EARN_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);

  const tasks = await Task.find(filter)
    .sort({ pricePerAction: -1, _id: 1 })
    .skip((safePage - 1) * EARN_PAGE_SIZE)
    .limit(EARN_PAGE_SIZE);

  await ctx.reply(
    `${TYPE_LABELS[types[0]]} tasks — tap Subscribe to open it, then Check to get paid.`,
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
  const filter = {
    type: { $in: types },
    status: "active",
    ownerTelegramId: { $ne: user.telegramId },
    completedBy: { $ne: user.telegramId },
    $expr: { $lt: ["$completedCount", "$goalCount"] },
  };
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
    const filter = {
      type: { $in: types },
      status: "active",
      ownerTelegramId: { $ne: completingTelegramId },
      completedBy: { $ne: completingTelegramId },
      $expr: { $lt: ["$completedCount", "$goalCount"] },
    };

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
  await sendClean(ctx, user, "🗂 My Cabinet", cabinetMenu());
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
    const total = user.donatedBalance + user.earnedBalance;
    const maxForBalance = Math.max(1, Math.floor(total / user.sessionData.price));
    if (text === "✏️ Custom amount") {
      await goForward(user, "wizard_awaiting_custom_count", {});
      await renderWizardStep(ctx, user, "wizard_awaiting_custom_count");
      return;
    }
    const tappedMax = parseInt(text, 10);
    if (text.endsWith("(Maximum for your balance)") && tappedMax === maxForBalance) {
      await proceedToPayment(ctx, user, maxForBalance);
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
    await ctx.reply(`❌ Insufficient balance. Needed: ${spend.needed} coins.`);
    return;
  }

  const task = await Task.create({
    ownerTelegramId: user.telegramId,
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

import { dbConnect } from "../lib/db.js";
import PendingBotAdd from "../models/PendingBotAdd.js";
import { ADMIN_RIGHT_TO_BOT_API_FIELD } from "../lib/telegramBotAdd.js";

// Reads the actual granted rights off a ChatMemberAdministrator object
// (from getChatMember / my_chat_member) rather than trusting what we
// originally asked for.
function extractGrantedPermissions(chatMember) {
  if (!chatMember || chatMember.status !== "administrator") return [];
  return Object.entries(ADMIN_RIGHT_TO_BOT_API_FIELD)
    .filter(([, botApiField]) => chatMember[botApiField] === true)
    .map(([right]) => right);
}

async function finalizePending(pending, chat, chatMember) {
  const granted = extractGrantedPermissions(chatMember);

  if (chatMember.status !== "administrator") {
    pending.status = "failed";
    pending.failureReason = `bot_status_is_${chatMember.status}`;
  } else {
    pending.status = "verified";
    pending.chatId = chat.id;
    pending.chatTitle = chat.title || null;
    pending.chatType = chat.type;
    pending.grantedPermissions = granted;

    const missing = pending.requestedPermissions.filter(
      (perm) => !granted.includes(perm)
    );
    if (missing.length > 0) {
      pending.failureReason = `missing_permissions:${missing.join(",")}`;
    }
  }

  await pending.save();
}

/**
 * Call this once from bot/bot.js, e.g.:
 *   import { registerAddBotHandlers } from "./addBotHandlers.js";
 *   registerAddBotHandlers(bot);
 * Register it BEFORE your existing bot.start(...) handler — it calls
 * next() for ordinary private-chat /start commands so your existing
 * flow is untouched.
 */
export function registerAddBotHandlers(bot) {
  // ---- Group flow: catches the "/start <token>" message Telegram sends
  // to the group right after the bot is added with a startgroup payload.
  bot.start(async (ctx, next) => {
    if (ctx.chat.type === "private") {
      return next(); // let the real DM /start handler run
    }

    const token = ctx.startPayload;
    if (!token) return; // some other bot-in-group /start with no payload — ignore

    await dbConnect();
    const pending = await PendingBotAdd.findOne({
      token,
      type: "group",
      status: "pending",
    });
    if (!pending) return; // unknown/expired/already-handled token — ignore silently

    if (pending.expiresAt < new Date()) {
      pending.status = "expired";
      await pending.save();
      return;
    }

    // Never trust the update alone — ask Telegram directly what the
    // bot's actual status/rights are in this chat right now.
    let chatMember;
    try {
      const me = await ctx.telegram.getMe();
      chatMember = await ctx.telegram.getChatMember(ctx.chat.id, me.id);
    } catch (err) {
      console.error("getChatMember failed while verifying group add:", err);
      return;
    }

    await finalizePending(pending, ctx.chat, chatMember);
  });

  // ---- Channel flow (and a safety net for groups): fires whenever the
  // bot's own membership/rights change in any chat. This is the only
  // signal Telegram gives us for channels, since channel deep links
  // carry no token — so we match by the Telegram user id who performed
  // the action (captured earlier via the Login Widget).
  bot.on("my_chat_member", async (ctx) => {
    const update = ctx.myChatMember;
    const chat = update.chat;
    const actorTelegramId = update.from?.id;
    const newStatus = update.new_chat_member?.status;

    if (chat.type !== "channel" || !actorTelegramId) return;
    if (newStatus !== "administrator" && newStatus !== "member") return;

    await dbConnect();
    const pending = await PendingBotAdd.findOne({
      telegramUserId: actorTelegramId,
      type: "channel",
      status: "pending",
    }).sort({ createdAt: -1 });

    if (!pending || pending.expiresAt < new Date()) return;

    // Re-verify live rather than trusting the update payload directly.
    let chatMember;
    try {
      const me = await ctx.telegram.getMe();
      chatMember = await ctx.telegram.getChatMember(chat.id, me.id);
    } catch (err) {
      console.error("getChatMember failed while verifying channel add:", err);
      return;
    }

    await finalizePending(pending, chat, chatMember);
  });
}

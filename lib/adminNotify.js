import { Markup } from "telegraf";

// Sends a private message to a bot user from the dashboard. The bot module
// is imported lazily so routes that never message anyone don't pay for it.
// Never throws: returns { ok, error } so the caller can tell the admin
// whether the message actually got delivered (user blocked the bot, etc.).
export async function dmUser(telegramId, text, { replyButtonReportId } = {}) {
  try {
    const { bot } = await import("../bot/bot.js");
    const extra = replyButtonReportId
      ? Markup.inlineKeyboard([[Markup.button.callback("💬 Reply", `rpt_reply_${replyButtonReportId}`)]])
      : undefined;
    await bot.telegram.sendMessage(telegramId, String(text).slice(0, 4000), extra);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.description || e?.message || "send failed" };
  }
}

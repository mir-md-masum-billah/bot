import mongoose from "mongoose";

const UserSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },
    username: String,
    firstName: String,
    lastName: String,

    // Coin balances are split so we can apply the 10% commission
    // only to coins earned by completing tasks (not donated/bought).
    donatedBalance: { type: Number, default: 0 },
    earnedBalance: { type: Number, default: 0 },

    hasDonatedEver: { type: Boolean, default: false },

    referredBy: { type: Number, default: null },
    isBanned: { type: Boolean, default: false },

    // Anti-bot "human verification" (drag-puzzle captcha). Users start
    // verified; after every ANTI_BOT_CHECK_INTERVAL completed earn-checks
    // (see bot.js) this flips to false and tasksSinceVerification resets,
    // forcing a fresh verification before further Check taps are accepted.
    isVerified: { type: Boolean, default: true },
    tasksSinceVerification: { type: Number, default: 0 },

    // Simple in-memory-style state machine for multi-step bot flows
    // (e.g. "waiting for subscriber count", "waiting for chat forward")
    sessionState: { type: String, default: null },
    sessionData: { type: mongoose.Schema.Types.Mixed, default: {} },

    // The message_id of the bot's last menu/reply in this chat, used to
    // delete it before sending the next one (keeps the chat clean).
    // Note: Telegram only lets bots delete their OWN messages in private
    // chats — a user's own sent messages can never be deleted by the bot.
    lastMenuMessageId: { type: Number, default: null },
  },
  { timestamps: true }
);

UserSchema.virtual("totalBalance").get(function () {
  return this.donatedBalance + this.earnedBalance;
});

export default mongoose.models.User || mongoose.model("User", UserSchema);

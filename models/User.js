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

    // Level system (PR GRAM-style "🐣 Novice 66/500 XP"). XP is awarded for
    // every completed earn-task; the level itself is derived from xp at
    // display time (see LEVELS in bot.js), never stored, so the thresholds
    // can be retuned later without a migration.
    xp: { type: Number, default: 0 },

    // Interface language chosen in 👤 My Cabinet → 🌐 Change Language.
    language: { type: String, default: "en" },

    // Master switch for bot notifications (task finished, report, clawback).
    notificationsEnabled: { type: Boolean, default: true },
    isBanned: { type: Boolean, default: false },

    // Anti-bot "human verification" (drag-puzzle captcha). Users start
    // verified; after every ANTI_BOT_CHECK_INTERVAL completed earn-checks
    // (see bot.js) this flips to false and tasksSinceVerification resets,
    // forcing a fresh verification before further Check taps are accepted.
    isVerified: { type: Boolean, default: true },
    tasksSinceVerification: { type: Number, default: 0 },
    // Lifetime count of completed earn-tasks. Used only to detect "this was
    // the user's very first completion ever", which forces one extra
    // verification right after it (see verify_ handler in bot.js) on top of
    // the regular every-ANTI_BOT_CHECK_INTERVAL re-verification.
    totalTasksCompleted: { type: Number, default: 0 },

    // Bot tasks the user tapped "🙈 Hide task" on — excluded from their own
    // 🤖 Bots list from then on (doesn't affect other workers).
    hiddenBotTaskIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },

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

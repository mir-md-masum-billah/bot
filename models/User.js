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

    // Simple in-memory-style state machine for multi-step bot flows
    // (e.g. "waiting for subscriber count", "waiting for chat forward")
    sessionState: { type: String, default: null },
    sessionData: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

UserSchema.virtual("totalBalance").get(function () {
  return this.donatedBalance + this.earnedBalance;
});

export default mongoose.models.User || mongoose.model("User", UserSchema);

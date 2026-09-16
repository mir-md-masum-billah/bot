import mongoose from "mongoose";

// Tracks one "Add to Channel" / "Add to Group" attempt started from the
// website, from the moment the deep link is generated until the backend
// confirms (via a real Telegram update) that the bot was actually added
// with the required admin rights.
const PendingBotAddSchema = new mongoose.Schema(
  {
    // Random, unguessable token. For group requests this is sent to
    // Telegram as the `startgroup` parameter and comes back to us in the
    // bot's /start message. For channel requests Telegram does NOT let us
    // pass a parameter at all (see README-ADD-BOT.md) so we fall back to
    // matching on telegramUserId instead — the token is still stored for
    // status polling from the frontend.
    token: { type: String, required: true, unique: true, index: true },

    // Website session/account that initiated the request.
    websiteUserId: { type: String, required: true, index: true },

    // Telegram numeric user id of the person performing the action,
    // captured via the Telegram Login Widget before the deep link is
    // generated. Required for channel requests; optional (but still
    // recorded when we have it) for group requests.
    telegramUserId: { type: Number, index: true },

    type: { type: String, enum: ["channel", "group"], required: true },

    // The chatAdminRights permission keys we asked Telegram to grant,
    // e.g. ["post_messages", "delete_messages", "invite_users"].
    requestedPermissions: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["pending", "verified", "failed", "expired"],
      default: "pending",
      index: true,
    },

    // Filled in once we get a real confirming update from Telegram.
    chatId: { type: Number, default: null },
    chatTitle: { type: String, default: null },
    chatType: { type: String, default: null }, // "channel" | "supergroup" | "group"
    grantedPermissions: { type: [String], default: [] },

    failureReason: { type: String, default: null },

    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// Requests older than their expiry are useless for matching — TTL-clean
// them out of Mongo automatically 24h after they expire.
PendingBotAddSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 }
);

export default mongoose.models.PendingBotAdd ||
  mongoose.model("PendingBotAdd", PendingBotAddSchema);

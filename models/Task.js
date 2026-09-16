import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema(
  {
    ownerTelegramId: { type: Number, required: true, index: true },

    type: {
      type: String,
      enum: ["channel", "group", "views", "bot", "boost", "reactions"],
      required: true,
    },

    // Telegram chat id / username of the channel or group being promoted
    targetChatId: { type: String, required: true },
    targetChatTitle: String,
    targetChatUsername: String,
    // Always resolved at publish time so the "Subscribe" button in the earn
    // list always has a working link, even for private chats with no
    // @username (see resolveInviteLink in bot.js).
    targetInviteLink: String,

    // Regular invite link (members join instantly) vs join-request link
    // (owner must approve; worker is paid as soon as they submit the request).
    linkType: {
      type: String,
      enum: ["regular", "join_request"],
      default: "regular",
    },

    // Who the task is shown to. "premium_only" and a non-empty `languages`
    // list both raise the minimum price per completion (see PRICE constants
    // in bot.js) — narrower audiences complete slower, so they cost more.
    audienceMode: {
      type: String,
      enum: ["all", "premium_only"],
      default: "all",
    },
    languages: { type: [String], default: [] },

    // How the task creation cost was paid.
    paymentMethod: {
      type: String,
      enum: ["gram", "stars"],
      default: "gram",
    },

    // Coins paid to a user for each completion
    pricePerAction: { type: Number, required: true },

    // Total subscribers/views requested and how many completed so far
    goalCount: { type: Number, required: true },
    completedCount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["active", "paused", "completed", "deleted"],
      default: "active",
    },

    // Users who already completed this task (so it can't be farmed twice,
    // unless the task is deleted and recreated per the stated rule)
    completedBy: [{ type: Number }],
  },
  { timestamps: true }
);

TaskSchema.index({ type: 1, status: 1, pricePerAction: -1 });

export default mongoose.models.Task || mongoose.model("Task", TaskSchema);

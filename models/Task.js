import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema(
  {
    ownerTelegramId: { type: Number, required: true, index: true },

    // Human-friendly sequential id shown as "📋 Task #1,888,085". Assigned
    // from the shared Counter at publish time (older tasks get one lazily
    // the first time their owner opens them), purely cosmetic.
    taskNumber: { type: Number, index: true },

    // How many completions were reversed because the worker unsubscribed
    // inside the minimum-stay window — shown as "Refunded for unsubscribes".
    refundedCount: { type: Number, default: 0 },

    // Per-task notification switch (👤 owner gets progress/report alerts).
    notifyOwner: { type: Boolean, default: true },

    type: {
      type: String,
      enum: ["channel", "group", "views", "bot", "boost", "reactions"],
      required: true,
    },

    // For "reactions" tasks only: whether the worker may react with any
    // emoji ("any") or must use the one specific emoji the owner picked
    // ("fixed") — mirrors the "Any reactions / Fixed reactions" choice
    // shown when a worker opens the ❤️ Reactions earn category.
    reactionType: {
      type: String,
      enum: ["any", "fixed"],
      default: "any",
    },
    // The specific emoji required when reactionType is "fixed".
    fixedReactionEmoji: { type: String },

    // Telegram chat id / username of the channel or group being promoted
    targetChatId: { type: String, required: true },
    targetChatTitle: String,
    targetChatUsername: String,
    // Always resolved at publish time so the "Subscribe" button in the earn
    // list always has a working link, even for private chats with no
    // @username (see resolveInviteLink in bot.js).
    targetInviteLink: String,

    // For "views" (post promotion) tasks only: the exact post inside
    // targetChatId that workers are shown. The bot forwards THIS message
    // from the original channel to each worker — which is the whole reason
    // the bot must be an admin in that channel before the task is created.
    targetMessageId: { type: Number },

    // Reports filed by workers who saw the post (adult/inappropriate
    // content, scam, etc). After REPORT_AUTO_PAUSE reports the task is
    // paused automatically and the owner is notified.
    reportCount: { type: Number, default: 0 },
    reports: [
      {
        telegramId: { type: Number, required: true },
        reason: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

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

    // Per-completion records used to enforce the "must stay subscribed at
    // least 7 days" rule for channel/group tasks. When the chat_member
    // handler in bot.js sees this user leave/get kicked from targetChatId
    // before MIN_STAY_MS has passed since completedAt, it claws back
    // pricePerAction from the worker and returns it to the task owner, then
    // marks the record `settled` so it's only ever evaluated once.
    completions: [
      {
        telegramId: { type: Number, required: true },
        completedAt: { type: Date, default: Date.now },
        settled: { type: Boolean, default: false },
      },
    ],
  },
  { timestamps: true }
);

TaskSchema.index({ type: 1, status: 1, pricePerAction: -1 });
TaskSchema.index({ targetChatId: 1, "completions.telegramId": 1, "completions.settled": 1 });

export default mongoose.models.Task || mongoose.model("Task", TaskSchema);

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

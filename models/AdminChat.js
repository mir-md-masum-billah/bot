import mongoose from "mongoose";

// Records every channel/group the bot has been made an admin of, and by
// whom. Created automatically from the `my_chat_member` Telegram update
// the moment someone grants the bot admin rights — no manual "I've added
// it" confirmation needed.
const AdminChatSchema = new mongoose.Schema(
  {
    ownerTelegramId: { type: Number, required: true, index: true },

    chatId: { type: String, required: true },
    chatType: { type: String, enum: ["channel", "group"], required: true },
    chatTitle: String,
    chatUsername: String,

    // Admin rights Telegram reported the bot was actually granted
    // (subset of post_messages/edit_messages/delete_messages/invite_users/manage_chat).
    permissions: [{ type: String }],

    // "active" while the bot is still admin there; flipped to "removed" if
    // the bot is demoted/kicked (also tracked via my_chat_member).
    status: { type: String, enum: ["active", "removed"], default: "active" },

    addedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

AdminChatSchema.index({ ownerTelegramId: 1, chatId: 1 }, { unique: true });

export default mongoose.models.AdminChat ||
  mongoose.model("AdminChat", AdminChatSchema);

import mongoose from "mongoose";

// Every channel/group the bot has ever been added to. Populated by the
// `my_chat_member` update in bot.js (fires whenever the bot itself is
// added, removed, or promoted somewhere). This is the ONLY list of chats
// the bot can know about — there is no Bot API call that returns "every
// chat a given user administers", so any "pick from a list" UI has to be
// built from chats the bot has already joined, not from the user's full
// Telegram account.
const ChatSchema = new mongoose.Schema(
  {
    chatId: { type: String, required: true, unique: true, index: true },
    type: { type: String, enum: ["channel", "group"], required: true },
    title: String,
    username: String,

    // True while the bot is still a member/admin there. Set false when the
    // bot is kicked or leaves, so it drops out of the picker lists without
    // deleting history.
    isBotActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export default mongoose.models.Chat || mongoose.model("Chat", ChatSchema);

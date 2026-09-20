import mongoose from "mongoose";

// Scratch pad used while an advertiser forwards a channel post that contains
// several pictures. Telegram delivers such a post as N separate messages that
// share one `media_group_id`, and on Vercel every message is handled by its own
// serverless invocation — so the only place they can meet is the database.
// One document per (user, media_group_id); each incoming part adds its channel
// message id, and the invocation that created the document waits a moment and
// then reads the complete list; parts that arrive later are added too, and the
// list is read once more when the task is published. Documents live for an
// hour at most (TTL below) and are deleted as soon as the task is created.
const PostAlbumSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true },
  mediaGroupId: { type: String, required: true },
  chatId: { type: String },
  messageIds: { type: [Number], default: [] },
  createdAt: { type: Date, default: Date.now, expires: 3600 },
});

PostAlbumSchema.index({ telegramId: 1, mediaGroupId: 1 }, { unique: true });

export default mongoose.models.PostAlbum || mongoose.model("PostAlbum", PostAlbumSchema);

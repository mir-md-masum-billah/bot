import crypto from "crypto";

const BOT_TOKEN = process.env.BOT_TOKEN;
const BOT_USERNAME = process.env.BOT_USERNAME;

if (!BOT_TOKEN || !BOT_USERNAME) {
  throw new Error(
    "BOT_TOKEN and BOT_USERNAME must be set in your environment (see .env.example)."
  );
}

// ---------------------------------------------------------------------
// Admin rights your bot actually needs. These are chatAdminRights keys
// as defined by Telegram (core.telegram.org/api/links#group-channel-bot-links).
// Tune these to what your bot really does — asking for more than you use
// makes users distrust the prompt, and Telegram shows every one of these
// in the confirmation dialog.
// ---------------------------------------------------------------------
export const CHANNEL_ADMIN_PERMISSIONS = [
  "change_info",
  "post_messages",
  "edit_messages",
  "delete_messages",
  "invite_users",
  "pin_messages",
];

export const GROUP_ADMIN_PERMISSIONS = [
  "change_info",
  "delete_messages",
  "restrict_members",
  "invite_users",
  "pin_messages",
];

// Maps a chatAdminRights key (used in the `admin=` deep-link parameter)
// to the corresponding boolean field Telegram returns on a
// ChatMemberAdministrator object from getChatMember / my_chat_member
// updates, so we can verify what was *actually* granted rather than
// trusting what we asked for.
export const ADMIN_RIGHT_TO_BOT_API_FIELD = {
  change_info: "can_change_info",
  post_messages: "can_post_messages",
  edit_messages: "can_edit_messages",
  delete_messages: "can_delete_messages",
  restrict_members: "can_restrict_members",
  invite_users: "can_invite_users",
  pin_messages: "can_pin_messages",
  manage_topics: "can_manage_topics",
  promote_members: "can_promote_members",
  manage_video_chats: "can_manage_video_chats",
  anonymous: "is_anonymous",
  manage_chat: "can_manage_chat",
  post_stories: "can_post_stories",
  edit_stories: "can_edit_stories",
  delete_stories: "can_delete_stories",
};

export function generateToken() {
  // base64url, well under Telegram's 64-character limit for start params.
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Builds the official Telegram deep link for adding the bot to a group,
 * with a token we can match back to our PendingBotAdd record once the
 * bot receives the resulting /start message in that group.
 */
export function buildGroupAddLink(token) {
  const admin = GROUP_ADMIN_PERMISSIONS.join("+");
  return `https://t.me/${BOT_USERNAME}?startgroup=${encodeURIComponent(
    token
  )}&admin=${admin}`;
}

/**
 * Builds the official Telegram deep link for adding the bot to a channel.
 * NOTE: Telegram does not support a parameter on channel links at all —
 * `startchannel` cannot carry a token. Matching for channels is done via
 * telegramUserId instead (see pages/api/telegram/create-request.js).
 */
export function buildChannelAddLink() {
  const admin = CHANNEL_ADMIN_PERMISSIONS.join("+");
  return `https://t.me/${BOT_USERNAME}?startchannel&admin=${admin}`;
}

/**
 * Verifies the payload posted back by the Telegram Login Widget.
 * Per https://core.telegram.org/widgets/login#checking-authorization
 *
 * `data` is the object the widget's callback receives (id, first_name,
 * username, photo_url, auth_date, hash, ...).
 */
export function verifyTelegramLoginPayload(data, maxAgeSeconds = 86400) {
  const { hash, ...rest } = data;
  if (!hash) return { ok: false, reason: "missing_hash" };

  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${rest[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(BOT_TOKEN).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  if (computedHash !== hash) {
    return { ok: false, reason: "bad_hash" };
  }

  const authDate = Number(rest.auth_date);
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }

  return { ok: true, telegramUserId: Number(rest.id), profile: rest };
}

export { BOT_USERNAME, BOT_TOKEN };

import { dbConnect } from "../../../lib/db.js";
import PendingBotAdd from "../../../models/PendingBotAdd.js";
import {
  generateToken,
  buildGroupAddLink,
  buildChannelAddLink,
  GROUP_ADMIN_PERMISSIONS,
  CHANNEL_ADMIN_PERMISSIONS,
} from "../../../lib/telegramBotAdd.js";

const REQUEST_TTL_MS = 15 * 60 * 1000; // 15 minutes

// ---------------------------------------------------------------------
// TODO: replace this with your real session lookup (cookie/JWT/etc).
// It must return { websiteUserId, telegramUserId } where telegramUserId
// is the numeric Telegram id captured earlier via the Login Widget
// (pages/api/telegram/login.js) — null if the user hasn't connected
// Telegram yet.
// ---------------------------------------------------------------------
async function getSessionUser(req) {
  // Example if you store it in a cookie/session object already:
  // const session = await getIronSession(req, res, sessionOptions);
  // return { websiteUserId: session.userId, telegramUserId: session.telegramUserId };
  throw new Error(
    "getSessionUser() is a placeholder — wire this up to your actual auth."
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { type } = req.body || {};
  if (type !== "channel" && type !== "group") {
    res.status(400).json({ error: "type must be 'channel' or 'group'" });
    return;
  }

  let sessionUser;
  try {
    sessionUser = await getSessionUser(req);
  } catch (err) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  const { websiteUserId, telegramUserId } = sessionUser;

  // Channel requests can only ever be matched via telegramUserId (Telegram
  // gives us no parameter on channel deep links), so we require the user
  // to have connected their Telegram account first.
  if (type === "channel" && !telegramUserId) {
    res.status(400).json({
      error: "telegram_not_connected",
      message:
        "Connect your Telegram account first (Telegram Login Widget) before adding the bot to a channel.",
    });
    return;
  }

  await dbConnect();

  // Rate-limit: don't let one user pile up unlimited pending requests.
  const openCount = await PendingBotAdd.countDocuments({
    websiteUserId,
    status: "pending",
    expiresAt: { $gt: new Date() },
  });
  if (openCount >= 5) {
    res.status(429).json({ error: "Too many pending requests, try again shortly." });
    return;
  }

  const token = generateToken();
  const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);

  const pending = await PendingBotAdd.create({
    token,
    websiteUserId,
    telegramUserId: telegramUserId || null,
    type,
    requestedPermissions:
      type === "channel" ? CHANNEL_ADMIN_PERMISSIONS : GROUP_ADMIN_PERMISSIONS,
    status: "pending",
    expiresAt,
  });

  const deepLink =
    type === "channel" ? buildChannelAddLink() : buildGroupAddLink(token);

  res.status(200).json({
    token: pending.token,
    deepLink,
    expiresAt: pending.expiresAt,
  });
}

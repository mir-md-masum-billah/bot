import crypto from "crypto";
import { dbConnect } from "../../lib/db.js";
import User from "../../models/User.js";

// Why this endpoint exists:
// Telegram.WebApp.sendData() — which the old flow relied on to report a
// solved puzzle back to the bot — only works for Mini Apps opened from a
// *reply keyboard* button. Our "Verify" button is an *inline keyboard*
// web_app button (so it can sit right under the task, not take over the
// keyboard), and for that kind of button Telegram silently does nothing
// with sendData(): no web_app_data update is ever produced, so the bot
// never found out verification happened. That's why the puzzle showed
// "Perfect!" but the bot still said "Please tap Verify first."
//
// The fix Telegram itself documents for this case: have the Mini App call
// your own backend directly with Telegram.WebApp.initData, verify that
// Telegram really signed it, and update the user's state server-side.
// No dependency on any Telegram-relayed message at all.
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "method_not_allowed" });
    return;
  }

  const { initData } = req.body || {};
  if (!initData || typeof initData !== "string") {
    res.status(400).json({ ok: false, error: "missing_init_data" });
    return;
  }

  const botToken = process.env.BOT_TOKEN;
  if (!botToken) {
    console.error("/api/verify: BOT_TOKEN not set");
    res.status(500).json({ ok: false, error: "server_misconfigured" });
    return;
  }

  const result = validateInitData(initData, botToken);
  if (!result.valid) {
    res.status(401).json({ ok: false, error: result.reason });
    return;
  }

  try {
    await dbConnect();
    await User.findOneAndUpdate(
      { telegramId: result.user.id },
      { $set: { isVerified: true, tasksSinceVerification: 0 } },
      { upsert: false }
    );
  } catch (e) {
    console.error("/api/verify: failed to update user", e);
    res.status(500).json({ ok: false, error: "db_error" });
    return;
  }

  res.status(200).json({ ok: true });
}

// Validates initData per Telegram's spec:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function validateInitData(initData, botToken) {
  let params;
  try {
    params = new URLSearchParams(initData);
  } catch (e) {
    return { valid: false, reason: "unparseable" };
  }

  const hash = params.get("hash");
  if (!hash) return { valid: false, reason: "missing_hash" };
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (computedHash !== hash) return { valid: false, reason: "bad_signature" };

  // Reject stale init data (e.g. a screenshot/replay of an old session).
  const authDate = Number(params.get("auth_date") || 0);
  const MAX_AGE_SECONDS = 24 * 60 * 60;
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) {
    return { valid: false, reason: "expired" };
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "null");
  } catch (e) {
    user = null;
  }
  if (!user || !user.id) return { valid: false, reason: "missing_user" };

  return { valid: true, user };
}

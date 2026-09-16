import { verifyTelegramLoginPayload } from "../../../lib/telegramBotAdd.js";

// TODO: same placeholder as create-request.js — plug in your real
// session read/write here.
async function getSessionUser(req) {
  throw new Error("wire this up to your actual auth/session layer");
}
async function saveTelegramIdToSession(req, res, telegramUserId, profile) {
  // e.g. session.telegramUserId = telegramUserId; await session.save();
  // Also a good place to upsert this onto your User collection if you
  // keep one keyed by websiteUserId.
  throw new Error("wire this up to your actual auth/session layer");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const result = verifyTelegramLoginPayload(req.body || {});
  if (!result.ok) {
    res.status(401).json({ error: "invalid_telegram_login", reason: result.reason });
    return;
  }

  try {
    await getSessionUser(req);
    await saveTelegramIdToSession(req, res, result.telegramUserId, result.profile);
  } catch (err) {
    res.status(401).json({ error: "Not authenticated on the website" });
    return;
  }

  res.status(200).json({ ok: true, telegramUserId: result.telegramUserId });
}

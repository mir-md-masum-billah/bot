import { isAuthed } from "../../../../lib/adminAuth.js";
import { bot } from "../../../../bot/bot.js";

// Telegram file_ids aren't public URLs — the admin dashboard can't just
// <img src> them. This resolves the file_id to Telegram's temporary CDN
// link server-side (so BOT_TOKEN never reaches the browser) and redirects
// the browser straight to it.
export default async function handler(req, res) {
  if (!isAuthed(req)) {
    res.status(401).end();
    return;
  }
  const { fileId } = req.query;
  try {
    const link = await bot.telegram.getFileLink(fileId);
    res.writeHead(302, { Location: link.href || link.toString() });
    res.end();
  } catch (e) {
    res.status(404).end();
  }
}

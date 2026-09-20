import { isAuthed } from "../../../../lib/adminAuth.js";
import { bot } from "../../../../bot/bot.js";

// Telegram file_ids aren't public URLs. This resolves the file_id server-side
// and STREAMS the image bytes back to the dashboard. (It used to redirect to
// Telegram's file link, but that link contains BOT_TOKEN — so the token was
// visible in the browser. Proxying keeps it on the server.)
// Used for submission screenshots AND report screenshots.
export default async function handler(req, res) {
  if (!isAuthed(req)) {
    res.status(401).end();
    return;
  }
  const { fileId } = req.query;
  if (typeof fileId !== "string" || fileId.length > 300) {
    res.status(400).end();
    return;
  }
  try {
    const link = await bot.telegram.getFileLink(fileId);
    const url = link.href || link.toString();
    const upstream = await fetch(url);
    if (!upstream.ok) {
      res.status(404).end();
      return;
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    // Telegram often labels files application/octet-stream — go by extension.
    const ext = (url.split("?")[0].split(".").pop() || "").toLowerCase();
    const byExt = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
    const upType = upstream.headers.get("content-type") || "";
    res.setHeader("Content-Type", byExt[ext] || (upType.startsWith("image/") ? upType : "image/jpeg"));
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.status(200).send(buf);
  } catch (e) {
    res.status(404).end();
  }
}

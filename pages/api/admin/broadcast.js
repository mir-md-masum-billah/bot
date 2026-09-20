import { withAdmin, HttpError, cleanStr } from "../../../lib/adminApi.js";
import { logAdmin } from "../../../lib/adminLog.js";
import { dmUser } from "../../../lib/adminNotify.js";
import User from "../../../models/User.js";

// Announcements to bot users, sent in small batches so a serverless request
// never runs out of time. The dashboard keeps calling this with the returned
// `nextCursor` until `done` is true.
//
// GET  ?respectMute=1            -> { audience }  how many people would get it
// POST { message, testTo }       -> send ONLY to that Telegram id (preview)
// POST { message, cursor, respectMute, totals } -> next batch
export const config = { maxDuration: 60 };

const BATCH = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function audienceFilter(respectMute) {
  const f = { isBanned: { $ne: true } };
  if (respectMute) f.notificationsEnabled = { $ne: false };
  return f;
}

export default withAdmin(async (req, res) => {
  if (req.method === "GET") {
    const audience = await User.countDocuments(audienceFilter(req.query.respectMute !== "0"));
    res.status(200).json({ audience });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).end();
    return;
  }

  const { message, testTo, cursor = 0, respectMute = true, totals } = req.body || {};
  const text = cleanStr(message, 3500);
  if (!text) throw new HttpError(400, "Message is empty");

  if (testTo) {
    const r = await dmUser(Number(testTo), `📢 ${text}`);
    res.status(200).json({ ok: r.ok, error: r.error });
    return;
  }

  const start = Number(cursor) || 0;
  const filter = { ...audienceFilter(respectMute), telegramId: { $gt: start } };
  const users = await User.find(filter).sort({ telegramId: 1 }).limit(BATCH).select("telegramId").lean();

  if (start === 0) {
    const audience = await User.countDocuments(audienceFilter(respectMute));
    await logAdmin(req, "broadcast.start", {
      targetType: "broadcast",
      summary: `Broadcast started to ${audience.toLocaleString()} users: ${text.slice(0, 120)}`,
      details: { audience, respectMute, message: text },
    });
  }

  let sent = 0;
  let failed = 0;
  for (const u of users) {
    const r = await dmUser(u.telegramId, `📢 ${text}`);
    if (r.ok) sent += 1;
    else failed += 1;
    await sleep(40); // stay well under Telegram's ~30 msg/s limit
  }

  const done = users.length < BATCH;
  const nextCursor = users.length ? users[users.length - 1].telegramId : start;

  if (done) {
    const total = {
      sent: (Number(totals?.sent) || 0) + sent,
      failed: (Number(totals?.failed) || 0) + failed,
    };
    await logAdmin(req, "broadcast.done", {
      targetType: "broadcast",
      summary: `Broadcast finished: ${total.sent.toLocaleString()} delivered, ${total.failed.toLocaleString()} failed`,
      details: total,
    });
  }

  res.status(200).json({ ok: true, sent, failed, nextCursor, done });
});

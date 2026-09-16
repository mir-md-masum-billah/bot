import { bot } from "../../../bot/bot.js";

export const config = {
  api: {
    bodyParser: true,
  },
  // Vercel functions default to 10s; the bot does several sequential
  // Telegram + MongoDB round-trips per update, so give it real headroom.
  // (Hobby caps at 60s, Pro allows more.)
  maxDuration: 60,
};

export default async function handler(req, res) {
  // Only accept requests that include the correct secret path segment,
  // so random internet traffic can't feed fake updates to the bot.
  if (req.query.secret !== process.env.WEBHOOK_SECRET) {
    res.status(404).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(200).send("Webhook is alive");
    return;
  }

  // Vercel's runtime logs only record the request line, so a hung or failing
  // update is otherwise anonymous. Logging the id + kind up front means the
  // next timeout can be traced to an actual handler.
  const update = req.body || {};
  const kind = Object.keys(update).find((k) => k !== "update_id") || "unknown";
  const startedAt = Date.now();
  console.log(`Update ${update.update_id} (${kind}) received`);

  try {
    // NOTE: `res` is deliberately NOT passed to handleUpdate. Passing it turns
    // on Telegraf's webhook-reply mode, which ends the HTTP response early and
    // gets the serverless function frozen while the handler is still running.
    // Finish the work first, then answer Telegram with a plain 200.
    await bot.handleUpdate(update);
    console.log(`Update ${update.update_id} (${kind}) done in ${Date.now() - startedAt}ms`);
  } catch (err) {
    console.error(`Webhook error on update ${update.update_id} (${kind}):`, err);
  }

  if (!res.writableEnded) res.status(200).end();
}

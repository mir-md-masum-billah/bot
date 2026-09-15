import { bot } from "../../../bot/bot.js";

export const config = {
  api: {
    bodyParser: true,
  },
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

  try {
    await bot.handleUpdate(req.body, res);
  } catch (err) {
    console.error("Webhook error:", err);
  }

  if (!res.writableEnded) res.status(200).end();
}

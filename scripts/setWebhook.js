// Run this once after each deploy: `node -r dotenv/config scripts/setWebhook.js`
// Requires BOT_TOKEN, PUBLIC_URL, and WEBHOOK_SECRET in your environment (.env or shell).
import https from "https";

const { BOT_TOKEN, PUBLIC_URL, WEBHOOK_SECRET } = process.env;

if (!BOT_TOKEN || !PUBLIC_URL || !WEBHOOK_SECRET) {
  console.error(
    "Missing env vars. Make sure BOT_TOKEN, PUBLIC_URL and WEBHOOK_SECRET are set " +
      "(e.g. run with `node -r dotenv/config scripts/setWebhook.js`)."
  );
  process.exit(1);
}

const webhookUrl = `${PUBLIC_URL}/api/webhook/${WEBHOOK_SECRET}`;

// Telegram's default update set (used when allowed_updates is omitted)
// excludes "chat_member" — and "chat_join_request" only arrives once it's
// been requested at least once. Both are required here: chat_member drives
// the 7-day-minimum-stay clawback, and chat_join_request drives auto-approval
// of join-request links. Everything the bot already relied on (messages,
// button taps, payments, the request_chat/chat_shared picker, the
// verification WebApp) is covered by the other entries below.
const allowedUpdates = [
  "message",
  "edited_message",
  "callback_query",
  "pre_checkout_query",
  "chat_join_request",
  "chat_member",
  "my_chat_member",
];
const apiUrl =
  `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}` +
  `&allowed_updates=${encodeURIComponent(JSON.stringify(allowedUpdates))}`;

https
  .get(apiUrl, (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      console.log("Telegram response:", data);
      console.log("Webhook set to:", webhookUrl);
    });
  })
  .on("error", (err) => {
    console.error("Failed to set webhook:", err);
  });

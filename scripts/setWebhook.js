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
const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(
  webhookUrl
)}`;

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

# Telegram Promotion Bot (PR GRAM style)

A mutual-promotion Telegram bot: users spend coins to promote their channel/group/bot,
and earn coins by subscribing to others'. Built with **Next.js + MongoDB (Mongoose) +
Telegraf**, deployable on **Vercel** or **Railway**, with a built-in **admin dashboard**.

## What's included

- `bot/bot.js` — all bot logic (menus, promote flow, earn flow, subscription
  verification via `getChatMember`, coin balances, commission).
- `pages/api/webhook/[secret].js` — webhook endpoint Telegram sends updates to.
- `models/` — Mongoose schemas: `User`, `Task`, `Transaction`.
- `pages/admin/` + `pages/api/admin/` — password-protected admin dashboard
  (view/pause/delete tasks, view/ban users, adjust balances).
- `scripts/setWebhook.js` — one-command script to register your webhook URL with Telegram.

## 1. Prerequisites

- A Telegram bot token from **[@BotFather](https://t.me/BotFather)** (`/newbot`).
- A free **MongoDB Atlas** cluster → get its connection string.
- Node.js 18+ installed locally (only needed if you want to test locally).

## 2. Configure environment variables

Copy `.env.example` to `.env` and fill in real values:

```
BOT_TOKEN=...           # from BotFather
MONGODB_URI=...         # from MongoDB Atlas
PUBLIC_URL=...          # your deployed URL, filled in AFTER first deploy
WEBHOOK_SECRET=...      # any random string, keep it secret
ADMIN_USERNAME=...      # dashboard login
ADMIN_PASSWORD=...      # dashboard login
EARNED_COMMISSION_PERCENT=10
```

## 3. Deploy — Option A: Vercel

1. Push this project to a GitHub repo.
2. On [vercel.com](https://vercel.com), import the repo.
3. Add all variables from `.env` in **Project Settings → Environment Variables**.
   For `PUBLIC_URL`, use the `*.vercel.app` domain Vercel gives you (or your custom domain).
4. Deploy.
5. Register the webhook (run once, from your own machine, with the same env vars set):
   ```bash
   npm install
   node -r dotenv/config scripts/setWebhook.js
   ```
   Or simply visit this URL in your browser once (replace the placeholders):
   ```
   https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<PUBLIC_URL>/api/webhook/<WEBHOOK_SECRET>
   ```
6. Open your bot on Telegram and send `/start`.

**Note:** Vercel's free plan has execution timeouts — fine for this bot since every
action is a quick DB read/write and one Telegram API call.

## 4. Deploy — Option B: Railway

Railway works the same way since this project always runs in webhook mode (no long
polling), which is what makes it deployable on a serverless platform in the first place:

1. Push to GitHub, then **New Project → Deploy from GitHub repo** on
   [railway.app](https://railway.app).
2. Add the same environment variables in **Variables**.
3. Railway auto-detects Next.js and runs `npm run build && npm run start`.
4. Set `PUBLIC_URL` to the Railway-provided domain (or your custom domain).
5. Run the webhook registration step exactly as in the Vercel section above.

## 5. Using the bot

- `/start` → shows the main menu: **Promote**, **Earn**, **My Cabinet**, **Balance**.
- **Promote** → pick a type (channel/group/views/bot/boost) → set price per completion →
  pick subscriber/view count → forward a message from the target chat (or send its
  `@username`) after adding the bot as **admin** there → task goes live.
- **Earn** → pick a category → bot shows one open task → user joins/subscribes → taps
  **Check** → bot verifies membership via the Telegram API and credits coins.
- **My Cabinet → My Tasks** → pause / resume / delete your own tasks. Deleting a task
  refunds the unused coin balance to your account (matches the platform's stated
  behavior: users who already completed a deleted task keep their reward, and won't be
  paid again if you recreate the same task).
- Coins earned by completing tasks (not bought/donated) incur the commission set in
  `EARNED_COMMISSION_PERCENT` when spent on a new promotion task — same donated-vs-earned
  split PR GRAM describes.

## 6. Admin dashboard

Visit `https://<your-domain>/admin` → log in with `ADMIN_USERNAME` / `ADMIN_PASSWORD`.

- **Tasks tab** — see every task, its owner, progress, pause/resume/delete any task.
- **Users tab** — see every user's balances, ban/unban accounts.

## 7. Important limitations to know about

- **Views/Bot task types can't be verified automatically** — Telegram's API has no way
  to confirm a "view" or a bot interaction the way `getChatMember` confirms a channel
  subscription. The bot currently auto-approves these on tap; if you want real
  anti-fraud here, you'll need either manual admin review or a bot-specific callback
  (e.g. requiring the promoted bot to report back via a shared API key).
- **Public channels/groups only work smoothly with `@username`.** Private chats need
  the user to forward an actual message so the bot can capture the numeric chat ID.
- **The bot must be an admin** in any chat it promotes or verifies — this matches the
  original platform's requirement and is unavoidable, since Telegram only exposes
  membership info to bots that are admins of that chat.
- This is a **functional starting point**, not a hardened production system — before
  handling real payments, add rate limiting, stronger fraud detection (e.g. IP/device
  fingerprinting is not available via Telegram, but repeated join/leave patterns can be
  flagged), and proper logging/monitoring.

## 8. Local development

```bash
npm install
npm run dev          # runs the Next.js app at http://localhost:3000
```

For local bot testing you'll need a public HTTPS tunnel (e.g. `ngrok http 3000`) since
Telegram can't reach `localhost` — set `PUBLIC_URL` to the ngrok URL and re-run the
webhook script whenever the tunnel URL changes.
# bot

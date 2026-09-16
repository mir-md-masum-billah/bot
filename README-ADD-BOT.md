# "Add Bot to Channel / Group" ফিচার — Integration Guide

## যা যাচাই করা হয়েছে (official source: core.telegram.org/api/links)

- **Group:** `t.me/<bot_username>?startgroup=<token>&admin=<permissions>`
  → Telegram-এর native "Choose a Group" dialog খোলে। `admin` parameter দিলে
  dialog-এ শুধু সেই group-গুলোই দেখায় যেখানে user admin add/edit করতে পারে।
  Token পাঠানো যায় এবং bot add হওয়ার পর সেটা bot-এর কাছে `/start <token>`
  message হিসেবে ওই group-এ আসে।

- **Channel:** `t.me/<bot_username>?startchannel&admin=<permissions>`
  → Telegram-এর native "Choose a Channel" dialog খোলে (শুধু সেই channel-গুলো
  যেখানে user admin permission রাখে)। **এখানে কোনো token/parameter পাঠানো যায়
  না** — এটা Telegram-এর নিজস্ব সীমাবদ্ধতা, কোনো workaround নেই। তাই channel
  request-কে ওয়েবসাইট user-এর সাথে মেলাতে হয় Telegram user id দিয়ে — এই কারণেই
  Telegram Login Widget লাগছে।

দুটোই fake/custom chat list না — আসল Telegram client-এর নিজের selector। Website
শুধু সঠিক deep link বানিয়ে `window.open` করছে, chat list কোথাও নিজে দেখাচ্ছে না।

## Env vars (.env)

আপনার `.env.example`-এ `BOT_TOKEN` আর `BOT_USERNAME` আগে থেকেই আছে, সেগুলোই
ব্যবহার হচ্ছে। নতুন যোগ করুন:

```
# Frontend থেকে deep link বানাতে (public, secret না)
NEXT_PUBLIC_BOT_USERNAME=your_bot_username
```

## Files যা যোগ হলো

```
models/PendingBotAdd.js         — pending request-এর record
lib/telegramBotAdd.js           — admin rights config, deep link builder, login-widget verifier
bot/addBotHandlers.js           — Telegraf handlers (verification)
pages/api/telegram/create-request.js
pages/api/telegram/status/[token].js
pages/api/telegram/login.js
pages/add-bot.js                — frontend selection screen
```

## bot/bot.js-এ যা যোগ করতে হবে

`registerAddBotHandlers` import করে, আপনার existing `bot.start(...)`
handler-এর **আগে** call করুন — এটা শুধু non-private chat-এর `/start <token>`
ধরে, private chat হলে `next()` কল করে আপনার আসল DM flow-তে চলে যায়, তাই আপনার
বর্তমান bot logic একদম অক্ষত থাকবে:

```js
// bot/bot.js — শীর্ষের import-গুলোর সাথে
import { registerAddBotHandlers } from "./addBotHandlers.js";

// export const bot = new Telegraf(...) এর ঠিক পরে, আপনার
// bot.start(...) call করার আগে:
registerAddBotHandlers(bot);
```

## Auth placeholder

`pages/api/telegram/create-request.js` এবং `pages/api/telegram/login.js`-এ
`getSessionUser(req)` একটা placeholder — এটা throw করে যতক্ষণ না আপনি আপনার
আসল session/auth logic দিয়ে বদলাচ্ছেন। এটা `{ websiteUserId, telegramUserId }`
রিটার্ন করবে বলে ধরে নেওয়া হয়েছে (`telegramUserId` = Login Widget দিয়ে আগে
capture করা, না থাকলে `null`)।

## BotFather-এ যা লাগবে

1. `@BotFather` → `/setdomain` দিয়ে আপনার ওয়েবসাইট domain সেট করুন — Login
   Widget এটা ছাড়া কাজ করবে না (localhost-এ টেস্ট করতে ngrok/একটা real HTTPS
   domain লাগবে)।
2. Group-এ bot add করার জন্য কিছু লাগে না (default off থাকে না)। তবে bot-কে
   group-এ privacy mode বন্ধ করা প্রয়োজন হতে পারে যদি সব message পড়তে হয়
   (`/setprivacy`) — এটা আপনার bot-এর কাজের উপর নির্ভর করে।

## Security / validation যা এখানে আছে

- Token random ২৪ bytes (base64url), ১৫ মিনিট পর expire, Mongo TTL index
  দিয়ে auto-cleanup।
- **কোনো update-কে blind trust করা হয় না** — bot add হওয়ার signal পাওয়ার পরও
  আলাদা করে `getChatMember` কল করে live rights যাচাই করা হয়, শুধু update
  payload-এর উপর ভরসা করা হয় না।
- Telegram Login Widget-এর hash `HMAC-SHA256(secret=SHA256(BOT_TOKEN))`
  দিয়ে যাচাই করা হয় (official spec অনুযায়ী), আর `auth_date` ২৪ ঘণ্টার বেশি
  পুরনো হলে reject করা হয়।
- Channel request telegramUserId ছাড়া তৈরিই হয় না — মানে user নিজে Telegram
  দিয়ে verify না করে কোনো channel-request শুরু করতেই পারবে না।
- Per-user rate limit: একসাথে ৫টার বেশি pending request থাকতে পারবে না।
- Webhook route-এ আগে থেকেই `WEBHOOK_SECRET` check আছে (আপনার
  `pages/api/webhook/[secret].js`) — সেটা অক্ষত রাখা হয়েছে।

## সীমাবদ্ধতা যা জেনে রাখা ভালো

- Channel flow-এ যদি একই user একসাথে একাধিক pending channel-request রাখে,
  সবচেয়ে সাম্প্রতিকটাই match হবে (কারণ channel link-এ token নেই) — তাই
  frontend-এ একবারে একটার বেশি channel-request active না রাখাই ভালো
  (`pages/add-bot.js`-এ এটা ইতিমধ্যে করা আছে)।
- Basic group থেকে bot add করার সময় Telegram সেটাকে supergroup-এ upgrade
  করে দিতে পারে — তখন chat id বদলে যায়। এটা কোড নিজে থেকেই handle করে, কারণ
  আমরা সবসময় update-এ আসা chat id ব্যবহার করছি, আলাদা কিছু করা লাগে না।

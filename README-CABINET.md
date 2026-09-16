# 👤 My Cabinet — PR GRAM স্টাইল (নতুন)

স্ক্রিনশট অনুযায়ী পুরো cabinet + task management ফ্লো বসানো হয়েছে।

## 1) My Cabinet স্ক্রিন

`👤 My Cabinet` চাপলে এখন এই মেসেজ আসে:

```
👤 Your Cabinet:

🆔 My ID: 6888516234
📈 Level: 🐣Novice 66/500 XP
💲 Balance: 17,474 GRAM
```

বাটন: `💳 Replenish Balance` · `👥 Referral System` · `📈 Level System` ·
`📋 My Tasks` · `🌐 Change Language` · `❌ Disable notifications` · `⬅️ Back`

- **Level System** — প্রতি completed task-এ `10 XP`। লেভেল: 🐣 Novice (0–500),
  🐤 Worker (500–2000), 🦅 Expert (2000–10000), 🐉 Master (10000+)।
  থ্রেশহোল্ড বদলাতে `bot/bot.js` এর `LEVELS` / `XP_PER_TASK` এডিট করলেই হবে।
- **Referral System** — `https://t.me/<bot>?start=ref_<your id>` লিংক + কতজন
  এসেছে। `/start`-এ payload ধরা হয় এবং `referredBy` একবারই সেট হয়।
- **Change Language** — পছন্দ `user.language`-এ সেভ হয় (বট টেক্সট এখনো
  ইংরেজি; অনুবাদ যোগ করলে এই ফিল্ড দিয়েই কাজ করবে)।
- **Disable notifications** — গ্লোবাল সুইচ, owner-alert বন্ধ করে।

## 2) My Tasks — task list

```
📋 Manage your tasks — In progress
```
প্রতি টাস্ক এক লাইনে: `▶️ 👥 3 - 1000 💰` (status · type · goal · price)।
নিচে `In progress | Finished | Paused` ফিল্টার ট্যাব, `➕ Create New Task`,
`⬅️ Back`।

## 3) টাস্কে ট্যাপ করলে — detail স্ক্রিন

```
📋 Task #1,888,085
Status: ▶️ In Progress
🔍 Task Details:
• 3 subscriptions
• Reward: 1,000 GRAM/unit
• Completed: 2/3
• Remaining: 1
• Refunded for unsubscribes: 0
🔗 👥 Group: Hsj

Access filters:
• Account type: All users
• Audience: All users
```

বাটনগুলো সবই কাজ করে:

| বাটন | কী করে |
|---|---|
| ➕ Add Execution | সংখ্যা চাইবে, ব্যালেন্স থেকে (কমিশনসহ) কেটে `goalCount` বাড়াবে |
| ⏸ Pause / ▶️ Resume | স্ট্যাটাস বদলায় (goal পূর্ণ হলে Resume → completed) |
| 🗑 Delete | আগে কনফার্মেশন, তারপর বাকি অংশ রিফান্ড |
| ✏️ Change Price | নতুন reward নেয় (audience-এর minimum price চেক করে) |
| 👤 Account type | All users ↔ Telegram Premium only |
| 🌐 Audience | ভাষা মাল্টি-সিলেক্ট (✅ টগল → Save) |
| ❌ Disable notification | শুধু এই টাস্কের alert বন্ধ |
| 🔄 Refresh Invite Link | নতুন invite link বানায় ও সেভ করে |

## নতুন ডেটা ফিল্ড

- `User`: `xp`, `language`, `notificationsEnabled`
- `Task`: `taskNumber` (Counter থেকে, পুরোনো টাস্ক প্রথমবার খুললে বসে যায়),
  `refundedCount`, `notifyOwner`

মাইগ্রেশন লাগবে না — সব ফিল্ডে ডিফল্ট আছে।

## এখনো বাকি

`💳 Replenish Balance` আলাদা কেনাকাটার ফ্লো নয় — টাস্ক বানানোর সময় ⭐ Stars
পেমেন্টই আছে। চাইলে ওখানে একটা আলাদা Stars invoice যোগ করা যাবে।

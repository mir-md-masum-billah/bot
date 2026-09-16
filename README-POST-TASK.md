# 👁 Post (Views) টাস্ক — যা ঠিক করা হলো

আগে `👁 Post` অপশনটা Channel/Group-এর মতোই chat picker ব্যবহার করত। কিন্তু
Telegram-এর picker শুধু **chat id** ফেরত দেয়, কোনো নির্দিষ্ট **post** না — তাই
ওয়ার্কারকে দেখানোর মতো কোনো পোস্ট বটের কাছে থাকত না, আর earn লিস্টে ভিউ টাস্কে
কোনো যাচাই ছাড়াই টাকা দেওয়া হতো। এখন পুরো ফ্লো স্ক্রিনশটের মতো করে বসানো হয়েছে।

## নতুন ফ্লো

**অ্যাডভার্টাইজার:**
1. 📢 Promote → 👁 Post
2. বট বলে: *Forward the post you want to promote*
3. ইউজার চ্যানেল থেকে পোস্ট ফরওয়ার্ড করে
4. বট `forward_origin` থেকে চ্যানেল id + message id বের করে
5. **অ্যাডমিন চেক** — বট ঐ চ্যানেলে অ্যাডমিন না হলে
   `➕ Add bot to channel` (Telegram-এর নিজস্ব channel picker deep link) +
   `🔄 Check again` বাটন দেখায়
6. **টেস্ট ফরওয়ার্ড** — পোস্টটা নিজের কাছে একবার ফরওয়ার্ড করে সাথে সাথে ডিলিট
   করে দেখে নেয় আসলেই ফরওয়ার্ড করা যায় কি না (চ্যানেলে *Restrict saving
   content* চালু থাকলে এখানেই ধরা পড়ে, টাকা খরচের আগে)
7. এরপর আগের মতোই audience → price → count → payment → Publish
8. Publish-এর ঠিক আগে আরেকবার অ্যাডমিন চেক হয়

**ওয়ার্কার:**
1. 💰 Earnings → 👀 Views
2. লিস্টে `👁 View Post +N GRAM` বাটন
3. ট্যাপ করলে বট **মূল চ্যানেল থেকে পোস্টটা ফরওয়ার্ড করে** পাঠায়
   (তাই "Forwarded from" হেডার থাকে এবং ভিউ আসল চ্যানেলে গোনা হয়)
4. সাথে সাথে GRAM যোগ হয় → `➡️ Next Post` / `❌ Report` / `⬅️ Back`
5. Report → 🔞 Inappropriate content / 📝 Other reason

## নিরাপত্তা / এজ কেস

- পোস্ট মুছে গেলে বা বটকে অ্যাডমিন থেকে সরালে → টাস্ক **auto-pause** এবং মালিককে
  নোটিফিকেশন (ডিলিট করলে বাকি GRAM রিফান্ড হয়, আগের লজিক অনুযায়ী)
- একই টাস্কে দুইবার পেমেন্ট আটকাতে atomic `findOneAndUpdate` (subscribe ফ্লো
  যেভাবে করে)
- ৩ জন আলাদা ওয়ার্কার রিপোর্ট করলে টাস্ক নিজে থেকেই pause হয় (`REPORT_AUTO_PAUSE`)
- প্রতি ওয়ার্কার একবারই রিপোর্ট করতে পারে
- পুরোনো views টাস্ক (যেগুলোতে `targetMessageId` নেই) earn লিস্টে আর দেখায় না

## পরিবর্তিত ফাইল

| ফাইল | কী বদলেছে |
|---|---|
| `models/Task.js` | `targetMessageId`, `reportCount`, `reports[]` ফিল্ড |
| `bot/keyboards.js` | `postForwardMenu`, `addBotToChannelMenu`, `afterViewMenu`, `reportReasonMenu`; views ক্যাটাগরিতে `earnTaskListMenu` এখন View Post বাটন দেয় |
| `bot/bot.js` | `extractForwardedPost`, `addBotToChannelLink`, `startPostWizard`, forwarded-post middleware, `postadmin_recheck`, `viewpost_*`, `postreport_*`, `prsn_*`, `recordReport`, `buildEarnFilter` |

## নোট

`/start` deep link দিয়ে বট অ্যাড করার সময় **Manage Messages** পারমিশনটা যেন
থাকে — এটা ছাড়া কিছু ক্ষেত্রে ফরওয়ার্ড ব্লক হতে পারে। পারমিশনের লিস্ট বদলাতে
`bot/bot.js`-এর `POST_ADMIN_RIGHTS` এডিট করুন।

# 🤖 Bot task flow v2 — no more instant "Check", owner→admin escalation

## What changed (per your request)

1. **The "🔄 Check" button is gone from every 🤖 Bot task.** Tapping a bot in
   the 🤖 Bots list no longer pays out on trust. Every bot task — including
   old "Bot start only" ones — now goes through the screenshot flow.

2. **New worker flow, matching the PR GRAM screenshots:**
   - 🤖 Bots list → each row is `🤖 Go to the bot | +N GRAM`.
   - Tapping it opens a task detail screen: reward, conditions, the
     "don't unsubscribe/block within 7 days" rule, and buttons
     `🤖 Go to the Bot` / `🙈 Hide task` / `❌ Report` / `⬅️ Back`.
   - Worker taps **Go to the Bot** (opens the target bot), starts it, comes
     back, and sends a screenshot right there in this chat.
   - Bot replies: `✅ Completion №{N} has been sent to the author for
     review. 🕒 If it is not reviewed within 24 hours — payment will be
     made automatically.` with `➡️ Next Bot` / `⬅️ Back` buttons — "Next
     Bot" jumps straight to the next unseen bot task, same as the post
     ("👁 Views") flow already did.

3. **Owner review → admin has the final say.**
   - Publisher gets the screenshot with ✅ Approve / ❌ Reject. Approve
     pays the worker immediately, same as before.
   - **Reject no longer penalizes the worker on the spot.** It's now
     forwarded for an admin's final decision (dashboard → Submissions tab,
     already showed `decidedBy` — "owner" there means "still needs your
     call"). If the admin approves, the worker gets paid (and the owner is
     penalized for the bad-faith rejection, same rule as before). If the
     admin also rejects, it stays rejected — no penalty either way, since
     the worker was never paid to begin with.
   - Auto-approve after 24h (unanswered by the owner) is unchanged.

4. **"🙈 Hide task"** is new — hides that specific bot task from the
   worker's own 🤖 Bots list going forward (`User.hiddenBotTaskIds`).

## Files touched
- `bot/keyboards.js` — bot-category rows in `earnTaskListMenu`, new
  `botTaskDetailMenu`, new `afterBotSubmitMenu`.
- `bot/bot.js` — `botLinkFor`, `showBotTaskDetail`, `findNextBotTask`,
  `botdetail_` / `nextbot_bot` / `bothide_` / `botreport_` actions;
  `verify_` now redirects any bot task into the new flow instead of
  crediting it; the screenshot handler no longer gates on
  `task.requiresProof`; `applyRejectionPenalty` no longer penalizes the
  worker on an owner rejection, and notifies them it's under admin review
  instead.
- `models/User.js` — `hiddenBotTaskIds`.

## Not done for you
- No live bot/DB test was run — please test Go to the Bot → screenshot →
  owner approve/reject → admin override → auto-approve in a staging bot
  before deploying.
- The admin dashboard's Submissions tab already shows `decidedBy`, which
  is how you tell "owner rejected, needs your final call" (`decidedBy:
  owner`, `status: rejected`) apart from an admin's own final rejection
  (`decidedBy: admin`) — no dashboard UI changes were made beyond that;
  say the word if you want a dedicated "Needs admin decision" filter/badge.

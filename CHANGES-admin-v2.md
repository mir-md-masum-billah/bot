# Admin dashboard v2 + Report system

## What's new
**Users can report problems (with screenshots)** — 👤 My Cabinet → 🆘 Report a Problem, `/report`, or the
"🆘 Dispute / Report" button that appears on a rejected-screenshot warning.
Pick a topic → describe → send up to 5 screenshots → Send. They can follow it in 📨 My reports
(`/myreports`), read your answer and reply (a resolved report re-opens if they reply).

**Dashboard tabs:** Overview · Reports · Screenshots · Users · Tasks · Transactions · Broadcast · Activity log.
- Reports: filters/search, screenshot viewer, full conversation (your replies go to the user in the bot),
  private notes, priority, Resolve / Reject (with a message to the user), Re-open, unread badge.
- Users: search, full profile (coins, tasks, screenshots, reports), Ban/Unban with reason, adjust balance
  with a required note, send a message, private notes.
- Screenshots: shows task, conditions, worker/owner names; approve / reject / overturn with clear
  explanation of what happens to the coins.
- Tasks: search/filter, pause/resume, change price, delete (optional refund), worker reports.
- Transactions: every coin movement, filter by user/type.
- Broadcast: send an announcement in batches (test-to-me first, type SEND to confirm, stop button).
- Activity log: **every** dashboard action is recorded (who/what/when/why).

## Fixes
- `/admin` crashed ("client-side exception"): server-only code was being bundled into the browser.
- Banning a user from the dashboard did nothing — it is now enforced in the bot (banned users can only
  send an appeal with /report).
- Admin rejecting a pending screenshot never told the worker — now they are notified.
- Screenshot proxy no longer exposes BOT_TOKEN in the browser.
- Login: constant-time check, fails closed if ADMIN_USERNAME/PASSWORD/secret are not set, server-side
  24h expiry, rate limit, Secure cookie, Log out button.
- Balance changes are atomic ($inc) so they can't overwrite coins earned at the same moment.
- All admin API errors are JSON, so the page can never crash on an error response.

## Deploy
1. Replace the project files with this version, commit, push (Vercel redeploys).
2. Add env vars in Vercel: `ADMIN_TELEGRAM_IDS` (your Telegram id — get a private message for every new
   report/reply; press /start on the bot first) and optionally `ADMIN_SESSION_SECRET`.
   `ADMIN_USERNAME`, `ADMIN_PASSWORD` and `WEBHOOK_SECRET` must already be set.
3. Log in again once (new cookie rules).
No database migration is needed; new collections are created automatically.

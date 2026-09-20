# Bot-task screenshot review (added)

New feature: "🤖 Bot" tasks can now require worker proof instead of paying
on trust.

## Flow
1. Promote → 🤖 Bot → choose **📝 With additional conditions** and describe
   what the worker must do (≤400 chars, no personal data/payment requests).
2. Worker taps Check → asked to send a screenshot instead of being paid
   instantly.
3. Owner gets the screenshot in a DM with ✅ Approve / ❌ Reject buttons.
   - Approve → worker is credited immediately.
   - Reject → owner is asked for a reason → worker is warned and has the
     reward amount deducted from their balance.
4. If the owner does nothing for `PROOF_AUTO_APPROVE_HOURS` (default 24),
   the submission auto-approves. Wire an external scheduler (Vercel Cron,
   cron-job.org, GitHub Actions, etc.) to hit, every 10–15 min:

   POST/GET https://your-app/api/cron/auto-approve-submissions?secret=<CRON_SECRET>

5. Admin dashboard → new **Submissions** tab: shows every screenshot with
   its status, who decided it and why, and lets an admin override:
   - Overturning a bad-faith **rejection** → worker still gets paid, and the
     GRAM penalty comes out of the **owner's** balance instead (+ a warning
     message to the owner).
   - Overturning a wrong **approval** → the reward is clawed back from the
     **worker** (+ a warning message to them).

## New/changed files
- `models/Submission.js` (new)
- `models/Task.js` — `requiresProof`, `conditionText`
- `models/Transaction.js` — `submission_penalty` type
- `bot/keyboards.js` — `botTaskTypeMenu`, `submissionReviewMenu`
- `bot/bot.js` — task-type wizard step, photo handler, approve/reject
  actions, `finalizeSubmissionApproval` / `applyRejectionPenalty` /
  `penalizeAndWarn` (exported, reused by the API routes)
- `pages/api/cron/auto-approve-submissions.js` (new)
- `pages/api/admin/submissions.js` (new)
- `pages/api/admin/submission-photo/[fileId].js` (new — resolves a Telegram
  file_id to a viewable image URL for the dashboard)
- `pages/admin/index.js` — Submissions tab
- `.env.example` — `PROOF_AUTO_APPROVE_HOURS`, `CRON_SECRET`

## Not done for you
- No automated tests were run against a live bot/DB — please test the full
  approve/reject/auto-approve/admin-override paths in a staging bot before
  going live.
- The cron route needs to actually be scheduled somewhere; nothing calls it
  on its own.

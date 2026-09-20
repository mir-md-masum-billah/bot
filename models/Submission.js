import mongoose from "mongoose";

// A worker's proof-of-completion for a "🤖 Bot — with additional conditions"
// task. Created the moment they send a screenshot; the task's completedCount
// is only ever incremented once this record reaches "approved" (by the
// owner, by an admin override, or automatically after PROOF_AUTO_APPROVE_HOURS).
const SubmissionSchema = new mongoose.Schema(
  {
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", required: true, index: true },
    ownerTelegramId: { type: Number, required: true, index: true },
    workerTelegramId: { type: Number, required: true, index: true },

    // Telegram file_id of the screenshot the worker sent — cheap to store,
    // and lets both the owner (in-chat) and the admin dashboard (via
    // getFile/embedded photo link) show the exact same image.
    photoFileId: { type: String, required: true },

    // Human-friendly sequential id, same pattern as Task.taskNumber.
    submissionNumber: { type: Number, index: true },

    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    // Who actually made the status decision that stuck.
    decidedBy: {
      type: String,
      enum: ["owner", "admin", "auto"],
      default: null,
    },

    // Required whenever the owner (or admin) rejects — shown to the worker
    // and to the admin dashboard so a bad-faith rejection is easy to spot.
    rejectReason: { type: String, default: "" },

    // Set once an admin has looked at this submission in the dashboard,
    // regardless of whether they changed anything. Lets the dashboard
    // separate "needs review" from "already checked".
    adminReviewedAt: { type: Date, default: null },
    // True only when the admin's decision actually differs from the
    // owner's/auto decision (i.e. they overturned it), which is what
    // triggers the balance penalty + warning message.
    adminOverrode: { type: Boolean, default: false },
    adminNote: { type: String, default: "" },

    decidedAt: { type: Date, default: null },

    // Pending submissions older than this get auto-approved by the cron
    // route (see pages/api/cron/auto-approve-submissions.js).
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

SubmissionSchema.index({ status: 1, expiresAt: 1 });

export default mongoose.models.Submission || mongoose.model("Submission", SubmissionSchema);

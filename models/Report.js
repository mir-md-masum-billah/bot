import mongoose from "mongoose";

// A problem report filed by a bot user (worker or task owner) through
// 👤 My Cabinet → 🆘 Report a Problem (or /report). Keeps the user's text,
// their screenshots (Telegram file_ids), the full admin <-> user
// conversation and the admin's private notes, so nothing is ever lost and
// every report can be traced from the admin dashboard → Reports tab.
export const REPORT_CATEGORIES = ["balance", "task", "dispute", "abuse", "bug", "other"];
export const REPORT_STATUSES = ["open", "in_review", "resolved", "rejected"];
export const REPORT_PRIORITIES = ["low", "normal", "high", "urgent"];

const ReplySchema = new mongoose.Schema(
  {
    from: { type: String, enum: ["admin", "user"], required: true },
    text: { type: String, default: "" },
    photos: { type: [String], default: [] },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const NoteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    by: { type: String, default: "admin" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const ReportSchema = new mongoose.Schema(
  {
    // Human friendly sequential id, "Report #12".
    reportNumber: { type: Number, index: true, unique: true, sparse: true },

    reporterTelegramId: { type: Number, required: true, index: true },
    // Snapshot at filing time (users can rename themselves later).
    reporterUsername: { type: String, default: "" },
    reporterName: { type: String, default: "" },

    category: { type: String, enum: REPORT_CATEGORIES, default: "other", index: true },
    text: { type: String, required: true },

    // Telegram file_ids of the screenshots (max 5). The dashboard shows
    // them through /api/admin/submission-photo/<fileId>.
    photos: { type: [String], default: [] },

    relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task", default: null },
    relatedSubmissionId: { type: mongoose.Schema.Types.ObjectId, ref: "Submission", default: null },

    status: { type: String, enum: REPORT_STATUSES, default: "open", index: true },
    priority: { type: String, enum: REPORT_PRIORITIES, default: "normal" },

    // Shown to the reporter when the report is resolved / rejected.
    resolution: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    resolvedBy: { type: String, default: "" },

    // Conversation between the reporter and the admin (both directions).
    replies: { type: [ReplySchema], default: [] },
    // Private admin-only notes — never sent to the user.
    notes: { type: [NoteSchema], default: [] },

    // True while there is something new from the user the admin hasn't
    // opened yet (new report or new reply). Drives the red dot / badge.
    unreadByAdmin: { type: Boolean, default: true, index: true },
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export default mongoose.models.Report || mongoose.model("Report", ReportSchema);

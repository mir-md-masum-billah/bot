import mongoose from "mongoose";

// Audit trail: every action taken from the admin dashboard (ban, balance
// change, submission override, task deletion, report reply, broadcast …) is
// written here with what changed, so there is always a record of who did
// what and why. Shown in the dashboard → Activity Log tab.
const AdminLogSchema = new mongoose.Schema(
  {
    admin: { type: String, default: "admin" },
    action: { type: String, required: true, index: true },
    // What the action was applied to.
    targetType: { type: String, default: "" }, // user | task | submission | report | broadcast | system
    targetId: { type: String, default: "", index: true },
    summary: { type: String, default: "" },
    details: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AdminLogSchema.index({ createdAt: -1 });

export default mongoose.models.AdminLog || mongoose.model("AdminLog", AdminLogSchema);

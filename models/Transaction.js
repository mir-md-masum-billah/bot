import mongoose from "mongoose";

const TransactionSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, index: true },
    type: {
      type: String,
      enum: [
        "earn_task", // completed someone else's task
        "spend_task", // paid to create a promotion task
        "donate", // topped up balance (purchase)
        "refund", // task deleted / paused refund
        "commission", // commission deducted
        "admin_adjust", // manual admin balance change
      ],
      required: true,
    },
    amount: { type: Number, required: true }, // positive or negative
    relatedTaskId: { type: mongoose.Schema.Types.ObjectId, ref: "Task" },
    note: String,
  },
  { timestamps: true }
);

export default mongoose.models.Transaction ||
  mongoose.model("Transaction", TransactionSchema);

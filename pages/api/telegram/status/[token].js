import { dbConnect } from "../../../../lib/db.js";
import PendingBotAdd from "../../../../models/PendingBotAdd.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const { token } = req.query;
  await dbConnect();

  const pending = await PendingBotAdd.findOne({ token });
  if (!pending) {
    res.status(404).json({ status: "not_found" });
    return;
  }

  if (pending.status === "pending" && pending.expiresAt < new Date()) {
    pending.status = "expired";
    await pending.save();
  }

  res.status(200).json({
    status: pending.status,
    type: pending.type,
    chatTitle: pending.chatTitle,
    chatType: pending.chatType,
    grantedPermissions: pending.grantedPermissions,
    failureReason: pending.failureReason,
  });
}

import { dbConnect } from "../../../lib/db.js";
import { isAuthed } from "../../../lib/adminAuth.js";
import User from "../../../models/User.js";
import Transaction from "../../../models/Transaction.js";

export default async function handler(req, res) {
  if (!isAuthed(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await dbConnect();

  if (req.method === "GET") {
    const users = await User.find({}).sort({ createdAt: -1 }).limit(200);
    res.status(200).json(users);
    return;
  }

  if (req.method === "PATCH") {
    const { telegramId, isBanned, adjustAmount, note } = req.body || {};
    const user = await User.findOne({ telegramId });
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (typeof isBanned === "boolean") user.isBanned = isBanned;
    if (adjustAmount) {
      user.donatedBalance += adjustAmount;
      await Transaction.create({
        telegramId,
        type: "admin_adjust",
        amount: adjustAmount,
        note: note || "Manual admin adjustment",
      });
    }
    await user.save();
    res.status(200).json(user);
    return;
  }

  res.status(405).end();
}

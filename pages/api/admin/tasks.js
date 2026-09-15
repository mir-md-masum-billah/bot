import { dbConnect } from "../../../lib/db.js";
import { isAuthed } from "../../../lib/adminAuth.js";
import Task from "../../../models/Task.js";

export default async function handler(req, res) {
  if (!isAuthed(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await dbConnect();

  if (req.method === "GET") {
    const tasks = await Task.find({}).sort({ createdAt: -1 }).limit(200);
    res.status(200).json(tasks);
    return;
  }

  if (req.method === "PATCH") {
    const { id, status, pricePerAction } = req.body || {};
    const update = {};
    if (status) update.status = status;
    if (pricePerAction) update.pricePerAction = pricePerAction;
    const task = await Task.findByIdAndUpdate(id, update, { new: true });
    res.status(200).json(task);
    return;
  }

  if (req.method === "DELETE") {
    const { id } = req.body || {};
    await Task.findByIdAndUpdate(id, { status: "deleted" });
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).end();
}

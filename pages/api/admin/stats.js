import { dbConnect } from "../../../lib/db.js";
import { isAuthed } from "../../../lib/adminAuth.js";
import User from "../../../models/User.js";
import Task from "../../../models/Task.js";

export default async function handler(req, res) {
  if (!isAuthed(req)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await dbConnect();

  const [userCount, activeTasks, totalTasks] = await Promise.all([
    User.countDocuments({}),
    Task.countDocuments({ status: "active" }),
    Task.countDocuments({}),
  ]);

  res.status(200).json({ userCount, activeTasks, totalTasks });
}

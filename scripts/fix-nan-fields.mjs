// One-off cleanup for tasks/users with non-finite (NaN) numeric fields,
// which is what causes "Cast to Number failed for value \"NaN\"" crashes.
//
// Usage:
//   MONGODB_URI="your-uri" node scripts/fix-nan-fields.mjs         # dry run, just reports
//   MONGODB_URI="your-uri" node scripts/fix-nan-fields.mjs --fix   # actually fixes

import mongoose from "mongoose";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) throw new Error("Set MONGODB_URI");
const FIX = process.argv.includes("--fix");

await mongoose.connect(MONGODB_URI);
const db = mongoose.connection.db;

// Query raw collections directly (bypasses Mongoose casting, which would
// otherwise refuse to even read/compare NaN the way we need here).
const tasks = db.collection("tasks");
const users = db.collection("users");

const badTasks = await tasks.find({ pricePerAction: { $type: "double", $nin: [] } }).toArray();
const nanTasks = badTasks.filter((t) => Number.isNaN(t.pricePerAction));
console.log(`Found ${nanTasks.length} task(s) with pricePerAction = NaN`);
for (const t of nanTasks) {
  console.log(`  task ${t._id} (owner ${t.ownerTelegramId}, status ${t.status})`);
  if (FIX) {
    // Pause it rather than guess a price — an owner needs to review/reprice it.
    await tasks.updateOne({ _id: t._id }, { $set: { status: "paused", pricePerAction: 0 } });
  }
}

const allUsers = await users.find({}).toArray();
const nanUsers = allUsers.filter(
  (u) => Number.isNaN(u.earnedBalance) || Number.isNaN(u.donatedBalance)
);
console.log(`Found ${nanUsers.length} user(s) with a NaN balance`);
for (const u of nanUsers) {
  console.log(
    `  user ${u.telegramId} earnedBalance=${u.earnedBalance} donatedBalance=${u.donatedBalance}`
  );
  if (FIX) {
    const set = {};
    if (Number.isNaN(u.earnedBalance)) set.earnedBalance = 0;
    if (Number.isNaN(u.donatedBalance)) set.donatedBalance = 0;
    await users.updateOne({ _id: u._id }, { $set: set });
  }
}

console.log(FIX ? "Done — fixes applied." : "Dry run only — rerun with --fix to apply.");
await mongoose.disconnect();
